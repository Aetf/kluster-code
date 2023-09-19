import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { Service, HelmChart } from "./utils";

export interface RedisArgs {
    persistentStorageClass: pulumi.Input<string>,
    namespace: pulumi.Input<string>,
    password: pulumi.Input<Omit<k8s.types.input.core.v1.SecretKeySelector, 'optional'>>,
    size?: pulumi.Input<string | undefined>
}

export class Redis extends HelmChart {
    public readonly masterService: pulumi.Output<Service>;
    private authPassword: pulumi.Output<k8s.types.input.core.v1.SecretKeySelector>;

    constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
        const authPassword = pulumi.output(args.password);
        super(name, {
            namespace: args.namespace,
            chart: 'redis',
            version: "18.0.1",
            fetchOpts: {
                repo: "https://charts.bitnami.com/bitnami",
            },
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
                    }
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
