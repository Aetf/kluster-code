
import * as _ from "lodash";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { setAndRegisterOutputs, urlFromService } from "#src/utils";

import { Middleware } from "./traefik";

export interface FrontendServiceArgs {
    host: pulumi.Input<string>,
    targetService: pulumi.Input<k8s.core.v1.Service>,
    targetPort?: string,

    middlewares?: pulumi.Input<Middleware[]>,
    frontendCertName?: string,
    ingressRules?: pulumi.Input<pulumi.Input<k8s.types.input.networking.v1.IngressRule>[]>,
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
                type: 'ExternalName',
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
                annotations: {
                    "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
                    "traefik.ingress.kubernetes.io/router.middlewares": middlewareList,
                }
            },
            spec: {
                tls: [{
                    secretName: args.frontendCertName ?? this.frontendCertNameFromHost(args.host)
                }],
                rules: pulumi.output(args.ingressRules ?? []).apply(rules => [
                    ...rules,
                    {
                        host: args.host,
                        http: {
                            paths: [{
                                path: '/',
                                pathType: 'Prefix',
                                backend: {
                                    service:{
                                        name: this.service.metadata.name,
                                        port: {
                                            name: 'https'
                                        }
                                    }
                                }
                            }]
                        }
                    },
                ])
            }
        }, { parent: this });

        const url = pulumi.output(args.host).apply(h => 'https://' + h);
        setAndRegisterOutputs(this, {
            url
        });
    }

    private frontendCertNameFromHost(host: pulumi.Input<string>): pulumi.Output<string> {
        return pulumi.output(host).apply(host => {
            // NOTE: keep in sync with naming logic in certs.ts
            // take the TLD
            const tld = host.split('.').slice(-2).join('.');
            return `cert-${tld}`;
        });
    }
}
