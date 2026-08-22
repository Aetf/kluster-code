import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from "#src/base-cluster";
import { Node } from "#src/utils";
import { versions } from "#src/config";

interface GoLinksArgs {
    base: BaseCluster,
    node: Node,
}

/**
 * kellegous/go: go/<name> shortlinks with a web UI at go/edit/<name>.
 *
 * LAN-only: the UDM caddy terminates TLS for go.lan.ucw.phd (and redirects
 * the bare `go` hostname there) and proxies to the homelan LoadBalancer
 * below. No public FrontendService and no auth -- anyone on the LAN can
 * edit links. Links live in a leveldb directory on a small stable PVC.
 */
export class GoLinks extends pulumi.ComponentResource<GoLinksArgs> {
    public readonly port: pulumi.Output<number>;

    constructor(name: string, args: GoLinksArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:GoLinks', name, args, opts);

        this.port = pulumi.output(8067);

        const dataPv = args.base.createLocalStoragePVC(name, {
            storageClassName: args.base.localStableStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "1Gi"
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            // Keep the pod (and thus its local-path PV) on the homelab node:
            // LAN traffic enters through this node's svclb and should not
            // detour over ZeroTier to the vps.
            nodeSelector: args.node.hostnameSelectorLabels,
            containers: [{
                name,
                image: versions.image.golinks,
                args: [
                    "--data=/data",
                    // Generated source URLs display as go/<name> rather than
                    // whatever Host header the request came in on.
                    "--host=go",
                ],
                resources: {
                    requests: { cpu: "5m", memory: "32Mi" },
                },
                ports: {
                    http: 8067,
                },
                volumeMounts: [
                    {
                        name: dataPv.metadata.name,
                        mountPath: '/data',
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
        });

        const deployment = new kx.Deployment(name, {
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        // LAN-only service; the UDM caddy reverse-proxies to this port on
        // the homelab node.
        new kx.Service(`${name}-lan`, {
            metadata: {
                name: `${name}-lan`,
                labels: {
                    'svccontroller.k3s.cattle.io/lbpool': 'homelan',
                },
                annotations: {
                    'pulumi.com/skipAwait': 'true',
                }
            },
            spec: {
                type: 'LoadBalancer',
                ports: [
                    { name: 'http', port: 8067, },
                ],
                allocateLoadBalancerNodePorts: false,
                selector: {
                    app: name,
                },
            },
        }, { parent: this, deleteBeforeReplace: true });
    }
}
