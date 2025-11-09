import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";
import * as dedent from "dedent";

import { serviceFromDeployment, SealedSecret, ConfigMap } from "#src/utils";
import { Serving, Middleware, TLSOption } from "#src/serving";
import { versions } from '#src/config';

interface SyncthingArgs {
    serving: Serving,
    host: pulumi.Input<string>,
    storageClassName: pulumi.Input<string>,
}

export class Syncthing extends pulumi.ComponentResource<SyncthingArgs> {
    constructor(name: string, args: SyncthingArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Syncthing', name, args, opts);
        // Need a frontend service for web ui, and a loadbalancer service for
        // other ports

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    // This is the private key that determins local device ID
                    'key.pem': "AgACZGpBExpkr6biwFKd2n25WUdqmNrlu75DZsqRyJfCEbRah2mrGlhSNgOboVSiRr4lSC7WvGieud8Vqo8JtqIjfAmToLCs0zgYW/2+/jQoqsnIygFnJBel9v9ZXTEm89jI2tSJjQSOASD7NWm/J8fknV7o44BNBYf8zde844JGUQaGDkYNhPvdflmCoL3EPlle5Qi22G0QtcL8UOANEH0RJvOhyQZKWZxBerITg36OPAVPVRcIdN4HTeQ6DuDf21je+AwozhhRhCIz35z0FKA0bN7vwKMF3ixTAry+8vLIi78H1zmhC1+nFuN02GzJcyfvQeL5I4XV1aS1CwOTPRRzoVH3UfdJ6hp8SU+H1malhzAquAKMmJO+Q9NVDtgrRXERa7xRvGOZdvkUHwxDzAmiifvDEpFThywxnqQxy4ECQohWPxLU1uTssd07ldbm0oRIhDiwShPr2qOwwnCBagsWAbk9b3geBtJP+NJEYCOgbGLJaPXjMhOdx6YRyyVvCLQsJ8ilFt+a+ksIoUuatp0S6zGv+g/UVp0dWYUDiwXwImQtr29f/Lytf0Ij7T6CiqztuFu7y93eCeeVD7QFIdWNt2LPjeK0iAAayTw6o115tCOLqjp0WcRSt3kmwTkNhMTyQT4SlzkZEXF6A/oH3tqJE7GcF01bNE/BQfcQXSn/jx4L9gEa3cA/8K9sxt/XQlxFoYGZLFcUvkNsZgAo0cEvC8LdnPQYQ0a5N+7yd0s/T6ntSRRU5Vyl1iTOIObxuTsJQC+gaEICy/bIeNE7rCYDjTnNtNSOqq5aYKBNVSZmL5Qus1MRYYO65jW2/gaPGZNme3XIjOnRsjLC1BfOpHDqIec7xLOzPGbK5/INxdzbfCgDTJWBRTB6mOd9QZYSaaRu0LxdD503wcdl1HXOvL7SQjyg04MWOkBYC2xwCQdRJAbbNmJvMT8/rDqDJJsXONoJHCsQ+FiiHw4M3qGlW9WAodW0CBccituaxOkQut+wCMkj/A0Z3SwU1QPvWRF+cyLIt3rrpT53BX2Nz2DzNtQEn/+89xfGhBL944Ye4c0pAdZ0fNO3+rdYPnCSoYsafQ==",
                }
            }
        }, { parent: this });

        // certificate for https to/from traefik
        const cert = args.serving.base.createBackendCertificate(`${name}-gui`, {
            namespace: pulumi.output(secrets.metadata).apply(m => m.namespace!),
        }, { parent: this });

        // local db storage
        const localDbPvc = args.serving.base.createLocalStoragePVC(`${name}-db`, {
            resources: {
                requests: {
                    storage: "500Mi"
                }
            }
        }, { parent: this, });

        // file storage
        const pvc = new kx.PersistentVolumeClaim(name, {
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

        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            // Place it close to jfs matadata
            affinity: {
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
            },
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
                args: [
                    '--inplace',
                    '--input-format', 'xml',
                    '--output-format', 'xml',
                    '(.configuration) += load_xml("/newconfig/config.xml").configuration',
                    `${sthomePrefix}/config.xml`,
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
                    limits: { cpu: "300m", memory: "128Mi" },
                },
                ports,
                args: [
                    '--no-browser',
                    '--no-default-folder',
                    '--no-restart',
                    '--no-upgrade',
                    `--home=${sthomePrefix}`,
                ],
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
                    secrets.mount(`${sthomePrefix}/key.pem`, 'key.pem'),
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
            }]
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

        // Syncthing exposed to internet directly
        const service = new kx.Service(name, {
            metadata: {
                name,
                labels: {
                    'svccontroller.k3s.cattle.io/lbpool': 'internet',
                },
            },
            spec: {
                type: "LoadBalancer",
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
        });

        // Create a cronjob pod to run rclone between syncthing stuff folder and
        // google drive
        const rcloneConfig = new SealedSecret(`${name}-rclone`, {
            spec: {
                encryptedData: {
                    "service_account_credentials": "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",
                    "team_drive": "AgCZPy+Wq2f1oS9dOX2x7Q60XhierD1+wqrxcNrTgFii5WvBmHeW2H1YXrB/9KAs7L8CiAmlvIf92++cXeDEfEqLqsSgHISGeKARhPnkJe4kNSblJVOhrCAQ5G04CEmd1eepeyfOaf06SYrSO6cjfCXxp1YjnjzGx0gWa9ST9K8qvUng0MzBfKPVAjF8gaSjUkp70DPREOltHArsBcyAtMc5pAsCWKkBQiMldm777uDR+CVsnn0S6D8xownMq9A/BYaFH83WzkIxW49gXaA83iG/6iMTASFWOyOBDx3Ao6VLsN08SXeoYL88/uJIdrHHX41ScIbecT/LxQq3NQDZTJCcCNXgmgrXV7PPekLw09ASS8cdolyN1qfpU2GWaCdUP1dBLhevEHTMTLXdBWt38HLOT8Vwi5N//vjl1z2ZPtQEi7vir8pUxU9Oj63ZxL44nILi085Q64FG+TUqmP1iR+ZtgoEe4aL5bkB4/hkR6oZdhSugnJhvV8qY4y6RhbRRMd47p/zi7LgfIWSI+MH3Wyj2hEVpiztUGIcS3E9fmYTc2ti35IuFqS6hdTKpimyOkiE1fsvNAsJZoR71BVEUcvqTvCajQwRH8JhHankSycsxjmg5UGAGLPSbsguYs/obT9R7MFCYh+RPUFkjh/sTaCp/1JcrVylHB0mU5AAdbBWOUPP8oRCMf/lMs4ITrlVDgHpeKsMms3O5810c3dGHt6QOxra/",
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
        const rclonePod = new kx.PodBuilder({
            restartPolicy: 'Never',
            // Place it close to jfs matadata
            affinity: {
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
            },
            securityContext: {
                fsGroup: 1000,
                fsGroupChangePolicy: 'OnRootMismatch',
            },
            containers: [{
                name,
                image: versions.image.rclone,
                resources: {
                    requests: { cpu: "100m", memory: "64Mi" },
                    limits: { cpu: "100m", memory: "64Mi" },
                },
                args: [
                    'bisync',
                    `${filePrefix}/Stuff`,
                    'gdrive:Stuff',
                    '--config', '/config/rclone.conf',
                    '--check-access',
                    '--check-filename', 'stignore.txt',
                    '--create-empty-src-dirs',
                    '--compare',
                    'size,modtime,checksum',
                    '--slow-hash-sync-only',
                    '-MvP',
                    '--fix-case',
                    '--resilient',
                    '--recover',
                    '--max-lock', '2m',
                    '--conflict-resolve', 'newer',
                    '--workdir', `${filePrefix}/Stuff/.rclone-bisync-workdir`,
                    '--filters-file', `${filePrefix}/Stuff/.rclone-bisync-workdir/rclone-filters.txt`,
                ],
                volumeMounts: [
                    {
                        volume: {
                            name: pvc.metadata.name,
                            persistentVolumeClaim: {
                                claimName: pvc.metadata.name,
                            },
                        },
                        destPath: filePrefix,
                    },
                    cm.mount('/filters'),
                    rcloneConfig.mount('/config'),
                ],
            }]
        });

        const rcloneCron = new k8s.batch.v1.CronJob('rclone-sync', {
            spec: {
                schedule: "* * * * *",
                concurrencyPolicy: "Forbid",
                jobTemplate: {
                    spec: rclonePod.asJobSpec({
                        backoffLimit: 0
                    }),
                },
                failedJobsHistoryLimit: 1,
                successfulJobsHistoryLimit: 2,
            },
        }, { parent: this });
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

        const certificate = args.serving.base.createBackendCertificate(name, {
            namespace,
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
                    requests: { cpu: "2m", memory: "24Mi" },
                    limits: { cpu: "2m", memory: "24Mi" },
                },
                args: [
                    //'-cert=/tls/tls.crt',
                    //'-key=/tls/tls.key',
                    '--http',
                    '--debug',
                ],
                ports: {
                    //https: 8443,
                    http: 8443,
                },
                volumeMounts: [
                    //certificate.mount('/tls'),
                    pvc.mount('/var/stdiscosrv'),
                ],
                livenessProbe: {
                    httpGet: {
                        port: 8443,
                        path: '/ping',
                        scheme: 'HTTP',
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
        // stdiscosrv requires client certificate
        const tlsOption = new TLSOption(name, {
            sniStrict: true,
            clientAuth: {
                // Requires certificate from client, but don't verify it, as it
                // is just a certificate signed by syncthing device key.
                clientAuthType: 'RequireAnyClientCert',
            }
        }, { parent: this });
        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            tlsOption,
            enableTls: false,
            middlewares: [
                // stdiscosrv needs client cert info
                // note that X-Client-Port is only needed if connecting using http
                // but we connect using https
                // https://docs.syncthing.net/users/stdiscosrv.html#requirements
                // https://github.com/syncthing/syncthing/pull/6065
                new Middleware('client-cert', {
                    passTLSClientCert: {
                        pem: true
                    }
                }, { parent: this }),
            ],
        });
    }
}
