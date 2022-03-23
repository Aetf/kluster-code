import * as _ from "lodash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { ConfigMap, setAndRegisterOutputs } from "#src/utils";

interface LocalPathProvisionerArgs {
    storageClass: string,
}

export default class LocalPathProvisioner extends pulumi.ComponentResource<LocalPathProvisionerArgs> {
    public readonly service_account: k8s.core.v1.ServiceAccount;
    public readonly deployment: kx.Deployment;
    public readonly storageClass: k8s.storage.v1.StorageClass;

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

        this.deployment = this.setupDeployment(name);

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
                resources: ["nodes", "persistentvolumeclaims", "configmaps"],
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

    private setupDeployment(name: string): kx.Deployment {
        const cm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
        }, { parent: this });

        const pb = new kx.PodBuilder({
            serviceAccountName: this.service_account.metadata.name,
            containers: [{
                name: "local-path-provisioner",
                image: "rancher/local-path-provisioner:v0.0.21",
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
