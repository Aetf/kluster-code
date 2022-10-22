import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

export { BaseCluster } from "./base";
export { FrontendCertificate, BackendCertificate, ClusterCertificate } from "./certs";

interface NodePVArgs {
    path: pulumi.Input<string>,
    node: pulumi.Input<string>,
    capacity: pulumi.Input<string>,
    accessModes?: pulumi.Input<pulumi.Input<string>[]>,
}

/**
 * A static PV with matching PVC that is bond to a specific node host path.
 * Note that PV to PVC bound is 1:1, but a PVC can be mounted by multiple
 * pods depending on access mode.
 */
export class NodePV extends pulumi.ComponentResource<NodePVArgs> {
    public pvc: kx.PersistentVolumeClaim;

    constructor(name: string, args: NodePVArgs, opts?: pulumi.CustomResourceOptions) {
        super("kluster:BaseCluster:NodePV", name, args, opts);

        const pv = new k8s.core.v1.PersistentVolume(name, {
            spec: {
                capacity: {
                    storage: args.capacity,
                },
                accessModes: args.accessModes ?? ['ReadOnlyMany', 'ReadWriteOnce', 'ReadWriteMany'],
                persistentVolumeReclaimPolicy: 'Retain',
                storageClassName: "",
                local: {
                    path: args.path,
                },
                nodeAffinity: {
                    required: {
                        nodeSelectorTerms: [{
                            matchExpressions: [{
                                key: 'kubernetes.io/hostname',
                                operator: 'In',
                                values: [args.node],
                            }]
                        }]
                    }
                }
            }
        }, { parent: this });
        this.pvc = new kx.PersistentVolumeClaim(name, {
            spec: {
                accessModes: args.accessModes ?? ["ReadWriteOnce"],
                resources: {
                    requests: {
                        storage: args.capacity,
                    }
                },
                storageClassName: "",
                volumeName: pv.metadata.name,
            }
        }, { parent: this });
    }

    public get name(): pulumi.Output<string> {
        return this.pvc.metadata.name;
    }

    protected async initialize(args: pulumi.Inputs): Promise<NodePVArgs> {
        return args as NodePVArgs;
    }

    public mount(destPath: pulumi.Input<string>, srcPath?: pulumi.Input<string>): pulumi.Output<kx.types.VolumeMount> {
        return this.pvc.mount(destPath, srcPath);
    }
}
