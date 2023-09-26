import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";

interface JellyfinArgs {
    serving: Serving,
    externalIPs: string[],
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

            const pb = new kx.PodBuilder({
                restartPolicy: 'Always',
                containers: [
                    {
                        image: 'docker.io/jellyfin/jellyfin:latest',
                        env: {
                            'JELLYFIN_PublishedServerUrl': args.externalIPs[0],
                            // cache dir defaults to /config/cache, but we want it
                            // separate
                            'JELLYFIN_CACHE_DIR': '/cache'
                        },
                        volumeMounts: [
                            args.pvc.mount('/media'),
                            configPvc.mount('/config'),
                            cachePvc.mount('/cache'),
                        ],
                        ports: [
                            { name: 'http', containerPort: 8096 },
                            { name: 'https', containerPort: 8920 },
                            // for auto discovery
                            { name: 'sdis', containerPort: 1900, protocol: 'UDP' },
                            { name: 'cdis', containerPort: 7359, protocol: 'UDP' },
                        ],
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
                spec: pb.asDeploymentSpec(),
            }, {
                parent: this,
                // this container uses GPU that has to be released before
                // update
                deleteBeforeReplace: true
            });

            const service = serviceFromDeployment(name, deployment, {
                metadata: {
                    name,
                },
                spec: {
                    externalIPs: args.externalIPs,
                },
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

