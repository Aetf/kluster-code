import * as _ from "radash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as crds from "#src/crds";

import { setAndRegisterOutputs } from "#src/utils";

import { Middleware } from "./traefik";
import { GatewayRef } from "./index";
import { BackendCertificate } from "#src/base-cluster";

export interface FrontendServiceArgs {
    host: pulumi.Input<string | pulumi.Input<string>[]>,
    targetService: pulumi.Input<k8s.core.v1.Service>,
    targetPort?: string,

    // If disabled, force to http to upstream
    enableMTls?: boolean,

    middlewares?: pulumi.Input<Middleware[]>,
    suppressAccessLogPaths?: pulumi.Input<string[]>,

    // If true, no HTTPRoute is created (e.g. for TLS passthrough via TLSRoute).
    skipHttpRoute?: boolean;

    // If true, emit a TLSRoute attached to the Gateway's Passthrough listener
    // instead of an HTTPRoute. The backend owns and terminates TLS itself, so
    // no middlewares or BackendTLSPolicy apply. The host must also be listed
    // in Serving's passthroughHosts so the matching listener exists.
    tlsPassthrough?: boolean;

    // Optional backend certificate to use for CA validation
    backendCert?: BackendCertificate;

    gatewayRef: GatewayRef,
}

/**
 * A frontend service. For each service, the following will be installed:
 * - <name>: HTTPRoute targeting the backend Service directly (Gateway API),
 *   or a TLSRoute when tlsPassthrough is set.
 * - <name>-tls: BackendTLSPolicy for backend TLS verification (when enableMTls).
 * - <name>-nolog: Optional traefik IngressRoute for paths that disable access
 *   logging. The kubernetesGateway provider ignores per-route observability,
 *   so this uses an IngressRoute (which supports it) at a higher priority.
 */
export class FrontendService extends pulumi.ComponentResource<FrontendServiceArgs> {
    public readonly url!: pulumi.Output<string>;

    private readonly enableMTls: boolean;
    private readonly schema: string;
    private readonly targetPort?: string;
    private readonly middlewares: pulumi.Output<Middleware[]> | undefined;
    private readonly suppressAccessLogPaths?: pulumi.Input<string[]>;
    private readonly gatewayRef: GatewayRef;

