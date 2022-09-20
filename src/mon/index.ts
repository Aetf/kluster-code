import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BackendCertificate } from '#src/base-cluster';
import { NamespaceProbe, HelmChart } from "#src/utils";
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

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        this.chart = new HelmChart(name, {
            namespace,
            chart: "prometheus",
            version: "15.12.2",
            fetchOpts: {
                repo: "https://prometheus-community.github.io/helm-charts",
            },
            values: {
                nameOverride: name,
                alertmanager: {
                    persistentVolume: {
                        storageClass: args.serving.base.localStorageClass.metadata.name
                    }
                },
                server: {
                    name: "server",
                    // the schema prefix is necessary, otherwise prometheus
                    // intepretates the setting as a url prefix, not hostname.
                    baseURL: 'https://' + args.host,
                    // enable TLS directly on Prometheus
                    extraArgs: {
                        'web.config.file': '/etc/config/web.config.yml',
                    },
                    // mount per pod tls cert
                    extraSecretMounts: [
                        {
                            name: 'tls',
                            mountPath: '/tls',
                            secretName: this.certificate.secretName,
                            readOnly: true
                        },
                    ],
                    // the probe endpoint also needs to be HTTPS now
                    probeScheme: 'HTTPS',
                    // make the service listen on 443 rather than 80
                    service: {
                        servicePort: 443,
                    },
                    // storage
                    persistentVolume: {
                        storageClass: args.serving.base.jfsStorageClass.metadata.name
                    },
                    // with rolling update, the old ReplicaSet is kept before
                    // creating new one, causing lock issue on the storage
                    strategy: {
                        type: 'Recreate',
                    },
                    // enable restart on cert change
                    podAnnotations: {
                        "reloader.stakater.com/search": "true"
                    },
                },
                serverFiles: {
                    "web.config.yml": {
                        "tls_server_config": {
                            cert_file: "/tls/tls.crt",
                            key_file: "/tls/tls.key",
                        },
                    },
                },
                extraScrapeConfigs: `
                - job_name: prometheus-secure
                  scheme: https
                  tls_config:
                    ca_file: /tls/ca.crt
                  static_configs:
                  - targets:
                    - localhost:9090
                `
            },
        }, { parent: this });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: this.chart.service(new RegExp(`${name}-server$`)),
            enableAuth: true,
        });
    }
}
