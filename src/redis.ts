import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { HelmChart } from "./utils";

export interface RedisArgs {
    persistentStorageClass: pulumi.Input<string>,
    namespace: pulumi.Input<string>,
    password: pulumi.Input<Omit<k8s.types.input.core.v1.SecretKeySelector, 'optional'>>,
    size?: pulumi.Input<string | undefined>
}

export class Redis extends HelmChart {
    public readonly redisService: pulumi.Output<k8s.core.v1.Service>;
    private authPassword: pulumi.Output<k8s.types.input.core.v1.SecretKeySelector>;

    constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
        const authPassword = pulumi.output(args.password);
        super(name, {
            namespace: args.namespace,
            chart: 'redis',
            version: "17.4.1",
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
        this.redisService = this.service(/master/);
        this.authPassword = authPassword;
    }

    public get serviceHost(): pulumi.Output<string> {
        return this.redisService.metadata.name;
    }

    public get servicePort(): pulumi.Output<number> {
        return this.redisService.spec.ports.apply(ports => ports.find(port => port.name == 'tcp-redis')?.port ?? 6379);
    }

    public get servicePassword(): pulumi.Output<k8s.types.input.core.v1.SecretKeySelector> {
        return this.authPassword;
    }
}
