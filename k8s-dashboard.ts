import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BackendCertificate } from '#src/base-cluster';
import { NamespaceProbe, HelmChart } from "#src/utils";
import { Serving } from "#src/serving";

interface K8sDashboardArgs {
    serving: Serving,
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
            version: "4.3.1",
            fetchOpts: {
                repo: "https://kubernetes.github.io/dashboard",
            },
            values: {
                // override the service name auto generated by the chart (in its _helpers.tpl)
                fullnameOverride: name,

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
                ]
            }
        }, { parent: this });

        args.serving.createFrontendService(name, {
            host: 'k8s.unlimited-code.works',
            targetService: this.chart.service.apply(s => s!),
            enableAuth: true,
        }, { parent: this });
    }
}
