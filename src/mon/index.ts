import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import * as crds from "#src/crds";

import { BackendCertificate } from '#src/base-cluster';
import { NamespaceProbe, HelmChart, SealedSecret, Service } from "#src/utils";
import { Serving } from "#src/serving";

interface PrometheusArgs {
    serving: Serving,

    domain: pulumi.Input<string>,
    subdomain: pulumi.Input<string>,
    authSubdomain: pulumi.Input<string>,

    smtp: pulumi.Input<Service>,
    // where warning and critical alerts are mailed to
    alertEmail: pulumi.Input<string>,
    // HAOS, which turns critical alert webhooks into phone pushes
    haos: pulumi.Input<Service>,
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

        const secrets = new SealedSecret(`${name}-grafana-oauth`, {
            spec: {
                encryptedData: {
                    "oauth_client_id": "AgCN/RF/j7JoN93bMVfL34KHbWB0gBDp+Scko4YPNYIuVUen4rsTw3KvuB6ZSvbK19EwdnLdz7PHgJDpmlxyxW/3kyRQVmdxByyeYiC7Bt3YPBrYP8Z5snkHGq8tUSEeUFpGNpHsSTLq+37wVQkhyCVfbvmqC//f7VUsdWvlNnXajAFwSRgYZmT12ShlHf9Y7yYbx1a72PWE3wiJm4w1Mu85vfa/YckRaoJX6KRPo2NxZ5dqtBot0WQ6Ic7kcf05giAzND3zseROzZLR+mTDpotZ5uzA97gNzz0dUGay1l5mDdoCIkMXnc4v1ytiMzsC0JhfTDkX9E1jbMATKQe2Tfq+IHaBc+lvYOTvQq9V6Yf4VQ/IeBMbdIwP7paTN8pHBZ/Vb5aT92L/RbX2MLI1iRaucMqXgVnUSg5F+VZjIZ41lCPgSNpA7kKazl3pRcmnj6y60s+Y6EclgcgfSlaWgQqrTKQ1rNC8gVnAWW8Kr9lQ7OcOfnQP4NWTa0U+xyVl8oXhiFF9y8uQeA1QLzTWPxOHu2nWdxRM4ykV4wQQPGfFsQ899WIbydIRihzmw+m4g5ZS4xta0DOnmpXe2JgbsbDnAJwbCVktkRWkcde948G4J7JqxbckOs+lTWVBuqYhZEx8zyDdkULPJTOnfg4EuUJVx/zInpYUYPMTwOxYFDZRj8adwzkhxeOSGfBqdXME9VEUxt2iVlWSFWtKLzfRagLKwkVUnFlw1iGt7sx/qJlln5Rd6j9Zmpph+3H76lOUdb9EXe6Z0gl/gW/t4w7GsjeJ+TW8yzRZ5t8=",
                    "oauth_client_secret": "AgCM3dLrDTbIzps4tnpmV0uPHFMC+/ZWf6fKpEW+DUQIBw2NkgBCiW0JNfAvSqdevvjV1M3zgqGRSdy19xdqD1MlZejGD6rn+cHNtSx8ZK1ICNwD4TsmIPl1wvdQlqwzOjucGXbi2oB0t7afO2m/zk6Nek3x83qX8xdMT6lFXyk1GuD8CucSzHjlhRkmo+wkscd55NHjnuzy1UX4wKKjL33JJ7s3LbCeX2C7079vKSQKLpqgTDI12pPqtBI7RR9Z4xfHdxni913vxFgcM8AqfugMIBXskO68m2Kg983iJXtFiszaj9k/LtJjov1JgZX8WAPWH6FqMkmMTHnKxSrKEXoviqsl/EY5qLTzQGPjrSJa7o8JFwmV6ncwPNzEhvICJXiMe4JsJcJkCdCE4Rc7m/P82Ij9KC1ly8dFIHNflsWttcO+HQNT2QkDoBs1cmY00owl0lGYrAAZWodjz1hZsIUdsZFF2Khl0Eo5uUVSmm58CuaZ51KayZQLrd70K9uF1zZv5Ngu+9tzQ5yVreA3r9Ug9IRnpjCVxYairfoO9Haz8uPrKE4qJz6c1HLm0I7sYXRubmaWMnsJe4bwYejSoND82uIZcn/tXaawXDXFXeAS/MekzpAbZ8MO+3sbjQeTpeg6pyi6WmOZzI6LcyethUGCoucdjQinQqtD7BZnl58iRuijqqDGx+POH/fsTtFgh+i3py9z50ho3wy5ko3SkvJTsrmokryXoLaP40LsnpX6q3voa9djNJiDGxXDJOUtaWplgDI6VUlI72sJsWE7pkSwo3jJveGbe5E=",
                }
            }
        }, { parent: this });

