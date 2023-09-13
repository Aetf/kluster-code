// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as inputs from "../../types/input";
import * as outputs from "../../types/output";
import * as utilities from "../../utilities";

import {ObjectMeta} from "../../meta/v1";

/**
 * TraefikService is the CRD implementation of a Traefik Service. TraefikService object allows to: - Apply weight to Services on load-balancing - Mirror traffic on services More info: https://doc.traefik.io/traefik/v2.10/routing/providers/kubernetes-crd/#kind-traefikservice
 */
export class TraefikService extends pulumi.CustomResource {
    /**
     * Get an existing TraefikService resource's state with the given name, ID, and optional extra
     * properties used to qualify the lookup.
     *
     * @param name The _unique_ name of the resulting resource.
     * @param id The _unique_ provider ID of the resource to lookup.
     * @param opts Optional settings to control the behavior of the CustomResource.
     */
    public static get(name: string, id: pulumi.Input<pulumi.ID>, opts?: pulumi.CustomResourceOptions): TraefikService {
        return new TraefikService(name, undefined as any, { ...opts, id: id });
    }

    /** @internal */
    public static readonly __pulumiType = 'kubernetes:traefik.io/v1alpha1:TraefikService';

    /**
     * Returns true if the given object is an instance of TraefikService.  This is designed to work even
     * when multiple copies of the Pulumi SDK have been loaded into the same process.
     */
    public static isInstance(obj: any): obj is TraefikService {
        if (obj === undefined || obj === null) {
            return false;
        }
        return obj['__pulumiType'] === TraefikService.__pulumiType;
    }

    public readonly apiVersion!: pulumi.Output<"traefik.io/v1alpha1">;
    public readonly kind!: pulumi.Output<"TraefikService">;
    public readonly metadata!: pulumi.Output<ObjectMeta>;
    /**
     * TraefikServiceSpec defines the desired state of a TraefikService.
     */
    public readonly spec!: pulumi.Output<outputs.traefik.v1alpha1.TraefikServiceSpec>;

    /**
     * Create a TraefikService resource with the given unique name, arguments, and options.
     *
     * @param name The _unique_ name of the resource.
     * @param args The arguments to use to populate this resource's properties.
     * @param opts A bag of options that control this resource's behavior.
     */
    constructor(name: string, args?: TraefikServiceArgs, opts?: pulumi.CustomResourceOptions) {
        let resourceInputs: pulumi.Inputs = {};
        opts = opts || {};
        if (!opts.id) {
            resourceInputs["apiVersion"] = "traefik.io/v1alpha1";
            resourceInputs["kind"] = "TraefikService";
            resourceInputs["metadata"] = args ? args.metadata : undefined;
            resourceInputs["spec"] = args ? args.spec : undefined;
        } else {
            resourceInputs["apiVersion"] = undefined /*out*/;
            resourceInputs["kind"] = undefined /*out*/;
            resourceInputs["metadata"] = undefined /*out*/;
            resourceInputs["spec"] = undefined /*out*/;
        }
        opts = pulumi.mergeOptions(utilities.resourceOptsDefaults(), opts);
        super(TraefikService.__pulumiType, name, resourceInputs, opts);
    }
}

/**
 * The set of arguments for constructing a TraefikService resource.
 */
export interface TraefikServiceArgs {
    apiVersion?: pulumi.Input<"traefik.io/v1alpha1">;
    kind?: pulumi.Input<"TraefikService">;
    metadata?: pulumi.Input<ObjectMeta>;
    /**
     * TraefikServiceSpec defines the desired state of a TraefikService.
     */
    spec?: pulumi.Input<inputs.traefik.v1alpha1.TraefikServiceSpecArgs>;
}
