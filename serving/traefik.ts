import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { BaseCluster, BackendCertificate } from "#src/base-cluster";
import { NamespaceProbe, setAndRegisterOutputs } from "#src/utils";

interface TraefikArgs {
    base: BaseCluster,
    externalIPs: string[],
    httpPort: number,
    httpsPort: number,

    backendIssuer?: crds.certmanager.v1.ClusterIssuer | crds.certmanager.v1.Issuer,
}

export class Traefik extends pulumi.ComponentResource<TraefikArgs> {
    public readonly chart: k8s.helm.v3.Chart;
    public readonly certificate: BackendCertificate;
    public readonly internalService: kx.Service;

    constructor(name: string, args: TraefikArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:Traefik', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.certificate = args.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        this.chart = new k8s.helm.v3.Chart(name, {
            namespace,
            chart: "traefik",
            version: "9.19.2",
            fetchOpts: {
                repo: "https://helm.traefik.io/traefik",
            },
            values: {
                providers: {
                    kubernetesCRD: {
                        enabled: true
                    },
                    kubernetesIngress: {
                        enabled: true,
                    }
                },
                service: {
                    type: "ClusterIP",
                    externalIPs: args.externalIPs,
                },
                ports: {
                    web: {
                        exposedPort: args.httpPort,
                        // permanent redirection by default
                        redirectTo: "websecure"
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
                    "--serversTransport.rootCAs=/tls/ca.crt"
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
                globalArguments: null
            }
        }, { parent: this });

        // This service should never be exposed
        this.internalService = new kx.Service(`${name}-internal`, {
            metadata: {
                name: `${name}-internal`
            },
            spec: {
                type: kx.types.ServiceType.ClusterIP,
                ports: [{
                    name: 'traefik',
                    port: 80,
                    targetPort: 'traefik'
                }],
                selector: {
                    "app.kubernetes.io/name": "traefik",
                    "app.kubernetes.io/instance": "traefik"
                }
            }
        }, { parent: this, deleteBeforeReplace: true });

        setAndRegisterOutputs(this, {});
    }

    protected async initialize(args: pulumi.Inputs): Promise<TraefikArgs> {
        return args as TraefikArgs;
    }
}

export class Middleware extends crds.traefik.v1alpha1.Middleware {
    constructor(name: string, spec: Record<string, any>, opts?: pulumi.CustomResourceOptions) {
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
}