        const adminSecrets = new SealedSecret(`${name}-grafana-admin`, {
            spec: {
                template: {
                    type: "kubernetes.io/basic-auth",
                },
                encryptedData: {
                    username: "AgAYc2qB7J9+C0bDW7Icy3T9ETnsMtv14CbZ2KgePmb8OxfMIV7PPvV2zIg6AU6GhRuilq9UqC7JBjwc/3XQwEFo4pivbkoYS4OeT5XqECZU8ksYKH1VlbqdLc8A8s6Ly90BKZIVQ7YhP1FW67qbxrsyxhgK9Smx2ets6gTUObX1P2yrCnFlgYerGBvwfQ0vwTksvaFeF7Opf2PrcVNF5xHdthGjvtT/bHCXCRr9TrRVJcXv2oGWC19HFAZGC3GrLcBaofhY7K/nTYb/lwllgXB+FSE2S/7WfixnnlhrAcZty7S755VxeZakHyC28n2qin31hTe2q6GjYHTFmxO7yq4/eSfAa760O/mhMil5KIScvU2jpPKnpbZ/DnHuae7sZCZpoEUc5o+LGgDK+k7xBhX2ZLS66R1WkCkEJjjzIPSXjrmAxiL1dS2kAApXb8nlGJLFHPQRQCIByO9MyJFHvBWRFLBpYEWObBF5KVsMiB0oMb+9s+5ceoJExhYnzFxh+j2AH3ska5DtkR5Zpc1lvq6GmhJENiaX2ecEUyO76D/nN/uVZ2Z6LqIrXWzl+fPBCQJJTrGVFE6FPL7VDyJxS9SxOoNJpGdUDA9i4/3BpiqEIinGlSeaWCctFw3+Vz3DhGW6ly4nDnmv0Q3hYxz3EKpwSjmoaBZ0P6h0txRxcz1RzYDAnyuQwb7TeNfZf6hJn7akAQwT729SzHiriIue",
                    password: "AgBhD2IeokaDTTcspIstqkTdZbntpjyYTv8VdUZ49vVgySCwh7pSQFWMLGH+H6YlTryqIPFh/uxjZMP/t44yEWPJnW1A2kGmNaWTr60wM8sa76rXPYWyP0ss2/Aq7F+B43YBO7EwuNwWCi4BE5VI8a0NLX21f15+Ceh/TnZbswxC8mXo6SK3lGv0banrNgtXCPsp4Emw9ODKFyjgu3uwOeoFe4uJfWx4Zw8o/Wl2Sw4F+O1C2pOVQLdJ73frJF0xl6e9gf/4Jf+TDTr9temXguKbYhoeRtCtyl5eag+oDgRuQITCHwaMCjIkmJhi9Kr3zedFfSSBy5qVZTOYQC1Z3uN+cJJC7rFnuRQN70BAnkPfbqtbdUaynrENVKHy08IxG3LUoPNSi14938kjqhiqVxdTwgeldxmu4Tln4qO8yhEoF6Mk634JbRhy6xj95c2WeMNyvQfSS1h+AzO1Y05cfQ0HglqWqNnafeP8EXXCQUyRvDfLl+F3tEYRyZWe3j5+zrPVssWqf4HvSvgNKwgIBHjKvjZR9QymwKvBuRejGlPmn8itreFXxWP1TXEDn16Ci4L+PpJZ432Z4ZELQgx7FD8XSKSF0Dbz1iU9PyGInCmyUbuUoNhcZrGSiRNhd/+BZrMGfMcUw30dV6RIVTeREx3jNpguzGXdFa1OQuBgUSLZDiEgET4+qUsdoCyuClIb0wBYpm4DdAnY6b3upE1/dL9zCn87zpC/aJKdpCOARG84TiutPW+uZUb6tCtE7UBq0dHwCBLvvmWpB0oU/Xpe1jIR",
                }
            }
        }, { parent: this });

