// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

export class SealedSecret extends pulumi.CustomResource {
    /**
     * Get an existing SealedSecret resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): SealedSecret {
        return new SealedSecret(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:bitnami.com/v1alpha1:SealedSecret';

    /**
     * Returns true if the given object is an instance of SealedSecret.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is SealedSecret {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === SealedSecret.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"bitnami.com/v1alpha1">;
    public readonly kind!: pulumi.Output<"SealedSecret">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    public readonly spec!: pulumi.Output<{[key: string]: any} | undefined>;
    public readonly status!: pulumi.Output<{[key: string]: any} | undefined>;

    /**
     * Create a SealedSecret resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: SealedSecretArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "bitnami.com/v1alpha1";
            resourceInputs["kind"] = "SealedSecret";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
            resourceInputs["status"] = args ? args.status : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
            resourceInputs["status"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(SealedSecret.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a SealedSecret resource.
 */
export interface SealedSecretArgs {
    apiVersion?: pulumi.Input<"bitnami.com/v1alpha1">;
    kind?: pulumi.Input<"SealedSecret">;
    metadata?: pulumi.Input<ObjectMeta>;
    spec?: pulumi.Input<{[key: string]: any}>;
    status?: pulumi.Input<{[key: string]: any}>;
}
