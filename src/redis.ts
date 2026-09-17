import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { Service, HelmChart } from "./utils";
import { versions } from "#src/config";

// Split a `registry/repository:tag` reference into the three fields bitnami
// charts take instead of a single image string.
function bitnamiImage(ref: string): { registry: string, repository: string, tag: string } {
    const [name, tag] = ref.split(':');
    const [registry, ...repository] = name.split('/');
    return { registry, repository: repository.join('/'), tag };
}

export interface RedisArgs {
    persistentStorageClass: pulumi.Input<string>,
    namespace: pulumi.Input<string>,
    password: pulumi.Input<Omit<k8s.types.input.core.v1.SecretKeySelector, 'optional'>>,
    size?: pulumi.Input<string | undefined>,
    resources?: k8s.types.input.core.v1.ResourceRequirements,
    // Run the bitnami redis_exporter sidecar and let kube-prometheus-stack
    // scrape it. Off by default: most users of this component are small
    // session stores nobody needs a dashboard for.
    metrics?: boolean,
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
                // The chart's default tags 404 on docker.io/bitnami; both
                // images are pinned in Pulumi.dev.yaml (see the note there).
                image: bitnamiImage(versions.image.redis),
                metrics: {
                    enabled: args.metrics ?? false,
                    image: bitnamiImage(versions.image.redisExporter),
                    serviceMonitor: {
                        enabled: args.metrics ?? false,
                        // kube-prometheus-stack's serviceMonitorSelector only
                        // matches its own release label.
                        additionalLabels: { release: "prometheus" },
                    },
                    resources: {
                        requests: { memory: "32Mi", cpu: "10m" },
                        limits: { memory: "64Mi", cpu: "50m" },
                    },
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
