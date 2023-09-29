import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from '#src/base-cluster';
import { SealedSecret, ConfigMap, serviceFromDeployment } from "#src/utils";

interface HathArgs {
    base: BaseCluster,
    storageClassName: pulumi.Input<string>,
}

/**
 * Hath@Home
 */
export class Hath extends pulumi.ComponentResource<HathArgs> {

    constructor(name: string, args: HathArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Hath', name, args, opts);

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    client_login: "AgClcYmu99AVzk4fbx0oNsoAakNqODAOaHSCND8WOQKBSQIgMHx0cbvoAd8meRSHJ03mfoDmFTmsCzh2WI/tlJaJIFUiMUnfoRIB/ZrQ+XQiBWR1dP6j9s0V1Wk1iKpRv1RurunvQio94wLDm76+SOL7x8KZA2XL/nvdgrfLwM34jS2QfY+7szn9/aq/en5pH+cbhhJZlZmD5wBjWVKgBy0L2GH4W3NPWi51cXRqI0a87fN08wf725ud1l1XVVC/qCDr1w6s4Ze+D/xj5yqGsAsOP3VCCIQp34fLXSlGZuJ4CppJUQlQRJyhCGsmBAKYynydedx0NfVaU9X8MS6sgsGVuw4uv2QL+/f5LP8HXWffDKmaKinWzr01jQmXNFISmR5DwwnlBRgdPUUb/lSX1PW60rYvnZfl7d36QLQF5nRdUESvG07Hin7gawqvdXdt2vp+bySHQx9W4b38JwAHNKOaiTeGZagQ8ZVeEhCeanw4TWZuhjq2uu+pDBu5VrP8pBDccO8wFEaiyW82ms8KhMreho5pnGHsJOwVkCHQTGvSxMalmGtTs1oLxiFRvUsGv5R/A4pGhjfC4OBtDlYxQsq8V4zE3HhYGHiobx3bmFH5yOoJqI16ADDOUm+AmTEabURSeEK4ekgpSudS/tIWcAC0EjjQYhBqo+2GIYqXp9VfmLWailRs9lPUOHMjEwo/hjc3P8jWdm+WSpsDAC3un8kz7QOWogk4kSiiKQ==",
                }
            }
        }, { parent: this });

        // configmap for entrypoint script
        const cm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
        }, { parent: this });

        const pvc = args.base.createLocalStoragePVC(`${name}`, {
            storageClassName: args.storageClassName,
            resources: {
                requests: {
                    storage: "50Gi"
                }
            }
        }, { parent: this, retainOnDelete: true });

        const port = 60011;
        const hathPrefix = '/hath';
        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            // Hath need to time to shut down gracefully, give it 5min
            terminationGracePeriodSeconds: 300,
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
                image: 'docker.io/tdcpf/hath:v1.6.2',
                ports: {
                    hath: port,
                },
                // will exec hath jar
                command: [
                    '/bin/ash',
                    '/entrypoint.sh',
                    '--',
                ],
                // Hath jar arguments: https://ehwiki.org/wiki/Hentai@Home#Software
                args: [
                    // Hath will see IP address from servicelb daemonset, not
                    // the original IP, so disable the check.
                    '--disable-ip-origin-check',
                    // explicitly set every dir path
                    ...[
                        'data', 'cache', 'log', 'temp', 'download',
                    ].map(d => `--${d}-dir=${hathPrefix}/${d}`),
                ],
                env: {
                    HatH_PORT: `${port}`,
                },
                envFrom: [
                    // secrets.asEnvFromSource(),
                ],
                volumeMounts: [
                    pvc.mount(hathPrefix),
                    secrets.mount(`${hathPrefix}/data/client_login`, 'client_login'),
                    cm.mount('/entrypoint.sh', 'entrypoint.sh'),
                ],
                startupProbe: {
                    tcpSocket: {
                        port,
                    },
                    failureThreshold: 3,
                    periodSeconds: 10,
                },
                livenessProbe: {
                    tcpSocket: {
                        port,
                    },
                    failureThreshold: 1,
                    periodSeconds: 60,
                },
            }]
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });
        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
                labels: {
                    'svccontroller.k3s.cattle.io/lbpool': 'internet',
                },
            },
            spec: {
                type: "LoadBalancer",
            },
        });
    }
}
