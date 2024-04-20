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

        const alertpvc = args.serving.base.createLocalStoragePVC(`${name}-alertmanager`, {
            storageClassName: args.serving.base.localStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "2Gi"
                }
            }
        }, { parent: this, });
        const pvc = args.serving.base.createLocalStoragePVC(name, {
            storageClassName: args.serving.base.localStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "4Gi"
                }
            }
        }, { parent: this, });

        this.chart = new HelmChart(name, {
            namespace,
            chart: "prometheus",
            version: "15.12.2",
            values: {
                nameOverride: name,
                alertmanager: {
                    persistentVolume: {
                        existingClaim: alertpvc.metadata.name,
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
                    // enable restart on cert change
                    deploymentAnnotations: {
                        "reloader.stakater.com/search": "true"
                    },
                    // the probe endpoint also needs to be HTTPS now
                    probeScheme: 'HTTPS',
                    // make the service listen on 443 rather than 80
                    service: {
                        servicePort: 443,
                    },
                    // storage
                    persistentVolume: {
                        existingClaim: pvc.metadata.name,
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
                extraScrapeConfigs: pulumi.all([namespace]).apply(([ns]) => {
                    return dedent`
                    - job_name: prometheus-secure
                      scheme: https
                      tls_config:
                        ca_file: /tls/ca.crt
                      static_configs:
                      - targets:
                        - ${name}-server.${ns}
                    `;
                })
            },
        }, { parent: this });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: this.chart.service(new RegExp(`${name}-server$`)),
            enableAuth: true,
        });
    }
}
