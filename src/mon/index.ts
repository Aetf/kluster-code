import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BackendCertificate } from '#src/base-cluster';
import { NamespaceProbe, HelmChart, SealedSecret, Service, dedent } from "#src/utils";
import { Serving } from "#src/serving";

interface PrometheusArgs {
    serving: Serving,

    domain: pulumi.Input<string>,
    subdomain: pulumi.Input<string>,
    authSubdomain: pulumi.Input<string>,

    smtp: pulumi.Input<Service>,
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
                            from_address: pulumi.interpolate`grafana@${args.domain}`,
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
                    resources: {
                        requests: { cpu: "100m", memory: "1Gi" },
                        limits: { cpu: "200m", memory: "4Gi" },
                    },
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
                        requests: { cpu: "5m", memory: "32Mi" },
                        limits: { cpu: "10m", memory: "64Mi" },
                    },
                },
                "prometheus-node-exporter": {
                    resources: {
                        requests: { cpu: "20m", memory: "32Mi" },
                        limits: { cpu: "50m", memory: "32Mi" },
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

        args.serving.createFrontendService(name, {
            host: grafanaHost,
            targetService: this.chart.service(new RegExp(`grafana`)),
            targetPort: 'http-web',
            // Grafana will itself connect to Authelia using oauth
            enableAuth: false,
            // Too much efforts to get probes updated to https
            enableTls: false,
        });
    }
}
