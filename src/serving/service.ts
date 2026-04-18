import * as _ from "radash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";
import * as crds from "#src/crds";

import { Service, setAndRegisterOutputs } from "#src/utils";

import { Middleware, TLSOption } from "./traefik";
import { GatewayRef } from "./index";

export interface FrontendServiceArgs {
    host: pulumi.Input<string | pulumi.Input<string>[]>,
    targetService: pulumi.Input<k8s.core.v1.Service>,
    targetPort?: string,

    // If disabled, force to http to upstream
    enableMTls?: boolean,

    tlsOption?: pulumi.Input<TLSOption>,
    middlewares?: pulumi.Input<Middleware[]>,
    suppressAccessLogPaths?: pulumi.Input<string[]>,

    // If true, standard HTTPRoute won't be created.
    // Useful for services that need TLSRoute or TCPRoute (e.g. stdiscosrv Phase 4).
    skipHttpRoute?: boolean;

    // If true, legacy Ingress resource will be created.
    // Default to true for dual-emission, set to false for migrated services.
    useLegacyIngress?: boolean;

    gatewayRef: GatewayRef,
}

/**
 * A frontend service. For each service, the following will be installed:
 * - <name>-dns: Service of type ExternalName, targeting the corresponding backend Service (Legacy)
 * - <name>-ingress: Ingress rule (Legacy)
 * - <name>: HTTPRoute targeting the backend Service directly (Gateway API)
 * - <name>-nolog: Optional second HTTPRoute for paths overriding access logging
 */
export class FrontendService extends pulumi.ComponentResource<FrontendServiceArgs> {
    public readonly service: Service;

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

        // Generate an external name service based on the target service
        const serviceSpec = pulumi.output(args.targetService)
        .apply(service => {
            return {
                type: k8s.types.enums.core.v1.ServiceSpecType.ExternalName,
                externalName: pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`,
                ports: service.spec.ports.apply(ports => {
                    const hasHttp = ports.some(port => port.name === 'http');
                    return ports.map(port => {
                        // be smart about service ports: if there's a 443 port, override its
                        // name to be https
                        let name = port.port == 443 ? 'https' : port.name;
                        // if tls disabled, force to http
                        if (!this.enableMTls && name === "https" && !hasHttp) {
                            name = "http"
                        }
                        return {
                            name,
                            port: port.port,
                        };
                    });
                })
            };
        });

        this.service = new Service(`${name}-dns`, {
            metadata: {
                name: `${name}-dns`
            },
            spec: serviceSpec
        }, { parent: this, deleteBeforeReplace: true });

        const middlewareList = pulumi.output(args.middlewares)
            .apply(ms => ms?.map(m => m.fullname))
            .apply(names => pulumi.all(names ?? []))
            .apply(names => names.join(','));

        // === LEGACY INGRESS (Phase 1 dual-emit active) ===
        if (args.useLegacyIngress ?? true) {
            new k8s.networking.v1.Ingress(name, {
                metadata: {
                    annotations: pulumi.output(args.tlsOption)
                        .apply(tls => ({
                            "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                            "traefik.ingress.kubernetes.io/router.middlewares": middlewareList,
                            ...tls?.asAnnotation() ?? {}
                        }))
                },
                spec: this.ingressSpecFromHosts(args.host),
            }, { parent: this });
        }

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
            }, { parent: this, namespace: targetNamespace });
            localChainMiddlewareName = pulumi.output(chainMiddleware.metadata.name).apply(n => n!);
        }

        const targetPortNumber = serviceOut.apply(service => service.spec.ports).apply(ports => {
            const matching = ports.find(p => p.name === this.targetPort || p.name === this.schema || p.port == 443 || p.port == 80) ?? ports[0];
            return matching.port;
        });

        if (!args.skipHttpRoute) {
            this.createHttpRoute(name, args.host, targetNamespace, targetName, targetNamespace, targetPortNumber, localChainMiddlewareName);

            if (this.suppressAccessLogPaths) {
                this.createHttpRoute(`${name}-nolog`, args.host, targetNamespace, targetName, targetNamespace, targetPortNumber, localChainMiddlewareName, this.suppressAccessLogPaths);
            }
        }

        // Apply Gateway API BackendTLSPolicy to instruct Traefik to use HTTPS towards the backend
        if (this.enableMTls) {
            new crds.gateway.v1.BackendTLSPolicy(`${name}-tls`, {
                spec: {
                    targetRefs: [{
                        group: "",
                        kind: "Service",
                        name: targetName,
                    }],
                    validation: {
                        hostname: pulumi.interpolate`${targetName}.${targetNamespace}.svc.cluster.local`,
                        wellKnownCACertificates: "System",
                    }
                }
            }, { parent: this });
        }

        setAndRegisterOutputs(this, {
            url: pulumi.interpolate`${this.schema}://${args.host}`
        });
    }

    private ingressSpecFromHosts(host: pulumi.Input<string | pulumi.Input<string>[]>): pulumi.Output<k8s.types.input.networking.v1.IngressSpec> {
        return pulumi.output(host).apply(host => {
            const hosts = _.isString(host) ? [host] : host;
            const tls = _.unique(hosts.map(this.tlsFromHost), tls => tls.secretName!)
            return {
                tls,
                rules: hosts.map(this.ruleFromHost.bind(this)),
            };
        });
    }

    private tlsFromHost(host: string): { secretName: string } {
        const tld = host.split('.').slice(-2).join('.');
        // NOTE: keep in sync with naming logic in certs.ts
        return { secretName: `cert-${tld}` };
    }

    private ruleFromHost(host: string): k8s.types.input.networking.v1.IngressRule {
        let rule = { host };
        rule = _.set(rule, 'http.paths[0].path', '/');
        rule = _.set(rule, 'http.paths[0].pathType', 'Prefix');
        rule = _.set(rule, 'http.paths[0].backend.service.name', this.service.metadata.name);
        rule = _.set(rule, 'http.paths[0].backend.service.port.name', this.targetPort ?? this.schema);
        return rule;
    }

    private createHttpRoute(
        name: string,
        host: pulumi.Input<string | pulumi.Input<string>[]>,
        namespace: pulumi.Output<string>,
        backendName: pulumi.Output<string>,
        backendNamespace: pulumi.Output<string>,
        backendPort: pulumi.Output<number>,
        localChain?: pulumi.Output<string>,
        suppressPaths?: pulumi.Input<string[]>
    ): crds.gateway.v1.HTTPRoute {
        return new crds.gateway.v1.HTTPRoute(name, {
            metadata: {
                // omit name to let pulumi auto-name it, avoiding replace conflicts
                namespace,
                annotations: {
                    "traefik.io/router.observability.accesslogs": suppressPaths ? "false" : "true"
                },
            },
            spec: {
                parentRefs: [{
                    name: this.gatewayRef.name,
                    namespace: this.gatewayRef.namespace,
                }],
                hostnames: pulumi.output(host).apply(h => _.isString(h) ? [h] : h),
                rules: [{
                    matches: suppressPaths 
                        ? pulumi.output(suppressPaths).apply(paths => paths.map(p => ({
                            path: { type: "PathPrefix", value: p }
                          })))
                        : [{ path: { type: "PathPrefix", value: "/" } }],
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
