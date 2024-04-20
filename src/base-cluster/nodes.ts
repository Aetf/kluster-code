import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { Node } from "#src/utils";

/**
 * List of known info about hosts
 */
const hosts = {
    AetfArchHomelab: {
        metadata: {
            labels: {
                'svccontroller.k3s.cattle.io/lbpool': 'homelan',
                'svccontroller.k3s.cattle.io/enablelb': 'true',
            }
        },
    } as k8s.core.v1.NodePatchArgs,
    AetfArchVPS: {
        metadata: {
            labels: {
                'svccontroller.k3s.cattle.io/lbpool': 'internet',
                'svccontroller.k3s.cattle.io/enablelb': 'true',
            }
        },
    } as k8s.core.v1.NodePatchArgs,
}

function createNode(name: string, args: k8s.core.v1.NodePatchArgs): Node {
    // Derive hostname from name
    // AetfArchVPS => aetf-arch-vps
    const hostname = name.split(/(?<=[a-z])(?=[A-Z])/).map(s => s.toLowerCase()).join('-');
    return new Node(hostname, {
        ...args,
        metadata: pulumi.output(args.metadata).apply(m => ({ ...m, name: hostname })),
    });
}

/**
 * Take a `Type`, change its property value type to `Value`, while keeping its
 * property key type unchanged.
 */
type MapValue<Type, Value> = {
    [Prop in keyof Type]: Value
}

function createNodes<T extends Record<string, k8s.core.v1.NodePatchArgs>>(nodesArgs: T): MapValue<T, Node> {
    type Return = MapValue<T, Node>;
    const nodes: Partial<Return> = {};
    for (const key in nodesArgs) {
        nodes[key] = createNode(key, nodesArgs[key]);
    }
    return nodes as Return;
}

export const nodes = createNodes(hosts);
export type Nodes = typeof nodes;
