import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BackendCertificate } from '#src/base-cluster';
import { NamespaceProbe, HelmChart, dedent } from "#src/utils";
import { Serving } from "#src/serving";

interface PrometheusArgs {
    serving: Serving,
    host: string,
}

export class Prometheus extends pulumi.ComponentResource<PrometheusArgs> {
    public readonly chart: HelmChart;
    public readonly certificate: BackendCertificate;

    constructor(name: string, args: PrometheusArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Prometheus', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.certificate = args.serving.base.createBackendCertificate(`${name}-server`, {
            namespace,
        }, { parent: this });

        this.chart = new HelmChart(name, {
            namespace,
            chart: "kube-prometheus-stack",
            values: {
                nameOverride: name,
                grafana: {
                    resources: {
                        requests: { cpu: "500m", memory: "512Mi" },
                        limits: { cpu: "500m", memory: "512Mi" },
                    },
                    testFramework: { enabled: false },
                },
                alertmanager: {
                    alertmanagerSpec: {
                        storage: {
                            volumeClaimTemplate: {
                                spec: {
                                    storageClassName: args.serving.base.localStorageClass.metadata.name,
                                    accessModes: ["ReadWriteOnce"],
                                    resources: {
                                        requests: {
                                            storage: "1Gi",
                                        }
                                    }
                                }
                            },
                        },
                    },
                },
                prometheus: {
                    prometheusSpec: {
                        storageSpec: {
                            volumeClaimTemplate: {
                                spec: {
                                    storageClassName: args.serving.base.localStorageClass.metadata.name,
                                    accessModes: ["ReadWriteOnce"],
                                    resources: {
                                        requests: {
                                            storage: "4Gi",
                                        }
                                    },
                                },
                            },
                        },
                    },
                },
                prometheusOperator: {
                    resources: {
                        requests: { cpu: "100m", memory: "128Mi" },
                        limits: { cpu: "200m", memory: "256Mi" },
                    },
                    admissionWebhooks: {
                        enabled: true,
                        certManager: {
                            enabled: true,
                            issuerRef: {
                                name: args.serving.base.rootIssuer.metadata.name,
                                kind: "ClusterIssuer",
                            }
                        }
                    },
                },
                "kube-state-metrics": {
                    resources: {
                        requests: { cpu: "10m", memory: "32Mi" },
                        limits: { cpu: "100m", memory: "64Mi" },
                    },
                },
                "prometheus-node-exporter": {
                    resources: {
                        requests: { cpu: "10m", memory: "32Mi" },
                        limits: { cpu: "200m", memory: "64Mi" },
                    },
                },
            },
        }, { parent: this });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: this.chart.service(new RegExp(`grafana`)),
            enableTls: false,
            enableAuth: true,
        });
    }
}
