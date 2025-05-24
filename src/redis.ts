import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { Service, HelmChart } from "./utils";

export interface RedisArgs {
    persistentStorageClass: pulumi.Input<string>,
    namespace: pulumi.Input<string>,
    password: pulumi.Input<Omit<k8s.types.input.core.v1.SecretKeySelector, 'optional'>>,
    size?: pulumi.Input<string | undefined>,
    resources?: k8s.types.input.core.v1.ResourceRequirements,
}

export class Redis extends HelmChart {
    public readonly masterService: pulumi.Output<Service>;
    private authPassword: pulumi.Output<k8s.types.input.core.v1.SecretKeySelector>;

    constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
        const authPassword = pulumi.output(args.password);
        super(name, {
            namespace: args.namespace,
            chart: 'redis',
            values: {
                global: {
                    storageClass: args.persistentStorageClass,
                },
                architecture: "standalone",
                auth: {
                    usePasswordFiles: true,
                    existingSecret: authPassword.name,
                    existingSecretPasswordKey: authPassword.key,
                },
                master: {
                    persistence: {
                        size: args.size
                    },
                    resources: args.resources ?? {
                        requests: { memory: "64Mi", cpu: "50m" },
                        limits: { memory: "64Mi", cpu: "50m" },
                    },
                }
            }
        }, opts);
        this.masterService = this.service(/master/);
        this.authPassword = authPassword;
    }

    public get servicePassword(): pulumi.Output<k8s.types.input.core.v1.SecretKeySelector> {
        return this.authPassword;
    }
}
