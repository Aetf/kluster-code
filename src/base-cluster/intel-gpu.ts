import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from '#src/crds';
import { versions } from "#src/config";
import { HelmChart, NamespaceProbe } from "#src/utils";

interface IntelDevicePluginsArgs {
}

// PCI device id of the Arc A380 (DG2) on the homelab node, the one card the
// GPU plugin registers and the exporter watches.
const A380_DEVICE_ID = '0x56a5';

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
                // Only the Arc A380. The homelab node also has a UHD 770 iGPU
                // on i915, and the plugin names its resource after the driver,
                // so both cards would land in one gpu.intel.com/i915 pool and
                // a pod would get whichever the plugin picked. The iGPU stays
                // out of Kubernetes; it idles in RC6 at ~0W, so it costs
                // nothing to leave enabled.
                //
                // Keep the iGPU as the BIOS primary display, too. With the
                // firmware console on the A380, simpledrm leaves a dangling
                // /dev/dri/by-path/pci-0000:03:00.0-platform-simple-framebuffer.0-card
                // link behind once i915 takes over; the plugin maps it into
                // every container it hands the card to, and containerd fails
                // them with CreateContainerError.
                allowIDs: A380_DEVICE_ID,
            },
        }, { parent: this });

        this.setupAlerts(`${name}-alerts`, namespace);

        this.setupExporter(`${name}-exporter`, namespace);
    }

    /**
     * The plugin's i915 gRPC server does not always re-register after kubelet
     * drops its socket (a k3s restart can do it) while the monitoring one
     * does, so the pod stays Running while the node's i915 capacity reads 0.
     * Pods already holding the card keep working; the next one to schedule
     * sits Pending on Insufficient gpu.intel.com/i915. Deleting the plugin
     * pod restores registration without disturbing the running consumers.
     */
    private setupAlerts(name: string, namespace: pulumi.Output<string>) {
        return new crds.monitoring.v1.PrometheusRule(name, {
            metadata: {
                namespace,
                labels: { release: "prometheus" },
            },
            spec: {
                groups: [{
                    name: "intel-gpu",
                    rules: [{
                        alert: "IntelGpuNotAllocatable",
                        // A lost registration reads as 0, not as a missing series.
                        expr: 'sum(kube_node_status_allocatable{resource="gpu_intel_com_i915"}) == 0'
                            + ' or absent(kube_node_status_allocatable{resource="gpu_intel_com_i915"})',
                        for: "15m",
                        labels: { severity: "warning" },
                        annotations: {
                            summary: "No node advertises gpu.intel.com/i915",
                            description: "The GPU plugin has stopped advertising the card, so the next immich or jellyfin pod will stay Pending. If `ls /dev/dri` on the host still shows the card, the plugin lost its i915 registration: `kubectl delete pod -n intel-gpu -l app=intel-gpu-plugin`.",
                        },
                    }],
                }],
            },
        }, { parent: this });
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
                            // Select the card by PCI id, passed through to
                            // `intel_gpu_top -d`: cardN numbering follows probe
                            // order and the iGPU is card0 today.
                            args: ['--interval=5s', `--device=pci:vendor=8086,device=${A380_DEVICE_ID.replace(/^0x/, '')}`],
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

