// *** WARNING: this file was generated by crd2pulumi. ***
// *** Do not edit by hand unless you're certain you know what you are doing! ***

import * as pulumi from "@pulumi/pulumi";
import * as utilities from "../../utilities";

// Export members:
export { GatewayArgs } from "./gateway";
export type Gateway = import("./gateway").Gateway;
export const Gateway: typeof import("./gateway").Gateway = null as any;
utilities.lazyLoad(exports, ["Gateway"], () => require("./gateway"));

export { GatewayClassArgs } from "./gatewayClass";
export type GatewayClass = import("./gatewayClass").GatewayClass;
export const GatewayClass: typeof import("./gatewayClass").GatewayClass = null as any;
utilities.lazyLoad(exports, ["GatewayClass"], () => require("./gatewayClass"));

export { GatewayClassListArgs } from "./gatewayClassList";
export type GatewayClassList = import("./gatewayClassList").GatewayClassList;
export const GatewayClassList: typeof import("./gatewayClassList").GatewayClassList = null as any;
utilities.lazyLoad(exports, ["GatewayClassList"], () => require("./gatewayClassList"));

export { GatewayClassPatchArgs } from "./gatewayClassPatch";
export type GatewayClassPatch = import("./gatewayClassPatch").GatewayClassPatch;
export const GatewayClassPatch: typeof import("./gatewayClassPatch").GatewayClassPatch = null as any;
utilities.lazyLoad(exports, ["GatewayClassPatch"], () => require("./gatewayClassPatch"));

export { GatewayListArgs } from "./gatewayList";
export type GatewayList = import("./gatewayList").GatewayList;
export const GatewayList: typeof import("./gatewayList").GatewayList = null as any;
utilities.lazyLoad(exports, ["GatewayList"], () => require("./gatewayList"));

export { GatewayPatchArgs } from "./gatewayPatch";
export type GatewayPatch = import("./gatewayPatch").GatewayPatch;
export const GatewayPatch: typeof import("./gatewayPatch").GatewayPatch = null as any;
utilities.lazyLoad(exports, ["GatewayPatch"], () => require("./gatewayPatch"));

export { GRPCRouteArgs } from "./grpcroute";
export type GRPCRoute = import("./grpcroute").GRPCRoute;
export const GRPCRoute: typeof import("./grpcroute").GRPCRoute = null as any;
utilities.lazyLoad(exports, ["GRPCRoute"], () => require("./grpcroute"));

export { GRPCRouteListArgs } from "./grpcrouteList";
export type GRPCRouteList = import("./grpcrouteList").GRPCRouteList;
export const GRPCRouteList: typeof import("./grpcrouteList").GRPCRouteList = null as any;
utilities.lazyLoad(exports, ["GRPCRouteList"], () => require("./grpcrouteList"));

export { GRPCRoutePatchArgs } from "./grpcroutePatch";
export type GRPCRoutePatch = import("./grpcroutePatch").GRPCRoutePatch;
export const GRPCRoutePatch: typeof import("./grpcroutePatch").GRPCRoutePatch = null as any;
utilities.lazyLoad(exports, ["GRPCRoutePatch"], () => require("./grpcroutePatch"));

export { HTTPRouteArgs } from "./httproute";
export type HTTPRoute = import("./httproute").HTTPRoute;
export const HTTPRoute: typeof import("./httproute").HTTPRoute = null as any;
utilities.lazyLoad(exports, ["HTTPRoute"], () => require("./httproute"));

export { HTTPRouteListArgs } from "./httprouteList";
export type HTTPRouteList = import("./httprouteList").HTTPRouteList;
export const HTTPRouteList: typeof import("./httprouteList").HTTPRouteList = null as any;
utilities.lazyLoad(exports, ["HTTPRouteList"], () => require("./httprouteList"));

export { HTTPRoutePatchArgs } from "./httproutePatch";
export type HTTPRoutePatch = import("./httproutePatch").HTTPRoutePatch;
export const HTTPRoutePatch: typeof import("./httproutePatch").HTTPRoutePatch = null as any;
utilities.lazyLoad(exports, ["HTTPRoutePatch"], () => require("./httproutePatch"));


const _module = {
    version: utilities.getVersion(),
    construct: (name: string, type: string, urn: string): pulumi.Resource => {
        switch (type) {
            case "kubernetes:gateway.networking.k8s.io/v1:GRPCRoute":
                return new GRPCRoute(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GRPCRouteList":
                return new GRPCRouteList(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GRPCRoutePatch":
                return new GRPCRoutePatch(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:Gateway":
                return new Gateway(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GatewayClass":
                return new GatewayClass(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GatewayClassList":
                return new GatewayClassList(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GatewayClassPatch":
                return new GatewayClassPatch(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GatewayList":
                return new GatewayList(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:GatewayPatch":
                return new GatewayPatch(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:HTTPRoute":
                return new HTTPRoute(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:HTTPRouteList":
                return new HTTPRouteList(name, <any>undefined, { urn })
            case "kubernetes:gateway.networking.k8s.io/v1:HTTPRoutePatch":
                return new HTTPRoutePatch(name, <any>undefined, { urn })
            default:
                throw new Error(`unknown resource type ${type}`);
        }
    },
};
pulumi.runtime.registerResourceModule("crds", "gateway.networking.k8s.io/v1", _module)
