import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

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
