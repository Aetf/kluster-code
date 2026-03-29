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

        const haosService = new Service(name, {
            metadata: {
                name: name,
            },
            spec: {
                type: k8s.types.enums.core.v1.ServiceSpecType.ExternalName,
                externalName: args.externalName,
                ports: [
                    { name: 'http', port: 8123 },
                ],
            }
        }, {
            parent: this,
            // the provider is inherited from opts
            deleteBeforeReplace: true,
            aliases: [{
                // The old service was parented by the provider itself
                parent: opts?.provider,
            }]
        });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: haosService,
            // HAOS doesn't support TLS
            enableTls: false,
            // HAOS has its own auth
            // Check out https://github.com/christiaangoossens/hass-oidc-auth when
            // it is mature.
            enableAuth: false,
        });

        this.registerOutputs({});
    }
}

