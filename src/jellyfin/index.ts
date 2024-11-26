import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";
import { BaseCluster } from '#src/base-cluster';
import { versions } from "#src/config";

interface JellyfinArgs {
    serving: Serving,
    host: pulumi.Input<string>,
    pvc: pulumi.Input<kx.PersistentVolumeClaim>,
}

export class Jellyfin extends pulumi.ComponentResource<JellyfinArgs> {
    constructor(name: string, args: JellyfinArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Jellyfin', name, args, opts);

        pulumi.output(args).apply(args => {
            // config should be persisted, so use stable for storage
            // jfs isn't a good fit as this will run on homelab with limited up
            // bw to S3
            const configPvc = args.serving.base.createLocalStoragePVC(`${name}-config`, {
                storageClassName: args.serving.base.localStableStorageClass.metadata.name,
                resources: {
                    requests: {
                        storage: "4Gi"
                    }
                }
            }, { parent: this });
            // cache for transcoding
            const cachePvc = args.serving.base.createLocalStoragePVC(`${name}-cache`, {
                resources: {
                    requests: {
                        storage: "512Gi"
                    }
                }
            }, { parent: this });

            const pkcs12Secret = new k8s.core.v1.Secret(`${name}-pkcs12-password`, {
                stringData: {
                    // This doesn't need to be secure, because the certificate
                    // in pkcs12 is available in plain text in the save output
                    // secret anyway.
                    password: name,
                }
            }, { parent: this });
            const cert = args.serving.base.createBackendCertificate(name, {
                namespace: configPvc.metadata.namespace,
                pkcs12: {
                    create: true,
                    passwordSecretRef: {
                        name: pkcs12Secret.metadata.name,
                        key: 'password',
                    },
                },
            }, { parent: this });

            const ports: k8s.types.input.core.v1.ContainerPort[] = [
                { name: 'http', containerPort: 8096 },
                { name: 'https', containerPort: 8920 },
                // for auto discovery
                { name: 'sdis', containerPort: 1900, protocol: 'UDP' },
                { name: 'cdis', containerPort: 7359, protocol: 'UDP' },
            ];

            // create service first to get the external IP
            const lanService = new kx.Service(`${name}-lan`, {
                metadata: {
                    name: `${name}-lan`,
                    labels: {
                        'svccontroller.k3s.cattle.io/lbpool': 'homelan',
                    },
                    annotations: {
                        // Don't wait for the service to be ready since this is
                        // created first.
                        'pulumi.com/skipAwait': 'true',
                    }
                },
                spec: {
                    type: 'LoadBalancer',
                    ports: ports.map(({ name, containerPort, protocol }) => ({ name, port: containerPort, protocol })),
                    allocateLoadBalancerNodePorts: false,
                    selector: {
                        app: name,
                    },
                },
            }, { parent: this, deleteBeforeReplace: true });

            const publishedUrl = pulumi.interpolate`${lanService.status.loadBalancer.ingress[0].ip}:${ports[0].containerPort}`;
            const pb = new kx.PodBuilder({
                restartPolicy: 'Always',
                containers: [
                    {
                        name,
                        image: versions.image.jellyfin,
                        env: {
                            // The Server URL to publish in udp Auto Discovery response.
                            // this is only used on LAN so we use the homelan IP
                            'JELLYFIN_PublishedServerUrl': publishedUrl,
                            // cache dir defaults to /config/cache, but we want it
                            // separate
                            'JELLYFIN_CACHE_DIR': '/cache'
                        },
                        volumeMounts: [
                            args.pvc.mount('/media'),
                            configPvc.mount('/config'),
                            cachePvc.mount('/cache'),
                            // for custom system fonts
                            configPvc.mount('/usr/local/share/fonts/custom', 'fonts'),
                            cert.mount('/tls'),
                        ],
                        ports,
                        resources: {
                            limits: {
                                'gpu.intel.com/i915': '1'
                            }
                        },
                        livenessProbe: this.configureProbe(),
                        readinessProbe: this.configureProbe(),
                    },
                ],
            });

            const deployment = new kx.Deployment(name, {
                metadata: {
                    annotations: {
                        "reloader.stakater.com/auto": "true"
                    }
                },
                spec: pb.asDeploymentSpec({
                    // this container uses GPU that has to be released before
                    // update
                    strategy: { type: "Recreate" },
                }),
            }, {
                parent: this,
                // this container uses GPU that has to be released before
                // update
                deleteBeforeReplace: true
            });

            // ClusterInternal service
            const service = serviceFromDeployment(name, deployment, {
                metadata: {
                    name,
                },
            });
            // Frontend on reverse proxy
            args.serving.createFrontendService(name, {
                host: args.host,
                targetService: service,
                // Jellyfin doesn't support TLS on its own.
                enableTls: true,
                // Jellyfin will itself connect to Authelia using OpenID Connect
                enableAuth: false,
            });
        });
    }

    private configureProbe(override?: k8s.types.input.core.v1.Probe): k8s.types.input.core.v1.Probe {
        return {
            httpGet: {
                path: "/health",
                port: "http",
                scheme: "HTTP",
            },
            initialDelaySeconds: 30,
            periodSeconds: 30,
            timeoutSeconds: 30,
            successThreshold: 1,
            failureThreshold: 30,
            ...(override ?? {})
        };
    }
}