    constructor(name: string, args: FrontendServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:FrontendService', name, args, opts);
        this.enableMTls = args.enableMTls ?? true;
        this.schema = this.enableMTls ? 'https' : 'http'
        this.targetPort = args.targetPort;
        this.middlewares = args.middlewares ? pulumi.output(args.middlewares) : undefined;
        this.suppressAccessLogPaths = args.suppressAccessLogPaths;
        this.gatewayRef = args.gatewayRef;

        {
            // === GATEWAY API HTTPRoute ===
            const serviceOut = pulumi.output(args.targetService);
            const targetName = serviceOut.apply(s => s.metadata.name);
            const targetNamespace = serviceOut.apply(s => s.metadata.namespace || 'default');

            let localChainMiddlewareName: pulumi.Output<string> | undefined;

            if (this.middlewares) {
                const chainMiddleware = new Middleware(`${name}-chain`, {
                    chain: {
                        middlewares: this.middlewares.apply(ms => ms.map(m => ({
                            name: m.metadata.name,
                            namespace: m.metadata.namespace,
                        })))
                    }
                } as any, { parent: this, namespace: targetNamespace });
                localChainMiddlewareName = pulumi.output(chainMiddleware.metadata.name).apply(n => n!);
            }

            const targetPortNumber = serviceOut.apply(service => service.spec.ports).apply(ports => {
                const matching = ports.find(p => p.name === this.targetPort || p.name === this.schema || p.port == 443 || p.port == 80) ?? ports[0];
                return matching.port;
            });

            if (args.tlsPassthrough) {
                new crds.gateway.v1.TLSRoute(name, {
                    metadata: {
                        namespace: targetNamespace,
                    },
                    spec: {
                        parentRefs: [{
                            name: this.gatewayRef.name,
                            namespace: this.gatewayRef.namespace,
                        }],
                        hostnames: pulumi.output(args.host).apply(h => _.isString(h) ? [h] : h),
                        rules: [{
                            backendRefs: [{
                                kind: "Service",
                                name: targetName,
                                namespace: targetNamespace,
                                port: targetPortNumber,
                            }],
                        }],
                    }
                }, { parent: this });
            } else if (!args.skipHttpRoute) {
                this.createHttpRoute(name, args.host, targetNamespace, targetName, targetNamespace, targetPortNumber, localChainMiddlewareName);

                if (this.suppressAccessLogPaths) {
                    // The kubernetesGateway provider ignores observability
                    // annotations on HTTPRoute (only service.nativeLB is
                    // parsed), so split these paths onto a traefik
                    // IngressRoute, which does support per-route
                    // observability. Priority must outrank the Gateway
                    // router for the same host (host+path length based,
                    // i.e. double digits).
                    const rule = pulumi.all([pulumi.output(args.host), pulumi.output(this.suppressAccessLogPaths)])
                        .apply(([hosts, paths]) => {
                            const hostList = _.isString(hosts) ? [hosts] : hosts as string[];
                            const hostRule = hostList.map(h => `Host(\`${h}\`)`).join(' || ');
                            const pathRule = paths.map(p => `PathPrefix(\`${p}\`)`).join(' || ');
                            return `(${hostRule}) && (${pathRule})`;
                        });
                    new crds.traefik.v1alpha1.IngressRoute(`${name}-nolog`, {
                        metadata: {
                            namespace: targetNamespace,
                        },
                        spec: {
                            entryPoints: ['websecure'],
                            routes: [{
                                match: rule,
                                kind: 'Rule',
                                priority: 10000,
                                observability: {
                                    accessLogs: false,
                                },
                                middlewares: localChainMiddlewareName ? [{
                                    name: localChainMiddlewareName,
                                    namespace: targetNamespace,
                                }] : undefined,
                                services: [{
                                    name: targetName,
                                    namespace: targetNamespace,
                                    port: targetPortNumber,
                                    scheme: this.schema,
                                }],
                            }],
                        },
                    }, { parent: this });
                }
            }

            // Apply Gateway API BackendTLSPolicy to instruct Traefik to use HTTPS towards the backend
            if (this.enableMTls && !args.tlsPassthrough) {
                const backendTLSPolicySpec: crds.types.input.gateway.v1.BackendTLSPolicySpec = {
                    targetRefs: [{
                        group: "",
                        kind: "Service",
                        name: targetName,
                    }],
                    validation: {
                        // Must match the SAN of the BackendCertificate, which
                        // is issued for `<service>.<namespace>` (see certs.ts).
                        hostname: pulumi.interpolate`${targetName}.${targetNamespace}`,
                        wellKnownCACertificates: args.backendCert ? undefined : "System",
                        caCertificateRefs: args.backendCert ? [{
                            group: "",
                            kind: "Secret",
                            name: args.backendCert.secretName,
                        }] : undefined,
                    }
                };

                new crds.gateway.v1.BackendTLSPolicy(`${name}-tls`, {
                    metadata: {
                        namespace: targetNamespace,
                    },
                    spec: backendTLSPolicySpec,
                }, { parent: this });
            }
        }

        setAndRegisterOutputs(this, {
            url: pulumi.interpolate`${this.schema}://${args.host}`
        });
    }

    private createHttpRoute(
        name: string,
        host: pulumi.Input<string | pulumi.Input<string>[]>,
        namespace: pulumi.Output<string>,
        backendName: pulumi.Output<string>,
        backendNamespace: pulumi.Output<string>,
        backendPort: pulumi.Output<number>,
        localChain?: pulumi.Output<string>,
    ): crds.gateway.v1.HTTPRoute {
        return new crds.gateway.v1.HTTPRoute(name, {
            metadata: {
                // omit name to let pulumi auto-name it, avoiding replace conflicts
                namespace,
            },
            spec: {
                parentRefs: [{
                    name: this.gatewayRef.name,
                    namespace: this.gatewayRef.namespace,
                }],
                hostnames: pulumi.output(host).apply(h => _.isString(h) ? [h] : h),
                rules: [{
                    matches: [{ path: { type: "PathPrefix", value: "/" } }],
                    filters: localChain ? [{
                        type: "ExtensionRef",
                        extensionRef: {
                            group: "traefik.io",
                            kind: "Middleware",
                            name: localChain,
                        }
                    }] : [],
                    backendRefs: [{
                        kind: "Service",
                        name: backendName,
                        namespace: backendNamespace,
                        port: backendPort,
                    }],
                }],
            }
        }, { parent: this });
    }
}
