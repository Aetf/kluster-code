import * as _ from "radash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { Service, setAndRegisterOutputs } from "#src/utils";

import { Middleware, TLSOption } from "./traefik";

export interface FrontendServiceArgs {
    host: pulumi.Input<string | pulumi.Input<string>[]>,
    targetService: pulumi.Input<k8s.core.v1.Service>,
    targetPort?: string,

    // If disabled, force to http to upstream
    enableTls?: boolean,

    tlsOption?: pulumi.Input<TLSOption>,
    middlewares?: pulumi.Input<Middleware[]>,
}

/**
 * A frontend service. For each service, the following will be installed:
 * <name>-dns: Service of type ExternalName, targeting the corresponding backend Service
 * <name>-ingress: Ingress rule
 */
export class FrontendService extends pulumi.ComponentResource<FrontendServiceArgs> {
    public readonly service: Service;

    public readonly url!: pulumi.Output<string>;

    private readonly enableTls: boolean;
    private readonly schema: string;
    private readonly targetPort?: string;

    constructor(name: string, args: FrontendServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:FrontendService', name, args, opts);
        this.enableTls = args.enableTls ?? true;
        this.schema = this.enableTls ? 'https' : 'http'
        this.targetPort = args.targetPort;

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
                        if (!this.enableTls && name === "https" && !hasHttp) {
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
}
