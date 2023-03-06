// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * Middleware is the CRD implementation of a Traefik Middleware. More info: https://doc.traefik.io/traefik/v2.9/middlewares/http/overview/
 */
export class Middleware extends pulumi.CustomResource {
    /**
     * Get an existing Middleware resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): Middleware {
        return new Middleware(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:traefik.containo.us/v1alpha1:Middleware';

    /**
     * Returns true if the given object is an instance of Middleware.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is Middleware {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === Middleware.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"traefik.containo.us/v1alpha1">;
    public readonly kind!: pulumi.Output<"Middleware">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    /**
     * MiddlewareSpec defines the desired state of a Middleware.
     */
    public readonly spec!: pulumi.Output<outputs.traefik.v1alpha1.MiddlewareSpec>;

    /**
     * Create a Middleware resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: MiddlewareArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "traefik.containo.us/v1alpha1";
            resourceInputs["kind"] = "Middleware";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(Middleware.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a Middleware resource.
 */
export interface MiddlewareArgs {
    apiVersion?: pulumi.Input<"traefik.containo.us/v1alpha1">;
    kind?: pulumi.Input<"Middleware">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * MiddlewareSpec defines the desired state of a Middleware.
     */
    spec?: pulumi.Input<inputs.traefik.v1alpha1.MiddlewareSpecArgs>;
}
