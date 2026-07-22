import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";
import * as dedent from "dedent";

import { serviceFromDeployment, SealedSecret, ConfigMap } from "#src/utils";
import { Serving } from "#src/serving";
import { versions } from '#src/config';

interface SyncthingArgs {
    serving: Serving,
    host: pulumi.Input<string>,
    // File data storage. Provide exactly one of:
    //  - storageClassName: dynamically provision the data PVC
    //  - dataPvc: reuse an existing PVC (e.g. a static NodePV on a host path)
    storageClassName?: pulumi.Input<string>,
    dataPvc?: kx.PersistentVolumeClaim,
    // Sealed private key that fixes this device's ID. Omit to let syncthing
    // generate its own on first start (persisted in the local DB PVC).
    deviceKeyEncrypted?: pulumi.Input<string>,
    // Optional gdrive bisync sidecar bridging <files>/Stuff <-> gdrive:Stuff.
    gdriveSync?: {
        guiApiKeyEncrypted: pulumi.Input<string>,
        rcloneServiceAccountEncrypted: pulumi.Input<string>,
        rcloneTeamDriveEncrypted: pulumi.Input<string>,
    },
    // Co-locate with the juicefs-redis master for metadata perf. Only relevant
    // for a jfs-backed instance; a NodePV-backed pod is already node-pinned by
    // the PV's nodeAffinity.
    juicefsColocation?: boolean,
    // lbpool for the sync-protocol (22000) LoadBalancer.
    syncLbPool?: 'internet' | 'homelan',
}

