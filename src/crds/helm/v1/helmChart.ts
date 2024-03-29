// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

export class HelmChart extends pulumi.CustomResource {
    /**
     * Get an existing HelmChart resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): HelmChart {
        return new HelmChart(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:helm.cattle.io/v1:HelmChart';

    /**
     * Returns true if the given object is an instance of HelmChart.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is HelmChart {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === HelmChart.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"helm.cattle.io/v1">;
    public readonly kind!: pulumi.Output<"HelmChart">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    public readonly spec!: pulumi.Output<outputs.helm.v1.HelmChartSpec | undefined>;
    public readonly status!: pulumi.Output<outputs.helm.v1.HelmChartStatus | undefined>;

    /**
     * Create a HelmChart resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: HelmChartArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "helm.cattle.io/v1";
            resourceInputs["kind"] = "HelmChart";
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
        super(HelmChart.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a HelmChart resource.
 */
export interface HelmChartArgs {
    apiVersion?: pulumi.Input<"helm.cattle.io/v1">;
    kind?: pulumi.Input<"HelmChart">;
    metadata?: pulumi.Input<ObjectMeta>;
    spec?: pulumi.Input<inputs.helm.v1.HelmChartSpecArgs>;
    status?: pulumi.Input<inputs.helm.v1.HelmChartStatusArgs>;
}
