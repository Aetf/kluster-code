// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * ServersTransport is the CRD implementation of a ServersTransport. If no serversTransport is specified, the default@internal will be used. The default@internal serversTransport is created from the static configuration. More info: https://doc.traefik.io/traefik/v2.10/routing/services/#serverstransport_1
 */
export class ServersTransport extends pulumi.CustomResource {
    /**
     * Get an existing ServersTransport resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): ServersTransport {
        return new ServersTransport(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:traefik.io/v1alpha1:ServersTransport';

    /**
     * Returns true if the given object is an instance of ServersTransport.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is ServersTransport {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === ServersTransport.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"traefik.io/v1alpha1">;
    public readonly kind!: pulumi.Output<"ServersTransport">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    /**
     * ServersTransportSpec defines the desired state of a ServersTransport.
     */
    public readonly spec!: pulumi.Output<outputs.traefik.v1alpha1.ServersTransportSpec>;

    /**
     * Create a ServersTransport resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: ServersTransportArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "traefik.io/v1alpha1";
            resourceInputs["kind"] = "ServersTransport";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(ServersTransport.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a ServersTransport resource.
 */
export interface ServersTransportArgs {
    apiVersion?: pulumi.Input<"traefik.io/v1alpha1">;
    kind?: pulumi.Input<"ServersTransport">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * ServersTransportSpec defines the desired state of a ServersTransport.
     */
    spec?: pulumi.Input<inputs.traefik.v1alpha1.ServersTransportSpecArgs>;
}
