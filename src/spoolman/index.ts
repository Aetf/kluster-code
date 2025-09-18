import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";
import * as crds from "#src/crds";
import { versions } from "#src/config";

interface SpoolmanArgs {
    serving: Serving,
    host: pulumi.Input<string>,
}

/**
 * Internal SMTP relay to consolidate email settings
 */
export class Spoolman extends pulumi.ComponentResource<SpoolmanArgs> {
    public port: pulumi.Output<number>;
    public address: pulumi.Output<string>;

    constructor(name: string, args: SpoolmanArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:spoolman', name, args, opts);

        this.port = pulumi.output(8000);

        const dataPv = args.serving.base.createLocalStoragePVC(`${name}`, {
            storageClassName: args.serving.base.jfsStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "1Gi"
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: versions.image.spoolman,
                resources: {
                    requests: { cpu: "10m", memory: "80Mi" },
                    //limits: { cpu: "10m", memory: "80Mi" },
                },
                ports: {
                    http: this.port,
                },
                volumeMounts: [
                    {
                        name: dataPv.metadata.name,
                        mountPath: "/home/app/.local/share/spoolman",
                        mountPropagation: "HostToContainer",
                    },
                ],
            }],
            volumes: [
                {
                    name: dataPv.metadata.name,
                    persistentVolumeClaim: {
                        claimName: dataPv.metadata.name,
                    },
                },
            ],
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
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/search": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            },
        });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            enableAuth: true,
            enableTls: false,
        });

        // Also a lan service without auth and proxy for printers to connect
        // directly
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
                ports: [
                    { name: 'http', port: this.port, },
                ],
                allocateLoadBalancerNodePorts: false,
                selector: {
                    app: name,
                },
            },
        }, { parent: this, deleteBeforeReplace: true });

        this.address = pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`;
    }
}