export class Syncthing extends pulumi.ComponentResource<SyncthingArgs> {
    constructor(name: string, args: SyncthingArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Syncthing', name, args, opts);
        // Need a frontend service for web ui, and a loadbalancer service for
        // other ports

        if ((args.storageClassName === undefined) === (args.dataPvc === undefined)) {
            throw new Error("Syncthing requires exactly one of storageClassName or dataPvc");
        }

        // Device identity: the private key determines the local device ID. When
        // provided it is sealed and mounted so the ID stays stable; otherwise
        // syncthing generates its own on first start (kept in the DB PVC).
        const deviceKeySecret = args.deviceKeyEncrypted === undefined ? undefined : new SealedSecret(name, {
            spec: {
                encryptedData: {
                    'key.pem': args.deviceKeyEncrypted,
                }
            }
        }, { parent: this });

        // local db storage
        const localDbPvc = args.serving.base.createLocalStoragePVC(`${name}-db`, {
            resources: {
                requests: {
                    storage: "500Mi"
                }
            }
        }, { parent: this, });

        // certificate for https to/from traefik
        const cert = args.serving.base.createBackendCertificate(`${name}-gui`, {
            namespace: pulumi.output(localDbPvc.metadata).apply(m => m.namespace!),
        }, { parent: this });

        // file storage: either a provided (e.g. static NodePV) PVC or a
        // dynamically provisioned one.
        const pvc = args.dataPvc ?? new kx.PersistentVolumeClaim(name, {
            metadata: {
                name: `${name}-data`,
            },
            spec: {
                storageClassName: args.storageClassName,
                accessModes: [
                    'ReadWriteOnce',
                    'ReadWriteMany',
                ],
                resources: {
                    requests: {
                        storage: "5Ti"
                    }
                },
            }
        }, {
            parent: this,
        });

        // partial config
        const sthomePrefix = '/var/syncthing';
        const filePrefix = '/hostsync';
        const ports = {
            gui: 8384,
            syncthing: 22000,
            // 'localdiscosrv': 21027
        };
        const cm = new ConfigMap(name, {
            ref_file: __filename,
            data: 'static/*',
            stripComponents: 1,
            tplVariables: {
                ports,
                filePrefix,
            },
        }, { parent: this });

        // API key shared between the syncthing container and the gdrive
        // sync-loop sidecar (needed for the events API; the GUI has no other
        // auth configured, real auth happens at the ingress). Only created when
        // the gdrive bridge is enabled for this instance.
        const guiApiKey = args.gdriveSync === undefined ? undefined : new SealedSecret(`${name}-gui-apikey`, {
            spec: {
                encryptedData: {
                    apikey: args.gdriveSync.guiApiKeyEncrypted,
                },
            },
        }, { parent: this });

        // rclone credentials for the gdrive sync-loop sidecar
        const rcloneConfig = args.gdriveSync === undefined ? undefined : new SealedSecret(`${name}-rclone`, {
            spec: {
                encryptedData: {
                    "service_account_credentials": args.gdriveSync.rcloneServiceAccountEncrypted,
                    "team_drive": args.gdriveSync.rcloneTeamDriveEncrypted,
                },
                template: {
                    data: {
                        "rclone.conf": dedent`
                        [gdrive]
                        type = drive
                        scope = drive
                        service_account_credentials = {{ .service_account_credentials }}
                        team_drive = {{ .team_drive }}
                        skip_gdocs = true
                        acknowledge_abuse = true
                        `,
                    },
                },
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            // Place it close to jfs metadata (jfs-backed instance only; a
            // NodePV-backed pod is already node-pinned by the PV's nodeAffinity).
            affinity: args.juicefsColocation ? {
                podAffinity: {
                    // This is a hack to run the pod on the same node as juicefs
                    // redis master, because otherwise the metadata server
                    // performance is very bad.
                    requiredDuringSchedulingIgnoredDuringExecution: [
                        {
                            topologyKey: 'kubernetes.io/hostname',
                            labelSelector: {
                                matchLabels: {
                                    'app.kubernetes.io/instance': 'juicefs-redis',
                                    'app.kubernetes.io/component': 'master',
                                }
                            },
                            namespaces: ['kube-system']
                        }
                    ]
                },
            } : undefined,
            securityContext: {
                fsGroup: 1000,
                fsGroupChangePolicy: 'OnRootMismatch',
            },
            volumes: [
                {
                    name: localDbPvc.metadata.name,
                    persistentVolumeClaim: {
                        claimName: localDbPvc.metadata.name,
                    },
                },
                {
                    name: pvc.metadata.name,
                    persistentVolumeClaim: {
                        claimName: pvc.metadata.name,
                    },
                },
                {
                    name: pulumi.output(cert.metadata.name).apply(n => n!),
                    secret: {
                        secretName: cert.secretName,
                        defaultMode: 0o440,
                    },
                },
            ],
            initContainers: [{
                name: `${name}-config`,
                image: versions.image.yq,
                // On a fresh instance the DB PVC has no config.xml yet, so seed
                // it from the partial (syncthing completes the rest — local
                // device, version — on first start). On subsequent starts merge
                // the partial overrides into the existing config.
                command: ['/bin/sh', '-c'],
                args: [
                    `if [ -f ${sthomePrefix}/config.xml ]; then ` +
                    `yq --inplace --input-format xml --output-format xml ` +
                    `'(.configuration) += load_xml("/newconfig/config.xml").configuration' ${sthomePrefix}/config.xml; ` +
                    `else cp /newconfig/config.xml ${sthomePrefix}/config.xml; fi`,
                ],
                volumeMounts: [
                    {
                        name: localDbPvc.metadata.name,
                        mountPath: sthomePrefix,
                    },
                    cm.mount('/newconfig'),
                ],
            }],
            containers: [{
                name,
                image: versions.image.syncthing,
                resources: {
                    requests: { cpu: "10m", memory: "96Mi" },
                    limits: { cpu: "300m", memory: "256Mi" },
                },
                ports,
                args: [
                    '--no-browser',
                    '--no-restart',
                    '--no-upgrade',
                    '--log-level=INFO',
                    `--home=${sthomePrefix}`,
                ],
                env: {
                    // Only pinned when the gdrive sidecar needs to share it;
                    // otherwise syncthing generates a random GUI API key.
                    ...(guiApiKey ? { STGUIAPIKEY: guiApiKey.asEnvValue('apikey') } : {}),
                },
                volumeMounts: [
                    {
                        name: localDbPvc.metadata.name,
                        mountPath: sthomePrefix,
                    },
                    {
                        name: pvc.metadata.name,
                        mountPath: filePrefix,
                        mountPropagation: "HostToContainer",
                    },
                    // Mount a fixed device key only when provided; otherwise
                    // syncthing generates its own on first start.
                    ...(deviceKeySecret ? [deviceKeySecret.mount(`${sthomePrefix}/key.pem`, 'key.pem')] : []),
                    {
                        name: pulumi.output(cert.metadata.name).apply(n => n!),
                        mountPath: `${sthomePrefix}/https-cert.pem`,
                        subPath: 'tls.crt',
                        readOnly: true,
                    },
                    {
                        name: pulumi.output(cert.metadata.name).apply(n => n!),
                        mountPath: `${sthomePrefix}/https-key.pem`,
                        subPath: 'tls.key',
                        readOnly: true,
                    },
                ],
                livenessProbe: {
                    httpGet: {
                        port: 8384,
                        path: '/rest/noauth/health',
                    },
                    initialDelaySeconds: 300,
                    periodSeconds: 60,
                    timeoutSeconds: 10,
                },
            }, ...(args.gdriveSync ? [{
                // Event-driven gdrive sync: long-polls the syncthing events
                // API and runs rclone bisync on every change, with the poll
                // timeout as the fallback cadence for gdrive-side changes.
                // Replaces the old every-minute CronJob (no more per-run pod
                // churn, and a single loop can never race its own lock).
                // See static/sync-loop.sh.
                name: `${name}-gdrive-sync`,
                image: versions.image.rclone,
                command: ['/bin/sh', '/scripts/sync-loop.sh'],
                resources: {
                    requests: { cpu: "20m", memory: "64Mi" },
                    limits: { cpu: "200m", memory: "128Mi" },
                },
                env: {
                    STGUIAPIKEY: guiApiKey!.asEnvValue('apikey'),
                },
                volumeMounts: [
                    {
                        name: pvc.metadata.name,
                        mountPath: filePrefix,
                        mountPropagation: "HostToContainer",
                    },
                    rcloneConfig!.mount('/config'),
                    // cm is already mounted (and its pod volume created) by the
                    // init container above; kx does not dedupe volumes across
                    // containers, so reference the existing volume by name here
                    // instead of calling cm.mount() a second time.
                    {
                        name: cm.metadata.name,
                        mountPath: '/scripts',
                    },
                ],
            }] : [])]
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            spec: pb.asDeploymentSpec({
                strategy: {
                    // syncthing needs exclusive access to pvc, otherwise it will error out as resource busy
                    type: 'Recreate'
                }
            }),
        }, { parent: this });

        // Syncthing sync protocol exposed via LoadBalancer. 'internet' routes
        // via the VPS node; 'homelan' binds the port on the homelab node
        // (reachable on its home-LAN and ZeroTier IPs).
        const syncLbPool = args.syncLbPool ?? 'internet';
        const service = new kx.Service(name, {
            metadata: {
                name,
                labels: {
                    'svccontroller.k3s.cattle.io/lbpool': syncLbPool,
                },
            },
            spec: {
                type: "LoadBalancer",
                ...(syncLbPool === 'homelan' ? { allocateLoadBalancerNodePorts: false } : {}),
                ports: {
                    syncthing: ports.syncthing,
                },
                selector: deployment.spec.selector.matchLabels,
            },
        }, { parent: this });

        // Gui service sits behind ingress
        const guiService = new kx.Service(`${name}-gui`, {
            metadata: {
                name: `${name}-gui`,
            },
            spec: {
                ports: {
                    https: ports.gui,
                },
                selector: deployment.spec.selector.matchLabels,
            },
        }, { parent: this });

        const frontend = args.serving.createFrontendService(name, {
            host: args.host,
            enableAuth: true,
            targetService: guiService,
            backendCert: cert,
        });

    }
}

interface SyncthingDiscosrvArgs {
    serving: Serving,
    host: string,
}

export class SyncthingDiscosrv extends pulumi.ComponentResource<SyncthingDiscosrvArgs> {
    constructor(name: string, args: SyncthingDiscosrvArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:SyncthingDiscosrv', name, args, opts);

        const service_account = new k8s.core.v1.ServiceAccount(name, {}, { parent: this });
        const namespace = service_account.metadata.namespace;

        // With TLS passthrough the backend terminates TLS itself, so it must
        // present a publicly trusted certificate — clients keep validating the
        // discovery server by CA without pinning a device id in the URL.
        const certificate = args.serving.base.createFrontendCertificate(args.host, {
        }, { parent: this });

        const pvc = args.serving.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "10Mi",
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: versions.image.stdiscosrv,
                resources: {
                    requests: { cpu: "10m", memory: "32Mi" },
                    limits: { cpu: "20m", memory: "64Mi" },
                },
                args: [
                    '--cert=/tls/tls.crt',
                    '--key=/tls/tls.key',
                    '--debug',
                ],
                ports: {
                    https: 8443,
                },
                volumeMounts: [
                    certificate.mount('/tls'),
                    pvc.mount('/var/stdiscosrv'),
                ],
                livenessProbe: {
                    httpGet: {
                        port: 8443,
                        path: '/ping',
                        scheme: 'HTTPS',
                    },
                    initialDelaySeconds: 10,
                    periodSeconds: 60,
                    timeoutSeconds: 10,
                },
            }],
        });
        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            spec: pb.asDeploymentSpec({
                strategy: {
                    // stdiscosrv needs exclusive access to pvc, otherwise it will error out as resource busy
                    type: 'Recreate'
                }
            }),
        }, { parent: this, deleteBeforeReplace: true });
        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            },
        });
        // TLS passthrough: the Gateway routes by SNI without terminating TLS,
        // so syncthing clients do the TLS handshake (including their device
        // client certificate) directly with stdiscosrv. No TLSOption or
        // passTLSClientCert header forwarding needed anymore.
        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            tlsPassthrough: true,
            enableMTls: false,
        });
    }
}
