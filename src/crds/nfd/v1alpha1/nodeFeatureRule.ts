// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * NodeFeatureRule resource specifies a configuration for feature-based customization of node objects, such as node labeling.
 */
export class NodeFeatureRule extends pulumi.CustomResource {
    /**
     * Get an existing NodeFeatureRule resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): NodeFeatureRule {
        return new NodeFeatureRule(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:nfd.k8s-sigs.io/v1alpha1:NodeFeatureRule';

    /**
     * Returns true if the given object is an instance of NodeFeatureRule.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is NodeFeatureRule {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === NodeFeatureRule.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"nfd.k8s-sigs.io/v1alpha1">;
    public readonly kind!: pulumi.Output<"NodeFeatureRule">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    /**
     * NodeFeatureRuleSpec describes a NodeFeatureRule.
     */
    public readonly spec!: pulumi.Output<outputs.nfd.v1alpha1.NodeFeatureRuleSpec>;

    /**
     * Create a NodeFeatureRule resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: NodeFeatureRuleArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "nfd.k8s-sigs.io/v1alpha1";
            resourceInputs["kind"] = "NodeFeatureRule";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(NodeFeatureRule.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a NodeFeatureRule resource.
 */
export interface NodeFeatureRuleArgs {
    apiVersion?: pulumi.Input<"nfd.k8s-sigs.io/v1alpha1">;
    kind?: pulumi.Input<"NodeFeatureRule">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * NodeFeatureRuleSpec describes a NodeFeatureRule.
     */
    spec?: pulumi.Input<inputs.nfd.v1alpha1.NodeFeatureRuleSpecArgs>;
}
