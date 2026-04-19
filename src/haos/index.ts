import * as dns from "dns";
import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { Serving } from "#src/serving";
import { Service } from "#src/utils";

export interface HaosArgs {
    serving: Serving;
    host: pulumi.Input<string>;
    externalName: pulumi.Input<string>;
}

/**
 * Homeassistant setups
 */
export class Haos extends pulumi.ComponentResource {
    constructor(name: string, args: HaosArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:haos', name, args, opts);

        const externalIP = pulumi.output(args.externalName).apply(async (name) => {
            try {
                const result = await dns.promises.lookup(name);
                return result.address;
            } catch (e) {
                // If it looks like an IP already, just return it
                if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(name)) {
                    return name;
                }
                throw e;
            }
        });

        const haosService = new Service(name, {
            metadata: {
                name,
                annotations: {
                    // This service doesn't have selector thus no pod to route
                    // traffic. Skip waiting for it in pulumi
                    "pulumi.com/skipAwait": "true",
                },
            },
            spec: {
                type: k8s.types.enums.core.v1.ServiceSpecType.ClusterIP,
                ports: [
                    { name: 'http', port: 8123, targetPort: 8123 },
                ],
            }
        }, {

            parent: this,
            deleteBeforeReplace: true,
        });

        new k8s.core.v1.Endpoints(name, {
            metadata: {
                name: haosService.metadata.name,
            },
            subsets: [{
                addresses: [{ ip: externalIP }],
                ports: [{ name: 'http', port: 8123 }],
            }],
        }, {
            parent: this,
            deleteBeforeReplace: true,
        });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: haosService,
            // HAOS doesn't support TLS
            enableMTls: false,
            // HAOS has its own auth
            // Check out https://github.com/christiaangoossens/hass-oidc-auth when
            // it is mature.
            enableAuth: false,
            useLegacyIngress: false,
            enableGatewayAPI: true,
        });

        this.registerOutputs({});
    }
}

