// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as utilities from "../../utilities";

// Export members:
export { HelmChartArgs } from "./helmChart";
export type HelmChart = import("./helmChart").HelmChart;
export const HelmChart: typeof import("./helmChart").HelmChart = null as any;
utilities.lazyLoad(exports, ["HelmChart"], () => require("./helmChart"));

export { HelmChartConfigArgs } from "./helmChartConfig";
export type HelmChartConfig = import("./helmChartConfig").HelmChartConfig;
export const HelmChartConfig: typeof import("./helmChartConfig").HelmChartConfig = null as any;
utilities.lazyLoad(exports, ["HelmChartConfig"], () => require("./helmChartConfig"));

export { HelmChartConfigListArgs } from "./helmChartConfigList";
export type HelmChartConfigList = import("./helmChartConfigList").HelmChartConfigList;
export const HelmChartConfigList: typeof import("./helmChartConfigList").HelmChartConfigList = null as any;
utilities.lazyLoad(exports, ["HelmChartConfigList"], () => require("./helmChartConfigList"));

export { HelmChartConfigPatchArgs } from "./helmChartConfigPatch";
export type HelmChartConfigPatch = import("./helmChartConfigPatch").HelmChartConfigPatch;
export const HelmChartConfigPatch: typeof import("./helmChartConfigPatch").HelmChartConfigPatch = null as any;
utilities.lazyLoad(exports, ["HelmChartConfigPatch"], () => require("./helmChartConfigPatch"));

export { HelmChartListArgs } from "./helmChartList";
export type HelmChartList = import("./helmChartList").HelmChartList;
export const HelmChartList: typeof import("./helmChartList").HelmChartList = null as any;
utilities.lazyLoad(exports, ["HelmChartList"], () => require("./helmChartList"));

export { HelmChartPatchArgs } from "./helmChartPatch";
export type HelmChartPatch = import("./helmChartPatch").HelmChartPatch;
export const HelmChartPatch: typeof import("./helmChartPatch").HelmChartPatch = null as any;
utilities.lazyLoad(exports, ["HelmChartPatch"], () => require("./helmChartPatch"));


const _module = {
    version: utilities.getVersion(),
    construct: (name: string, type: string, urn: string): pulumi.Resource => {
        switch (type) {
            case "kubernetes:helm.cattle.io/v1:HelmChart":
                return new HelmChart(name, <any>undefined, { urn })
            case "kubernetes:helm.cattle.io/v1:HelmChartConfig":
                return new HelmChartConfig(name, <any>undefined, { urn })
            case "kubernetes:helm.cattle.io/v1:HelmChartConfigList":
                return new HelmChartConfigList(name, <any>undefined, { urn })
            case "kubernetes:helm.cattle.io/v1:HelmChartConfigPatch":
                return new HelmChartConfigPatch(name, <any>undefined, { urn })
            case "kubernetes:helm.cattle.io/v1:HelmChartList":
                return new HelmChartList(name, <any>undefined, { urn })
            case "kubernetes:helm.cattle.io/v1:HelmChartPatch":
                return new HelmChartPatch(name, <any>undefined, { urn })
            default:
                throw new Error(`unknown resource type ${type}`);
        }
    },
};
pulumi.runtime.registerResourceModule("crds", "helm.cattle.io/v1", _module)
