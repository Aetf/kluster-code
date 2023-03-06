// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * FpgaRegion is a specification for a FPGA region resource which can be programmed with a bitstream.
 */
export class FpgaRegion extends pulumi.CustomResource {
    /**
     * Get an existing FpgaRegion resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): FpgaRegion {
        return new FpgaRegion(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:fpga.intel.com/v2:FpgaRegion';

    /**
     * Returns true if the given object is an instance of FpgaRegion.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is FpgaRegion {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === FpgaRegion.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"fpga.intel.com/v2">;
    public readonly kind!: pulumi.Output<"FpgaRegion">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    /**
     * FpgaRegionSpec contains actual specs for FpgaRegion.
     */
    public readonly spec!: pulumi.Output<outputs.fpga.v2.FpgaRegionSpec>;
    /**
     * FpgaRegionStatus is an empty object used to satisfy operator-sdk.
     */
    public readonly status!: pulumi.Output<{[key: string]: any} | undefined>;

    /**
     * Create a FpgaRegion resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: FpgaRegionArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "fpga.intel.com/v2";
            resourceInputs["kind"] = "FpgaRegion";
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
        super(FpgaRegion.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a FpgaRegion resource.
 */
export interface FpgaRegionArgs {
    apiVersion?: pulumi.Input<"fpga.intel.com/v2">;
    kind?: pulumi.Input<"FpgaRegion">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * FpgaRegionSpec contains actual specs for FpgaRegion.
     */
    spec?: pulumi.Input<inputs.fpga.v2.FpgaRegionSpecArgs>;
    /**
     * FpgaRegionStatus is an empty object used to satisfy operator-sdk.
     */
    status?: pulumi.Input<{[key: string]: any}>;
}