        // The HA automation's webhook id is the only secret in the URL, so
        // only it is sealed; the controller renders the full URL from the
        // template. Mounted into alertmanager at
        // /etc/alertmanager/secrets/<name>/url.
        const haWebhook = new SealedSecret(`${name}-alertmanager-ha-webhook`, {
            spec: {
                encryptedData: {
                    webhook_id: "AgCPResNLBOk3DrUAPnxfdcQmbuWYeo39odd8PzbaKc6bCZcsDyhnJG+UHX1XIp7EHX9q4rGfxieiEQwCuKDEVTD1JL7a34Jqarpj5qULVxSAcpbg5G67g6Szbiymv0BlFbs6gN8g5EyM/84LdKVyfUKi5MQTfzot02AdJtkzvIe+LOZe4NaN1gKzgAqThO+NFJOLecxRRSRRVizsVpoE3zGrgA16LCCl80axbcMr54J13RI5AlQdXBIJHs0f2eb/Nh+MvGEeabUC0jT+I7wfASsyIMdMC7bY+HM2i9l+ZMUMkMGtbJePwUAXd2LVB+/CTVl0ZN2a0tAqzUfwfrodIqZIhOCVeU/zr5bjz44/anhH1uVzr5+er8h5RX4EhW5ci55IMHtihlONgX8Rcos7xQdnOtrTXETP3Um3+dZ0F6FqZvvPgmsIF1KPcyWb0ov+/8Z+spoCwKdhyWk5QwABRVbOtS5NG23PP4HKcAfd0hMsi4lZOkrB4QkaM7P2d1K6koRz7VdXXTFW3uCirH9CuT+0QJqb+PhF/XWL4IH5rPBc7IlfSUF2X70V1gaOOFwJjlnYBEawbxk+rzG25YgYNHC63A/TWQAWOqF+v/NM49BZRn+iIDJsTRvuGIlqVrdphJNhjP3lr5VzJa+rxoEt1L1W/Sw/R8mgzbGPa5e31OAK2FQcB1GETSjyit48l5O6YhhLn7IUQqVlYBlIEbzeHKjrK2pQ4LKwdUzJ73TFZqKVQwTKxdczQKbskLWJR9Qhw==",
                },
                template: {
                    data: {
                        url: pulumi.output(args.haos).apply(svc => svc.asUrl("http"))
                            .apply(base => `${base}/api/webhook/{{ .webhook_id }}`),
                    },
                },
            },
        }, { parent: this });

        const email = {
            to: args.alertEmail,
            send_resolved: true,
        };

        const grafanaHost = pulumi.interpolate`${args.subdomain}.${args.domain}`;

