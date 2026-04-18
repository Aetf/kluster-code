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

// Remove Gateway API CRDs from the chart. We define our own.
function removeGatewayCrd(obj: any, opts: pulumi.CustomResourceOptions) {
    // Safely check if the resource is a CRD and its name ends with the Gateway API group
    if (
        obj.kind === "CustomResourceDefinition" &&
        obj.metadata?.name?.endsWith("gateway.networking.k8s.io")
    ) {
        // Omit the resource by transforming it into an empty List
        obj.apiVersion = "v1";
        obj.kind = "List";
        obj.items = [];
    }
}

const HTTP_CONTAINER_PORT = 8000;
const HTTPS_CONTAINER_PORT = 8443;

export class Traefik extends pulumi.ComponentResource<TraefikArgs> {
    public readonly chart: HelmChart;
    public readonly certificate: BackendCertificate;
    /**
     * The name of the GatewayClass created by this Traefik deployment.
     * Pass this into Serving so the Gateway resource can reference it.
     */
    public readonly gatewayClassName!: pulumi.Output<string>;

    public readonly ready!: pulumi.Output<pulumi.CustomResource[]>;
    public get httpPort(): number { return HTTP_CONTAINER_PORT; }
    public get httpsPort(): number { return HTTPS_CONTAINER_PORT; }

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
                resources: {
                    requests: { cpu: "10m", memory: "128Mi" },
                    limits: { cpu: "50m", memory: "256Mi" }
                },
                providers: {
                    kubernetesGateway: {
                        enabled: true,
                        // TLSRoute and TCPRoute support (experimental channel)
                        // Required for stdiscosrv TLS passthrough via TLSRoute
                        experimentalChannel: true,
                    },
                    kubernetesCRD: {
                        enabled: true,
                        // traefik by default do not allow ExternalName service due to minor CVE
                        // see https://github.com/traefik/traefik/pull/8261
                        // see https://doc.traefik.io/traefik/migration/v2/#k8s-externalname-service
                        allowExternalNameServices: true,
                        // Allow Middleware CRDs in app namespaces to reference middlewares in
                        // serving-system (used for auth Chain delegates)
                        allowCrossNamespace: true,
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
                        port: HTTP_CONTAINER_PORT,
                        exposedPort: args.httpPort,
                        // permanent redirection by default
                        // TODO: remove redirectTO after traefik helm chart upgrade past v34
                        redirectTo: {
                            port: "websecure"
                        },
                        redirections: {
                            entryPoint: {
                                to: "websecure",
                                scheme: "https",
                                permanent: true,
                            }
                        },
                    },
                    websecure: {
                        port: HTTPS_CONTAINER_PORT,
                        exposedPort: args.httpsPort,
                        tls: {
                            enabled: true
                        }
                    }
                },
                // automatically created as TLSOptions CR
                // TODO: remove this AFTER kubernetesingress is disabled.
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
                        level: "INFO"
                    },
                    access: {
                        enabled: true
                    }
                },
                // We create our own Gateway resource at Serving level.
                gateway: {
                    enabled: false,
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
                removeGatewayCrd,
            ]
        }, {
            parent: this,
        });

        setAndRegisterOutputs(this, {
            ready: this.chart.ready,
            // 'traefik' is the GatewayClass name the Helm chart registers by default
            gatewayClassName: pulumi.output('traefik'),
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
