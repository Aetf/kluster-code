// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as utilities from "../../utilities";

// Export members:
export { DlbDevicePluginArgs } from "./dlbDevicePlugin";
export type DlbDevicePlugin = import("./dlbDevicePlugin").DlbDevicePlugin;
export const DlbDevicePlugin: typeof import("./dlbDevicePlugin").DlbDevicePlugin = null as any;
utilities.lazyLoad(exports, ["DlbDevicePlugin"], () => require("./dlbDevicePlugin"));

export { DsaDevicePluginArgs } from "./dsaDevicePlugin";
export type DsaDevicePlugin = import("./dsaDevicePlugin").DsaDevicePlugin;
export const DsaDevicePlugin: typeof import("./dsaDevicePlugin").DsaDevicePlugin = null as any;
utilities.lazyLoad(exports, ["DsaDevicePlugin"], () => require("./dsaDevicePlugin"));

export { FpgaDevicePluginArgs } from "./fpgaDevicePlugin";
export type FpgaDevicePlugin = import("./fpgaDevicePlugin").FpgaDevicePlugin;
export const FpgaDevicePlugin: typeof import("./fpgaDevicePlugin").FpgaDevicePlugin = null as any;
utilities.lazyLoad(exports, ["FpgaDevicePlugin"], () => require("./fpgaDevicePlugin"));

export { GpuDevicePluginArgs } from "./gpuDevicePlugin";
export type GpuDevicePlugin = import("./gpuDevicePlugin").GpuDevicePlugin;
export const GpuDevicePlugin: typeof import("./gpuDevicePlugin").GpuDevicePlugin = null as any;
utilities.lazyLoad(exports, ["GpuDevicePlugin"], () => require("./gpuDevicePlugin"));

export { IaaDevicePluginArgs } from "./iaaDevicePlugin";
export type IaaDevicePlugin = import("./iaaDevicePlugin").IaaDevicePlugin;
export const IaaDevicePlugin: typeof import("./iaaDevicePlugin").IaaDevicePlugin = null as any;
utilities.lazyLoad(exports, ["IaaDevicePlugin"], () => require("./iaaDevicePlugin"));

export { QatDevicePluginArgs } from "./qatDevicePlugin";
export type QatDevicePlugin = import("./qatDevicePlugin").QatDevicePlugin;
export const QatDevicePlugin: typeof import("./qatDevicePlugin").QatDevicePlugin = null as any;
utilities.lazyLoad(exports, ["QatDevicePlugin"], () => require("./qatDevicePlugin"));

export { SgxDevicePluginArgs } from "./sgxDevicePlugin";
export type SgxDevicePlugin = import("./sgxDevicePlugin").SgxDevicePlugin;
export const SgxDevicePlugin: typeof import("./sgxDevicePlugin").SgxDevicePlugin = null as any;
utilities.lazyLoad(exports, ["SgxDevicePlugin"], () => require("./sgxDevicePlugin"));


const _module = {
    version: utilities.getVersion(),
    construct: (name: string, type: string, urn: string): pulumi.Resource => {
        switch (type) {
            case "kubernetes:deviceplugin.intel.com/v1:DlbDevicePlugin":
                return new DlbDevicePlugin(name, <any>undefined, { urn })
            case "kubernetes:deviceplugin.intel.com/v1:DsaDevicePlugin":
                return new DsaDevicePlugin(name, <any>undefined, { urn })
            case "kubernetes:deviceplugin.intel.com/v1:FpgaDevicePlugin":
                return new FpgaDevicePlugin(name, <any>undefined, { urn })
            case "kubernetes:deviceplugin.intel.com/v1:GpuDevicePlugin":
                return new GpuDevicePlugin(name, <any>undefined, { urn })
            case "kubernetes:deviceplugin.intel.com/v1:IaaDevicePlugin":
                return new IaaDevicePlugin(name, <any>undefined, { urn })
            case "kubernetes:deviceplugin.intel.com/v1:QatDevicePlugin":
                return new QatDevicePlugin(name, <any>undefined, { urn })
            case "kubernetes:deviceplugin.intel.com/v1:SgxDevicePlugin":
                return new SgxDevicePlugin(name, <any>undefined, { urn })
            default:
                throw new Error(`unknown resource type ${type}`);
        }
    },
};
pulumi.runtime.registerResourceModule("crds", "deviceplugin.intel.com/v1", _module)
