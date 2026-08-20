import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { versions } from "#src/config";
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
                                    vendor: { op: "In", value: ["8086"] as any },
                                    class: { op: "In", value: ["0380", "0300"] as any },
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

        this.setupExporter(`${name}-exporter`, namespace);
    }

    /**
     * The device plugin hands out shares of the card but says nothing about
     * what they do with it: whether immich's ffmpeg is really transcoding on
     * the GPU, or quietly fell back to software, is only visible in the i915
     * engine busy counters.
     *
     * The exporter wraps `intel_gpu_top`, which reads the i915 PMU: that needs
     * both /dev/dri and the host PID namespace to attribute usage to
     * processes, hence the privileges. It does NOT request a
     * `gpu.intel.com/i915` share -- the PMU is not a device allocation, and
     * taking one would eat into the five shares the real workloads share.
     */
    private setupExporter(name: string, namespace: pulumi.Output<string>) {
        const labels = { app: name };
        const daemonSet = new k8s.apps.v1.DaemonSet(name, {
            metadata: { namespace },
            spec: {
                selector: { matchLabels: labels },
                template: {
                    metadata: { labels },
                    spec: {
                        // The same NFD label the device plugin itself keys on,
                        // so the exporter lands exactly where a card exists.
                        nodeSelector: { 'intel.feature.node.kubernetes.io/gpu': 'true' },
                        hostPID: true,
                        containers: [{
                            name: 'exporter',
                            image: versions.image.intelGpuExporter,
                            args: ['--interval=5s', '--device=drm:/dev/dri/card0'],
                            ports: [{ name: 'metrics', containerPort: 9100 }],
                            securityContext: { privileged: true },
                            volumeMounts: [{ name: 'dev-dri', mountPath: '/dev/dri' }],
                            resources: {
                                requests: { cpu: '10m', memory: '32Mi' },
                                limits: { cpu: '100m', memory: '64Mi' },
                            },
                        }],
                        volumes: [{
                            name: 'dev-dri',
                            hostPath: { path: '/dev/dri', type: 'Directory' },
                        }],
                    },
                },
            },
        }, { parent: this });

        const service = new k8s.core.v1.Service(name, {
            metadata: { namespace, labels },
            spec: {
                selector: labels,
                clusterIP: 'None',
                ports: [{ name: 'metrics', port: 9100, targetPort: 'metrics' }],
            },
        }, { parent: this, dependsOn: daemonSet });

        return new crds.monitoring.v1.ServiceMonitor(name, {
            metadata: {
                namespace,
                // kube-prometheus-stack's serviceMonitorSelector matches on its
                // own release label; without this the monitor is created and
                // then silently ignored.
                labels: { release: "prometheus" },
            },
            spec: {
                selector: { matchLabels: labels },
                endpoints: [{
                    port: 'metrics',
                    relabelings: [{
                        action: 'replace',
                        sourceLabels: ['__meta_kubernetes_pod_node_name'],
                        targetLabel: 'node',
                    }],
                }],
            },
        }, { parent: this });
    }
}