        this.chart = new HelmChart(name, {
            namespace,
            chart: "kube-prometheus-stack",
            values: {
                nameOverride: name,
                grafana: {
                    resources: {
                        requests: { cpu: "300m", memory: "512Mi" },
                        limits: { cpu: "300m", memory: "2Gi" },
                    },
                    testFramework: { enabled: false },
                    // The default value is not secure
                    admin: {
                        existingSecret: adminSecrets.metadata.name,
                        userKey: "username",
                        passwordKey: "password",
                    },
                    "grafana.ini": {
                        server: {
                            domain: grafanaHost,
                            root_url: pulumi.interpolate`https://${grafanaHost}`,
                            enable_gzip: true,
                        },
                        auth: {
                            disable_login_form: true,
                        },
                        "auth.generic_oauth": {
                            enabled: true,
                            name: "Authelia",
                            client_id: "$__file{/secrets/oauth_client_id}",
                            client_secret: "$__file{/secrets/oauth_client_secret}",
                            scopes: "openid profile email groups",
                            auth_url: pulumi.interpolate`https://${args.authSubdomain}.${args.domain}/api/oidc/authorization`,
                            token_url: pulumi.interpolate`https://${args.authSubdomain}.${args.domain}/api/oidc/token`,
                            api_url: pulumi.interpolate`https://${args.authSubdomain}.${args.domain}/api/oidc/userinfo`,
                            use_pkce: true,
                            use_refresh_token: true,
                            login_attribute_path: "preferred_username",
                            groups_attribute_path: "groups",
                            name_attribute_path: "name",
                            // Don't assign a default role if no role is found after role mapping
                            role_attribute_strict: true,
                            // Should not include a fallback role, as Grafana
                            // first tries to extrat from ID token, which always
                            // triggers the fallback because ID token doesn't contain user info now.
                            // Then when Grafana tries payload from user info
                            // endpoint, it won't overwrite the already retrived
                            // role (set as fallback from ID token).
                            role_attribute_path: "contains(groups[*], 'admins') && 'GrafanaAdmin' || contains(groups[*], 'dev') && 'Admin' || contains(groups[*], 'grafana-users') && 'Editor'",
                            allow_assign_grafana_admin: true,
                            auto_login: true,
                        },
                        log: {
                            // filters: "oauth.generic_oauth:debug",
                        },
                        smtp: {
                            enabled: true,
                            host: pulumi.output(args.smtp).apply(ss => ss.asUrl("smtp", "")),
                            // a send-as alias of the relay's Gmail account, see src/mail
                            from_address: pulumi.interpolate`kluster@${args.domain}`,
                            from_name: "kluster Grafana",
                            skip_verify: true,
                        },
                        analytics: {
                            check_for_updates: false,
                        },
                        security: {
                            // Needed when Grafana is hosted behind HTTPS
                            cookie_secure: true,
                        },
                    },
                    extraSecretMounts: [
                        {
                            name: "secret-files",
                            secretName: secrets.metadata.name,
                            mountPath: "/secrets",
                            readOnly: true,
                            optional: false,
                        },
                    ],
                },
                alertmanager: {
                    resources: {
                        requests: { cpu: "5m", memory: "64Mi" },
                        limits: { cpu: "5m", memory: "128Mi" },
                    },
                    // The chart routes everything to a 'null' receiver.
                    // warning goes out by mail through the in-cluster exim
                    // relay; critical additionally becomes a phone push
                    // through the HA webhook; info stays on the dashboards.
                    // The chart's inhibit_rules and route timings are kept:
                    // helm merges these maps, but replaces the lists (routes,
                    // receivers) wholesale.
                    config: {
                        global: {
                            smtp_smarthost: pulumi.output(args.smtp).apply(ss => ss.asUrl("smtp", "")),
                            // a send-as alias of the relay's Gmail account, see src/mail
                            smtp_from: pulumi.interpolate`"kluster Alertmanager" <kluster@${args.domain}>`,
                            // the relay is cluster-internal and plaintext
                            smtp_require_tls: false,
                        },
                        route: {
                            routes: [{
                                receiver: "email-and-push",
                                matchers: ['severity = "critical"'],
                            }, {
                                receiver: "email",
                                matchers: ['severity = "warning"'],
                            }],
                        },
                        receivers: [
                            { name: "null" },
                            {
                                name: "email",
                                email_configs: [email],
                            },
                            {
                                name: "email-and-push",
                                email_configs: [email],
                                webhook_configs: [{
                                    url_file: pulumi.interpolate`/etc/alertmanager/secrets/${haWebhook.metadata.name}/url`,
                                    send_resolved: true,
                                }],
                            },
                        ],
                    },
                    alertmanagerSpec: {
                        secrets: [haWebhook.metadata.name],
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
                // k3s runs the scheduler, controller-manager and kube-proxy
                // inside its own process and exposes no metrics endpoint for
                // them, so their scrape targets never exist and the matching
                // *Down alerts fire permanently. Disabling a component here
                // also drops its alert rules.
                kubeScheduler: { enabled: false },
                kubeControllerManager: { enabled: false },
                kubeProxy: { enabled: false },
                // Both default to info, which is not routed anywhere. They are
                // the signal for an eviction now that the descheduler deletes
                // evicted pods before KubePodNotReady can fire for them.
                customRules: {
                    KubeNodePressure: { severity: "warning" },
                    KubeNodeEviction: { severity: "warning" },
                },
                defaultRules: {
                    disabled: {
                        // Both fire when the requests would not fit after
                        // losing the largest node. The homelab node holds
                        // most of the cluster's capacity, so that is never
                        // true here and the alerts fire permanently.
                        KubeCPUOvercommit: true,
                        KubeMemoryOvercommit: true,
                        // Counts every major fault on the node, which here is
                        // dominated by CI runners cold-reading build outputs
                        // from the HDD-backed scratch pool -- page-cache
                        // misses, not memory pressure. NodeMemoryPressure
                        // below measures the stall directly.
                        NodeMemoryMajorPagesFaults: true,
                    },
                },
                prometheus: {
                    resources: {
                        requests: { cpu: "100m", memory: "1Gi" },
                        limits: { cpu: "200m", memory: "4Gi" },
                    },
                    prometheusSpec: {
                        // The chart default is 10d, too short to see a job
                        // backlog or a storage trend in hindsight. Note the
                        // volumeClaimTemplate below is deliberately left at
                        // 4Gi: local-path has no allowVolumeExpansion and a
                        // StatefulSet's volumeClaimTemplate is immutable, so
                        // growing it only wedges the operator on a resize it
                        // cannot finish -- and the hostPath enforces no quota
                        // anyway (the 4Gi claim already holds 4.6G). The real
                        // guard rail is retentionSize, sized to leave the
                        // homelab's nvme room to spare.
                        retention: "90d",
                        retentionSize: "30GB",
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
                        requests: { cpu: "10m", memory: "96Mi" },
                        limits: { cpu: "50m", memory: "96Mi" },
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
                        // Building the store for every resource kind in the
                        // cluster is bursty. Anything below this throttles the
                        // container hard enough that its own liveness probe
                        // times out, causing a permanent CrashLoopBackOff.
                        // Its steady working set sits just under 64Mi.
                        limits: { cpu: "500m", memory: "128Mi" },
                    },
                },
                "prometheus-node-exporter": {
                    resources: {
                        requests: { cpu: "20m", memory: "32Mi" },
                        // A scrape of the homelab node (many cgroups, disks
                        // and zfs stats) needs a burst well above 100m;
                        // throttled, it runs into the scrape timeout and the
                        // node's series go missing.
                        limits: { cpu: "250m", memory: "32Mi" },
                    },
                    prometheus: {
                        monitor: {
                            attachMetadata: { node: true },
                            relabelings: [{
                                action: "replace",
                                sourceLabels: ["__meta_kubernetes_node_name"],
                                targetLabel: "node",
                            }],
                        },
                    },
                },
            },
        }, { parent: this });

        new crds.monitoring.v1.PrometheusRule(`${name}-node-health`, {
            metadata: {
                namespace,
                labels: { release: "prometheus" },
            },
            spec: {
                groups: [{
                    name: "node-health",
                    rules: [{
                        alert: "NodeMemoryPressure",
                        // "full" PSI: share of time every non-idle task on the
                        // node was stalled waiting for memory
                        expr: 'rate(node_pressure_memory_stalled_seconds_total{job="node-exporter"}[5m]) > 0.1',
                        for: "15m",
                        labels: { severity: "warning" },
                        annotations: {
                            summary: "Node {{ $labels.node }} is stalled on memory",
                            description: "All non-idle tasks on {{ $labels.node }} have been stalled on memory (reclaim or swap-in) {{ $value | humanizePercentage }} of the time for 15 minutes.",
                        },
                    }, {
                        alert: "NodeDiskWriteLatencyHigh",
                        // etcd's fdatasync on the control-plane NVMe is what
                        // keeps k3s's leader leases renewed: above ~20ms
                        // average write latency the leases start to lapse and
                        // k3s exits. Limited to NVMe because HDD latency
                        // norms are an order of magnitude higher.
                        expr: 'rate(node_disk_write_time_seconds_total{job="node-exporter", device=~"nvme.+"}[1h]) / rate(node_disk_writes_completed_total{job="node-exporter", device=~"nvme.+"}[1h]) > 0.02',
                        for: "30m",
                        labels: { severity: "warning" },
                        annotations: {
                            summary: "NVMe {{ $labels.device }} on {{ $labels.node }} is slow to write",
                            description: "Average write latency on {{ $labels.device }} has been {{ $value | humanizeDuration }} over the last hour. etcd on this disk misses lease renewals at this latency. Look for heavy writers (build output on the root filesystem) and check SMART wear.",
                        },
                    }, {
                        alert: "K3sRestarting",
                        // k3s runs the apiserver in its own process, so the
                        // apiserver's start time changes on every k3s restart
                        expr: 'changes(process_start_time_seconds{job="apiserver"}[6h]) > 2',
                        labels: { severity: "warning" },
                        annotations: {
                            summary: "k3s on {{ $labels.instance }} has restarted {{ $value }} times in 6h",
                            description: "The k3s server keeps exiting; every controller with a leader lease restarts with it. `journalctl -u k3s` shows the fatal line, usually `leaderelection lost` after slow etcd fdatasync.",
                        },
                    }],
                }],
            },
        }, { parent: this });

        args.serving.createFrontendService(name, {
            host: grafanaHost,
            targetService: this.chart.service(new RegExp(`grafana`)),
            targetPort: 'http-web',
            // Grafana will itself connect to Authelia using oauth
            enableAuth: false,
            // Too much efforts to get probes updated to https
            enableMTls: false,
        });
    }
}
