// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as utilities from "./utilities";

// Export members:
export * from "./provider";

// Export sub-modules:
import * as acme from "./acme";
import * as bitnami from "./bitnami";
import * as certmanager from "./certmanager";
import * as traefik from "./traefik";
import * as types from "./types";

export {
    acme,
    bitnami,
    certmanager,
    traefik,
    types,
};

import { Provider } from "./provider";

pulumi.runtime.registerResourcePackage("crds", {
    version: utilities.getVersion(),
    constructProvider: (name: string, type: string, urn: string): pulumi.ProviderResource => {
        if (type !== "pulumi:providers:crds") {
            throw new Error(`unknown provider type ${type}`);
        }
        return new Provider(name, <any>undefined, { urn });
    },
});