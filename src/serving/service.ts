
import * as _ from "lodash";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { setAndRegisterOutputs, urlFromService } from "#src/utils";

import { Middleware, TLSOption } from "./traefik";

export interface FrontendServiceArgs {
    host: pulumi.Input<string | pulumi.Input<string>[]>,
    targetService: pulumi.Input<k8s.core.v1.Service>,
    targetPort?: string,

    tlsOption?: pulumi.Input<TLSOption>,
    middlewares?: pulumi.Input<Middleware[]>,
}

/**
 * A frontend service. For each service, the following will be installed:
 * <name>-dns: Service of type ExternalName, targeting the corresponding backend Service
 * <name>-ingress: Ingress rule
 */
export class FrontendService extends pulumi.ComponentResource<FrontendServiceArgs> {
    public readonly service: kx.Service;

    public readonly url!: pulumi.Output<string>;

    constructor(name: string, args: FrontendServiceArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:FrontendService', name, args, opts);

        const serviceSpec = pulumi.output(args.targetService)
            .apply(service => ({
                type: k8s.types.enums.core.v1.ServiceSpecType.ExternalName,
                externalName: pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`,
                ports: service.spec.ports.apply(ports => ports.map(port => ({
                    name: port.name,
                    port: port.port,
                })))
            }));

        this.service = new kx.Service(`${name}-dns`, {
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

        const url = pulumi.output(args.host).apply(h => 'https://' + h);
        setAndRegisterOutputs(this, {
            url
        });
    }

    private ingressSpecFromHosts(host: pulumi.Input<string | pulumi.Input<string>[]>): pulumi.Output<k8s.types.input.networking.v1.IngressSpec> {
        return pulumi.output(host).apply(host => {
            const hosts = _.isString(host) ? [host] : host;
            const tls = _.chain(hosts)
                .map(this.tlsFromHost)
                .uniqBy('secretName')
                .value();
            return {
                tls,
                rules: hosts.map(this.ruleFromHost.bind(this)),
            };
        });
    }

    private tlsFromHost(host: string): k8s.types.input.networking.v1.IngressTLS {
        const tld = host.split('.').slice(-2).join('.');
        // NOTE: keep in sync with naming logic in certs.ts
        return { secretName: `cert-${tld}` };
    }

    private ruleFromHost(host: string): k8s.types.input.networking.v1.IngressRule {
        const rule = { host };
        _.set(rule, 'http.paths[0].path', '/');
        _.set(rule, 'http.paths[0].pathType', 'Prefix');
        _.set(rule, 'http.paths[0].backend.service.name', this.service.metadata.name);
        _.set(rule, 'http.paths[0].backend.service.port.name', 'https');
        return rule;
    }
}
