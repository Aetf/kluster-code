import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { BaseCluster, BackendCertificate } from "#src/base-cluster";
import { HelmChart, NamespaceProbe, removeHelmTestAnnotation, setAndRegisterOutputs } from "#src/utils";

interface TraefikArgs {
    base: BaseCluster,
    externalIPs: string[],
    httpPort: number,
    httpsPort: number,

    backendIssuer?: crds.cert_manager.v1.ClusterIssuer | crds.cert_manager.v1.Issuer,
}

export class Traefik extends pulumi.ComponentResource<TraefikArgs> {
    public readonly chart: HelmChart;
    public readonly certificate: BackendCertificate;

    public readonly ready!: pulumi.Output<pulumi.CustomResource[]>;

    constructor(name: string, args: TraefikArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:Traefik', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.certificate = args.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        this.chart = new HelmChart(name, {
            namespace,
            chart: "traefik",
            values: {
                providers: {
                    kubernetesCRD: {
                        enabled: true,
                        // traefik by default do not allow ExternalName service due to minor CVE
                        // see https://github.com/traefik/traefik/pull/8261
                        // see https://doc.traefik.io/traefik/migration/v2/#k8s-externalname-service
                        allowExternalNameServices: true,
                    },
                    kubernetesIngress: {
                        enabled: true,
                        // traefik by default do not allow ExternalName service due to minor CVE
                        // see https://github.com/traefik/traefik/pull/8261
                        // see https://doc.traefik.io/traefik/migration/v2/#k8s-externalname-service
                        allowExternalNameServices: true,
                        // Use publishedService once traefik/traefik#7972 is
                        // fixed.
                        /*
                        publishedService: {
                            enabled: true
                        }
                        */
                    }
                },
                service: {
                    labels: {
                        'svccontroller.k3s.cattle.io/lbpool': 'internet',
                    },
                    spec: {
                        allocateLoadBalancerNodePorts: false,
                    },
                },
                ports: {
                    web: {
                        exposedPort: args.httpPort,
                        // permanent redirection by default
                        redirectTo: {
                            port: "websecure"
                        }
                    },
                    websecure: {
                        exposedPort: args.httpsPort,
                        tls: {
                            enabled: true
                        }
                    }
                },
                // automatically created as TLSOptions CR
                tlsOptions: {
                    default: {
                        sniStrict: true
                    }
                },
                deployment: {
                    annotations: {
                        "reloader.stakater.com/search": "true"
                    },
                    additionalVolumes: [
                        {
                            // make the root ca available, so traefik can verify backend services
                            name: "tls",
                            secret: {
                                secretName: this.certificate.secretName
                            }
                        }
                    ]
                },
                additionalVolumeMounts: [
                    {
                        name: "tls",
                        mountPath: "/tls"
                    }
                ],
                additionalArguments: [
                    "--serversTransport.rootCAs=/tls/ca.crt",
                    pulumi.interpolate`--providers.kubernetesingress.ingressendpoint.ip=${args.externalIPs[0]}`,
                ],
                logs: {
                    general: {
                        level: "DEBUG"
                    },
                    access: {
                        enabled: true
                    }
                },
                // disable traefik pilot which is a paid feature
                pilot: {
                    enabled: false,
                    dashboard: false
                },
                // disable traefik data collection
                globalArguments: null,
            },
            transformations: [
                removeHelmTestAnnotation,
            ]
        }, {
            parent: this,
        });

        setAndRegisterOutputs(this, {
            ready: this.chart.ready,
        });
    }

    protected async initialize(args: pulumi.Inputs): Promise<TraefikArgs> {
        return args as TraefikArgs;
    }
}

export class Middleware extends crds.traefik.v1alpha1.Middleware {
    constructor(name: string, spec: crds.types.input.traefik.v1alpha1.MiddlewareSpec, opts?: pulumi.CustomResourceOptions) {
        super(name, {
            metadata: { name, },
            spec,
        }, {
            deleteBeforeReplace: true,
            ...opts ?? {}
        });
    }

    /**
     * Full name usable in annotations
     */
    get fullname(): pulumi.Output<string> {
        return pulumi.interpolate`${this.metadata.namespace}-${this.metadata.name}@kubernetescrd`;
    }
}

export class TLSOption extends crds.traefik.v1alpha1.TLSOption {
    constructor(name: string, spec: crds.types.input.traefik.v1alpha1.TLSOptionSpec, opts?: pulumi.CustomResourceOptions) {
        super(name, {
            metadata: { name, },
            spec,
        }, { deleteBeforeReplace: true, ...opts ?? {} });
    }

    /**
     * Full name usable in annotations
     */
    get fullname(): pulumi.Output<string> {
        return pulumi.interpolate`${this.metadata.namespace}-${this.metadata.name}@kubernetescrd`;
    }

    /**
     * return an annotation object suitable to apply on Ingress
     */
    public asAnnotation(): Record<string, pulumi.Output<string>> {
        return {
            "traefik.ingress.kubernetes.io/router.tls.options": this.fullname
        };
    }
}
