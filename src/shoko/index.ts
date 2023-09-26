import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";

interface ShokoArgs {
    serving: Serving,
    externalIPs: string[],
    pvc: pulumi.Input<kx.PersistentVolumeClaim>,
}

export class Shoko extends pulumi.ComponentResource<ShokoArgs> {
    constructor(name: string, args: ShokoArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Shoko', name, args, opts);

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    'SHOKO_AniDb_AVDumpKey': "AgCUfbSCDeFcW4h/9H4+oB95zET/9HWkuzu1mg5jjqxYUK294l+QSzK+rGanKb8CV34yuE/0g5UjlA1qGp1whg4dUUn7eiZTuqIA5DhUgY29/wCjzYmVufuD0oipiV4xFI5qRpnAsrmDnTcjRbq5JKRnv9wHmGHduZm0vkO9icfLrBu4X/30WDC+9tuNijBGBS2I54RHuxsdrZWZpApQ0DCvDF0bhMBj5tgpJv4lB2wEBTsrfM8dhELwpR8wNpa0/HFDPbqi0w3tsnXv46BoYGwqfr8eBqA5BQ0k9T1FEKCt9ZiNwFDWSWBd6ADrWJT6LlpfzR1ySZ9xjvvK5tbvBq0qhnMDiSYoYwC9vhnZVsEUJ3OPVxpJttXQ5rlVlLuQPmX2Wo0/1dF+JeOV5bLTrKkuYdJuTeb6d+60X6TEm0uTMvMqVhZd0lNmexi2SbQmUlOAM0p2Cfy9eJteWQIxD42mXXG++dFX6ANIxgbEVkFvLxmZWAYO/XGcE1dICOk64Rnb/x6UMFb7X7cj8U0dXfGs4pvQT/If5iJJr6jw9McTXBmEjb3FgIQtL2d8CQgbr4LLzkOLDvtfHgsfgsRld/cmxxSLdAT7IHkzPqBkcdGX9Yl+5l7CJQiXRCVCl5ASL/b5LW4BbmubXnVjrha/QlHxH248Vf5FyBFCgDeEGkepqHcgCYQ1CDMTNukm9eJaXmPWRi4bvRCJnkZQ8IVK4bfTFCZgQh1AKgjmz+FBYQOcXOI=",
                }
            }
        }, { parent: this });

        pulumi.output(args).apply(args => {
            // config should be persisted, so use stable for storage
            // jfs isn't a good fit as this will run on homelab with limited up
            // bw to S3
            const configPvc = args.serving.base.createLocalStoragePVC(`${name}-config`, {
                storageClassName: args.serving.base.localStableStorageClass.metadata.name,
                resources: {
                    requests: {
                        storage: "1Gi"
                    }
                }
            }, { parent: this });

            const pb = new kx.PodBuilder({
                restartPolicy: 'Always',
                containers: [
                    {
                        image: 'docker.io/shokoanime/server:latest',
                        env: {
                            'TZ': 'America/Los_Angeles',
                            // AVDump requires large dependencies and is not by
                            // default installed.
                            'AVDUMP_MONO': 'true',
                        },
                        envFrom: [
                            secrets.asEnvFromSource(),
                        ],
                        volumeMounts: [
                            args.pvc.mount('/media'),
                            configPvc.mount('/home/shoko/.shoko'),
                        ],
                        ports: [
                            { name: 'http', containerPort: 8111 },
                        ],
                        /* livenessProbe: this.configureProbe(), */
                        /* readinessProbe: this.configureProbe(), */
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

