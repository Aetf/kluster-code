// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as utilities from "./utilities";

// Export members:
export { ProviderArgs } from "./provider";
export type Provider = import("./provider").Provider;
export const Provider: typeof import("./provider").Provider = null as any;
utilities.lazyLoad(exports, ["Provider"], () => require("./provider"));


// Export sub-modules:
import * as acme from "./acme";
import * as bitnami from "./bitnami";
import * as cert_manager from "./cert_manager";
import * as deviceplugin from "./deviceplugin";
import * as fpga from "./fpga";
import * as gateway from "./gateway";
import * as helm from "./helm";
import * as hub from "./hub";
import * as k3s from "./k3s";
import * as nfd from "./nfd";
import * as postgresql from "./postgresql";
import * as traefik from "./traefik";
import * as types from "./types";

export {
    acme,
    bitnami,
    cert_manager,
    deviceplugin,
    fpga,
    gateway,
    helm,
    hub,
    k3s,
    nfd,
    postgresql,
    traefik,
    types,
};
pulumi.runtime.registerResourcePackage("crds", {
    version: utilities.getVersion(),
    constructProvider: (name: string, type: string, urn: string): pulumi.ProviderResource => {
        if (type !== "pulumi:providers:kubernetes") {
            throw new Error(`unknown provider type ${type}`);
        }
        return new Provider(name, <any>undefined, { urn });
    },
});
