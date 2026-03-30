import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster, FrontendCertificate } from "#src/base-cluster";
import { FrontendCertificateArgs } from "#src/base-cluster/certs";
import { Service } from "#src/utils";
import * as crds from '#src/crds';

import { Traefik, Middleware } from "./traefik";
import { Authelia } from "./authelia";
import { FrontendService, FrontendServiceArgs } from "./service";

export { Middleware, TLSOption } from "./traefik";
export { FrontendService } from "./service";

/** Reference to the shared Gateway, injected into HTTPRoute resources. */
export interface GatewayRef {
    name: string,
    namespace: pulumi.Output<string>,
}

interface ServingArgs {
    base: BaseCluster,
    // SMPT service for sending email
    smtp: Service,

    // External IP and port to listen on
    externalIPs: string[],
    httpPort?: number,
    httpsPort?: number,

    // Domain to serve on
    domain: pulumi.Input<string>,
    certificates: ({ main: string } & FrontendCertificateArgs)[],

    // Hostnames for TLS passthrough listeners (e.g. stdiscosrv).
    // A separate Gateway listener with mode=Passthrough is created for each.
    passthroughHosts?: string[],
}

export class Serving extends pulumi.ComponentResource<ServingArgs> {
    public readonly certificates: FrontendCertificate[];
    public readonly base: BaseCluster;

    /** Reference to the shared Gateway for HTTPRoute parentRefs. */
    public readonly gateway: GatewayRef;

    public readonly crdsReady: pulumi.Output<pulumi.CustomResource[]>;
    public readonly middlewareAuth: Middleware;
    public readonly middlewareAuthBasic: Middleware;

    constructor(name: string, args: ServingArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Serving', name, args, opts);
        this.base = args.base;

        // Install Gateway API CRDs (Experimental channel, for TLSRoute)
        const gatewayApiCrds = new k8s.yaml.ConfigFile("gateway-api-crds", {
            file: "https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.0/experimental-install.yaml",
        }, { parent: this });

        const traefik = new Traefik('traefik', {
            base: args.base,
            externalIPs: args.externalIPs,
            httpPort: args.httpPort ?? 80,
            httpsPort: args.httpsPort ?? 443,
        }, { parent: this, dependsOn: [gatewayApiCrds] });
        this.crdsReady = traefik.ready;

        const authelia = new Authelia('authelia', {
            base: args.base,
            crdsReady: this.crdsReady,
            domain: args.domain,
            subdomain: 'auth',
            smtp: args.smtp,
        }, { parent: this });

        this.middlewareAuth = new Middleware('auth', {
            forwardAuth: {
                address: authelia.url,
                // this is safe because traefik sanitize all forwarded header
                // before handling req to middlewares
                trustForwardHeader: true,
                authResponseHeaders: [
                    "Remote-User",
                    "Remote-Name",
                    "Remote-Email",
                    "Remote-Groups",
                ],
                tls: {
                    caSecret: authelia.certificate.secretName,
                    certSecret: traefik.certificate.secretName,
                }
            }
        }, { parent: authelia });
        this.middlewareAuthBasic = new Middleware('auth-basic', {
            forwardAuth: {
                address: authelia.urlBasic,
                // this is safe because traefik sanitize all forwarded header
                // before handling req to middlewares
                trustForwardHeader: true,
                authResponseHeaders: [
                    "Remote-User",
                    "Remote-Name",
                    "Remote-Email",
                    "Remote-Groups",
                ],
                tls: {
                    caSecret: authelia.certificate.secretName,
                    certSecret: traefik.certificate.secretName,
                }
            }
        }, { parent: authelia });

        this.certificates = args.certificates.map(cert => {
            return args.base.createFrontendCertificate(cert.main, cert, { parent: this });
        });

        // Build Gateway listeners — one HTTPS (Terminate) listener per TLD cert,
        // plus optional TLS Passthrough listeners for special services (e.g. stdiscosrv).
        const httpsListeners = args.certificates.map((certArgs, i) => {
            const certObj = this.certificates[i];
            return {
                name: `websecure-${certArgs.main.replace(/\./g, '-')}`,
                protocol: 'HTTPS',
                port: 443,
                hostname: `*.${certArgs.main}`,
                allowedRoutes: {
                    namespaces: { from: 'All' },
                },
                tls: {
                    mode: 'Terminate',
                    certificateRefs: [
                        { kind: 'Secret', name: certObj.secretName },
                    ],
                },
            };
        });

        const passthroughListeners = (args.passthroughHosts ?? []).map(hostname => ({
            name: `tls-passthrough-${hostname.replace(/\./g, '-')}`,
            protocol: 'TLS',
            port: 443,
            hostname,
            allowedRoutes: {
                namespaces: { from: 'All' },
            },
            tls: {
                // No certificateRefs: the backend owns and terminates its own TLS.
                mode: 'Passthrough',
            },
        }));

        const gatewayResource = new crds.gateway.v1.Gateway('traefik', {
            metadata: {
                name: 'traefik',
            },
            spec: {
                // gatewayClassName matches the class registered by the Traefik Helm chart
                gatewayClassName: traefik.gatewayClassName,
                listeners: [...httpsListeners, ...passthroughListeners],
            },
        }, {
            parent: this,
            // Wait for Traefik (and its GatewayClass) to be ready before creating the Gateway
            dependsOn: [traefik.chart],
        });

        const gatewayNamespace = pulumi.output(gatewayResource.metadata).apply(m => m.namespace!);
        this.gateway = {
            name: 'traefik',
            namespace: gatewayNamespace,
        };

        this.registerOutputs({
            crdsReady: this.crdsReady,
        });
    }

    protected async initialize(args: pulumi.Inputs): Promise<ServingArgs> {
        return args as ServingArgs;
    }

    public createFrontendService(
        name: string,
        args: FrontendServiceArgs & { enableAuth?: boolean, enableBasicAuth?: boolean },
        opts?: Omit<pulumi.ComponentResourceOptions, 'parent'>
    ): FrontendService {
        const enableAuth = args.enableAuth ?? false;
        const enableBasicAuth = args.enableBasicAuth ?? false;
        delete args['enableAuth'];
        delete args['enableBasicAuth'];
        return new FrontendService(name, {
            ...args,
            middlewares: pulumi.output(args.middlewares)
                .apply(ms => [
                    ...(enableAuth ?? false) ? [this.middlewareAuth] : [],
                    ...(enableBasicAuth ?? false) ? [this.middlewareAuthBasic] : [],
                    ...ms ?? [],
                ])
        }, {
            ...opts ?? {},
            parent: this,
        })
    }
}
