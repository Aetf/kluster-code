// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

/**
 * FpgaDevicePluginList is a list of FpgaDevicePlugin
 */
export class FpgaDevicePluginList extends pulumi.CustomResource {
    /**
     * Get an existing FpgaDevicePluginList resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): FpgaDevicePluginList {
        return new FpgaDevicePluginList(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:deviceplugin.intel.com/v1:FpgaDevicePluginList';

    /**
     * Returns true if the given object is an instance of FpgaDevicePluginList.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is FpgaDevicePluginList {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === FpgaDevicePluginList.__pulumiType;
    }

    /**
     * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources
     */
    public readonly apiVersion!: pulumi.Output<"deviceplugin.intel.com/v1">;
    /**
     * List of fpgadeviceplugins. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md
     */
    public readonly items!: pulumi.Output<outputs.deviceplugin.v1.FpgaDevicePlugin[]>;
    /**
     * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
     */
    public readonly kind!: pulumi.Output<"FpgaDevicePluginList">;
    /**
     * Standard list metadata. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
     */
    public readonly metadata!: pulumi.Output<outputs.meta.v1.ListMeta>;

    /**
     * Create a FpgaDevicePluginList resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: FpgaDevicePluginListArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            if ((!args || args.items === undefined) && !opts.urn) {
                throw new Error("Missing required property 'items'");
            }
            resourceInputs["apiVersion"] = "deviceplugin.intel.com/v1";
            resourceInputs["items"] = args ? args.items : undefined;
            resourceInputs["kind"] = "FpgaDevicePluginList";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["items"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(FpgaDevicePluginList.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a FpgaDevicePluginList resource.
 */
export interface FpgaDevicePluginListArgs {
    /**
     * APIVersion defines the versioned schema of this representation of an object. Servers should convert recognized schemas to the latest internal value, and may reject unrecognized values. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#resources
     */
    apiVersion?: pulumi.Input<"deviceplugin.intel.com/v1">;
    /**
     * List of fpgadeviceplugins. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md
     */
    items: pulumi.Input<pulumi.Input<inputs.deviceplugin.v1.FpgaDevicePlugin>[]>;
    /**
     * Kind is a string value representing the REST resource this object represents. Servers may infer this from the endpoint the client submits requests to. Cannot be updated. In CamelCase. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
     */
    kind?: pulumi.Input<"FpgaDevicePluginList">;
    /**
     * Standard list metadata. More info: https://git.k8s.io/community/contributors/devel/sig-architecture/api-conventions.md#types-kinds
     */
    metadata?: pulumi.Input<inputs.meta.v1.ListMeta>;
}