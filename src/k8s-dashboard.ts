import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BackendCertificate } from '#src/base-cluster';
import { NamespaceProbe, HelmChart } from "#src/utils";
import { Serving } from "#src/serving";

interface K8sDashboardArgs {
    serving: Serving,
    host: string,
}

export class K8sDashboard extends pulumi.ComponentResource<K8sDashboardArgs> {
    public readonly chart: HelmChart;
    public readonly certificate: BackendCertificate;

    constructor(name: string, args: K8sDashboardArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:K8sDashboard', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        this.chart = new HelmChart(name, {
            namespace,
            chart: "kubernetes-dashboard",
            values: {
                // override the service name auto generated by the chart (in its _helpers.tpl)
                fullnameOverride: name,

                resources: {
                    requests: { cpu: "15m", memory: "128Mi" },
                    limits: { cpu: "100m", memory: "128Mi" },
                },

                // enable restart on cert change
                annotations: {
                    "reloader.stakater.com/search": "true"
                },

                // metrics scraper to show metrics in dashboard
                metricsScraper: {
                    enabled: true
                },

                // we'll create Ingress resource ourselves
                ingress: {
                    enabled: false
                },

                // mount per pod tls cert
                extraVolumes: [
                    {
                        name: "tls",
                        secret: {
                            secretName: this.certificate.secretName
                        }
                    }
                ],
                extraVolumeMounts: [
                    {
                        name: "tls",
                        mountPath: "/tls"
                    }
                ],

                // use the mounted cert
                extraArgs: [
                  "--auto-generate-certificates=false",
                  "--default-cert-dir=/tls",
                  "--tls-cert-file=tls.crt",
                  "--tls-key-file=tls.key",
                ],
            }
        }, { parent: this });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: this.chart.service(),
            enableAuth: true,
        });
    }
}
