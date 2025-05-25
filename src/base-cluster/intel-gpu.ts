import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { HelmChart, NamespaceProbe } from "#src/utils";

interface IntelDevicePluginsArgs {
}

function deleteUnusedService(obj: any, opts: pulumi.CustomResourceOptions) {
    // This service has wrong targetport spec, and causes pulumi to always
    // waiting for it.

    // Omit a resource from the Chart by transforming the specified resource definition to an empty List.
    const targetName = 'inteldeviceplugins-controller-manager-metrics-service';
    if (obj.kind === 'Service' && obj.metadata.name === targetName) {
        obj.apiVersion = 'v1';
        obj.kind = 'List';
    }
}
/*
 * Intel Device Plugins Operator to manage intel device plugins
 *
 * See also https://intel.github.io/intel-device-plugins-for-kubernetes/cmd/operator/README.html
 *
 */
export class IntelDevicePlugins extends pulumi.ComponentResource<IntelDevicePluginsArgs> {
    public readonly chart: HelmChart;
    public readonly chartGPU: HelmChart;
    public readonly rules: crds.nfd.v1alpha1.NodeFeatureRule;

    constructor(name: string, args: IntelDevicePluginsArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:IntelDevicePlugins', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.rules = new crds.nfd.v1alpha1.NodeFeatureRule(`${name}-rules`, {
            spec: {
                rules: [
                    {
                        name: "intel.gpu",
                        labels: { "intel.feature.node.kubernetes.io/gpu": "true" },
                        matchFeatures: [
                            {
                                feature: "pci.device",
                                matchExpressions: {
                                    vendor: { op: "In", value: ["8086"] },
                                    class: { op: "In", value: ["0380", "0300"] },
                                }
                            },
                            { feature: "kernel.loadedmodule", matchExpressions: { i915: { op: "Exists" } } },
                        ],
                    }
                ]
            }
        }, { parent: this });

        this.chart = new HelmChart(`${name}-operator`, {
            namespace: namespace,
            chart: "intel-device-plugins-operator",
            transformations: [deleteUnusedService],
            values: {
                resources: {
                    requests: { cpu: "8m", memory: "64Mi" },
                    limits: { cpu: "20m", memory: "96Mi" },
                },
            }
        }, { parent: this });

        this.chartGPU = new HelmChart(`${name}-gpu`, {
            namespace: namespace,
            chart: "intel-device-plugins-gpu",
            values: {
                sharedDevNum: 5,
            },
        }, { parent: this });
    }
}

