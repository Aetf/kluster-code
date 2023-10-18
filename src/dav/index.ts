import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster, ClusterCertificate, NodePV } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";
import * as crds from "#src/crds";
import { versions } from "#src/config";

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
            affinity: {
                podAffinity: {
                    // This is a hack to run the pod on the same node as juicefs
                    // redis master, because otherwise the metadata server
                    // performance is very bad.
                    requiredDuringSchedulingIgnoredDuringExecution: [
                        {
                            topologyKey: 'kubernetes.io/hostname',
                            labelSelector: {
                                matchLabels: {
                                    'app.kubernetes.io/instance': 'juicefs-redis',
                                    'app.kubernetes.io/component': 'master',
                                }
                            },
                            namespaces: ['kube-system']
                        }
                    ]
                },
            },
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
        });

        this.address = pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`;
    }
}
