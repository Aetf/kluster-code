import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster, ClusterCertificate, NodePV } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";
import * as crds from "#src/crds";
import { versions } from "#src/config";
import { juicefsColocationAffinity } from "#src/juicefs";

interface DufsArgs {
    serving: Serving,
    host: pulumi.Input<string>,
}

/**
 * Internal SMTP relay to consolidate email settings
 */
export class Dufs extends pulumi.ComponentResource<DufsArgs> {
    public port: pulumi.Output<number>;
    public address: pulumi.Output<string>;

    constructor(name: string, args: DufsArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:dufs', name, args, opts);
        this.port = pulumi.output(5000);

        const webdavPV = args.serving.base.createLocalStoragePVC(`${name}`, {
            storageClassName: args.serving.base.jfsStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "50Gi"
                }
            }
        }, { parent: this });

        const cert = args.serving.base.createBackendCertificate(name, {
            namespace: pulumi.output(webdavPV.metadata).apply(md => md.namespace!)
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: versions.image.dufs,
                resources: {
                    // dufs terminates TLS itself, and a handshake needs far more
                    // than the 1ms/100ms slice a 10m cap allows: with cpu limit ==
                    // request the container sat at 100% throttled periods and even
                    // the TLS handshake took ~8s, blowing past the gateway timeout.
                    // Page cache from serving files counts against the memory limit
                    // too, so 8Mi left no headroom.
                    requests: { cpu: "10m", memory: "32Mi" },
                    limits: { cpu: "500m", memory: "128Mi" },
                },
                ports: {
                    https: this.port,
                },
                args: [
                    pulumi.interpolate`--port=${this.port}`,
                    "--allow-all", // allow all operations
                    "--tls-cert=/tls/tls.crt",
                    "--tls-key=/tls/tls.key",
                    "/files"
                ],
                volumeMounts: [
                    cert.mount('/tls'),
                    // webdavPV.mount('/files'),
                    {
                        name: webdavPV.metadata.name,
                        mountPath: "/files",
                        mountPropagation: "HostToContainer",
                    },
                ],
            }],
            volumes: [
                {
                    name: webdavPV.metadata.name,
                    persistentVolumeClaim: {
                        claimName: webdavPV.metadata.name,
                    },
                },
            ],
            affinity: juicefsColocationAffinity(),
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
            enableBasicAuth: true,
            backendCert: cert,
        });

        this.address = pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`;
    }
}
