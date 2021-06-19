import * as k8s from "@pulumi/kubernetes";

export type InputObjectMeta = k8s.types.input.meta.v1.ObjectMeta;
export type ObjectMeta = k8s.types.output.meta.v1.ObjectMeta;
