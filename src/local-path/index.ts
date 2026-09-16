import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { ConfigMap, setAndRegisterOutputs } from "#src/utils";
import { versions } from "#src/config";

interface LocalPathProvisionerArgs {
    storageClass: string,
    // Node directory behind `storageClass` and its `-stable` twin.
    path: string,
    // A third class whose volumes may be written to without limit: its
    // directory sits on a disk that carries nothing latency-sensitive, so a
    // tenant filling it (CI runners building images and cargo targets) cannot
    // starve etcd on the root nvme. local-path enforces no size at all -- the
    // PVC request is a declaration -- so the directory is expected to be a
    // dataset with its own quota.
    scratchStorageClass: string,
    scratchPath: string,
}

export default class LocalPathProvisioner extends pulumi.ComponentResource<LocalPathProvisionerArgs> {
    public readonly service_account: k8s.core.v1.ServiceAccount;
    public readonly deployment: kx.Deployment;
    public readonly storageClass: k8s.storage.v1.StorageClass;
    public readonly storageClassStable: k8s.storage.v1.StorageClass;
    public readonly storageClassScratch: k8s.storage.v1.StorageClass;

    public readonly provisionerName!: pulumi.Output<string>;
    public readonly storageClassName!: pulumi.Output<string>;

    constructor(name: string, args: LocalPathProvisionerArgs, opts?: pulumi.ComponentResourceOptions) {
        super("kluster:LocalPathProvisioner", name, args, opts);

        this.service_account = this.setupRBAC(name);

        this.storageClass = new k8s.storage.v1.StorageClass(args.storageClass, {
            provisioner: pulumi.interpolate`cluster.local/${this.service_account.metadata.name}`,
            volumeBindingMode: "WaitForFirstConsumer",
            reclaimPolicy: "Delete",
        }, { parent: this });

        this.storageClassStable = new k8s.storage.v1.StorageClass(`${args.storageClass}-stable`, {
            provisioner: pulumi.interpolate`cluster.local/${this.service_account.metadata.name}`,
            volumeBindingMode: "WaitForFirstConsumer",
            reclaimPolicy: "Retain",
        }, { parent: this });

        // Named explicitly, unlike its siblings: the consumers are helm
        // releases outside pulumi (docker/gha-runner-values.yaml) that must
        // spell the class name.
        this.storageClassScratch = new k8s.storage.v1.StorageClass(args.scratchStorageClass, {
            metadata: { name: args.scratchStorageClass },
            provisioner: pulumi.interpolate`cluster.local/${this.service_account.metadata.name}`,
            volumeBindingMode: "WaitForFirstConsumer",
            reclaimPolicy: "Delete",
        }, { parent: this });

        this.deployment = this.setupDeployment(name, args);

        setAndRegisterOutputs(this, {
            storageClassName: this.storageClass.metadata.name,
            provisionerName: this.storageClass.provisioner,
        });
    }

    protected async initialize(args: pulumi.Inputs): Promise<LocalPathProvisionerArgs> {
        return args as LocalPathProvisionerArgs;
    }

    private setupRBAC(name: string): k8s.core.v1.ServiceAccount {
        const service_account = new k8s.core.v1.ServiceAccount(name, {}, { parent: this });
        const cluster_role = new k8s.rbac.v1.ClusterRole(name, {
            rules: [{
                apiGroups: [""],
                // pods/log: the provisioner surfaces the helper pod's output
                // when setup/teardown fails.
                resources: ["nodes", "persistentvolumeclaims", "configmaps", "pods/log"],
                verbs: ["get", "list", "watch"],
            }, {
                apiGroups: [""],
                resources: ["endpoints", "persistentvolumes", "pods"],
                verbs: ["*"],
            }, {
                apiGroups: [""],
                resources: ["events"],
                verbs: ["create", "patch"],
            }, {
                apiGroups: ["storage.k8s.io"],
                resources: ["storageclasses"],
                verbs: ["get", "list", "watch"],
            }]
        }, { parent: this });
        new k8s.rbac.v1.ClusterRoleBinding(name, {
            roleRef: {
                apiGroup: "rbac.authorization.k8s.io",
                kind: "ClusterRole",
                name: cluster_role.metadata.name,
            },
            subjects: [
                {
                    kind: "ServiceAccount",
                    name: service_account.metadata.name,
                    namespace: service_account.metadata.namespace,
                },
            ]
        }, { parent: this });
        return service_account;
    }

    private setupDeployment(name: string, args: LocalPathProvisionerArgs): kx.Deployment {
        // Paths are keyed per StorageClass (storageClassConfigs) rather than
        // listed together under nodePathMap: with several paths there the
        // provisioner picks one at random for any class that does not pin
        // itself with a `nodePath` parameter, and parameters are immutable on
        // the two classes that already exist.
        const cm = new ConfigMap(name, {
            ref_file: __filename,
            data: 'static/*',
            stripComponents: 1,
            tplVariables: {
                storageClass: this.storageClass.metadata.name,
                storageClassStable: this.storageClassStable.metadata.name,
                storageClassScratch: this.storageClassScratch.metadata.name,
                path: args.path,
                scratchPath: args.scratchPath,
            },
        }, { parent: this });

        const pb = new kx.PodBuilder({
            serviceAccountName: this.service_account.metadata.name,
            containers: [{
                name: "local-path-provisioner",
                image: versions.image.localpath,
                command: [
                    "local-path-provisioner",
                    "--debug",
                    "start",
                    "--configmap-name", cm.metadata.name,
                ],
                env: {
                    PROVISIONER_NAME: this.storageClass.provisioner,
                    POD_NAMESPACE: {
                        fieldRef: {
                            fieldPath: "metadata.namespace"
                        }
                    },
                    SERVICE_ACCOUNT_NAME: {
                        fieldRef: {
                            fieldPath: "spec.serviceAccountName"
                        }
                    }
                },
                volumeMounts: [cm.mount("/etc/config")]
            }]
        });
        return new kx.Deployment(name, {
            spec: pb.asDeploymentSpec()
        }, { parent: this });
    }
}
