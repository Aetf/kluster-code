// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

export class HelmChartConfig extends pulumi.CustomResource {
    /**
     * Get an existing HelmChartConfig resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): HelmChartConfig {
        return new HelmChartConfig(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:helm.cattle.io/v1:HelmChartConfig';

    /**
     * Returns true if the given object is an instance of HelmChartConfig.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is HelmChartConfig {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === HelmChartConfig.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"helm.cattle.io/v1">;
    public readonly kind!: pulumi.Output<"HelmChartConfig">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    public readonly spec!: pulumi.Output<outputs.helm.v1.HelmChartConfigSpec | undefined>;

    /**
     * Create a HelmChartConfig resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: HelmChartConfigArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "helm.cattle.io/v1";
            resourceInputs["kind"] = "HelmChartConfig";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(HelmChartConfig.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a HelmChartConfig resource.
 */
export interface HelmChartConfigArgs {
    apiVersion?: pulumi.Input<"helm.cattle.io/v1">;
    kind?: pulumi.Input<"HelmChartConfig">;
    metadata?: pulumi.Input<ObjectMeta>;
    spec?: pulumi.Input<inputs.helm.v1.HelmChartConfigSpecArgs>;
}
