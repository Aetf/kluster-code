import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { NamespaceProbe, HelmChart } from "#src/utils";

interface CloudNativePgArgs {
}

export class CloudNativePg extends pulumi.ComponentResource<CloudNativePgArgs> {
    public readonly chart: HelmChart;

    constructor(name: string, args: CloudNativePgArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:CloudNativePg', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.chart = new HelmChart(name, {
            namespace,
            chart: "cloudnative-pg",
            values: {}
        }, { parent: this });
    }
}

