// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * FpgaDevicePlugin is the Schema for the fpgadeviceplugins API. It represents the FPGA device plugin responsible for advertising Intel FPGA hardware resources to the kubelet.
 */
export class FpgaDevicePlugin extends pulumi.CustomResource {
    /**
     * Get an existing FpgaDevicePlugin resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): FpgaDevicePlugin {
        return new FpgaDevicePlugin(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:deviceplugin.intel.com/v1:FpgaDevicePlugin';

    /**
     * Returns true if the given object is an instance of FpgaDevicePlugin.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is FpgaDevicePlugin {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === FpgaDevicePlugin.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"deviceplugin.intel.com/v1">;
    public readonly kind!: pulumi.Output<"FpgaDevicePlugin">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    /**
     * FpgaDevicePluginSpec defines the desired state of FpgaDevicePlugin.
     */
    public readonly spec!: pulumi.Output<outputs.deviceplugin.v1.FpgaDevicePluginSpec | undefined>;
    /**
     * FpgaDevicePluginStatus defines the observed state of FpgaDevicePlugin.
     */
    public readonly status!: pulumi.Output<outputs.deviceplugin.v1.FpgaDevicePluginStatus | undefined>;

    /**
     * Create a FpgaDevicePlugin resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: FpgaDevicePluginArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "deviceplugin.intel.com/v1";
            resourceInputs["kind"] = "FpgaDevicePlugin";
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
        super(FpgaDevicePlugin.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a FpgaDevicePlugin resource.
 */
export interface FpgaDevicePluginArgs {
    apiVersion?: pulumi.Input<"deviceplugin.intel.com/v1">;
    kind?: pulumi.Input<"FpgaDevicePlugin">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * FpgaDevicePluginSpec defines the desired state of FpgaDevicePlugin.
     */
    spec?: pulumi.Input<inputs.deviceplugin.v1.FpgaDevicePluginSpecArgs>;
    /**
     * FpgaDevicePluginStatus defines the observed state of FpgaDevicePlugin.
     */
    status?: pulumi.Input<inputs.deviceplugin.v1.FpgaDevicePluginStatusArgs>;
}
