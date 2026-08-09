import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { NamespaceProbe, HelmChart } from "#src/utils";

interface CloudNativePgArgs {
}

export class CloudNativePg extends pulumi.ComponentResource<CloudNativePgArgs> {
    public readonly chart: HelmChart;
    public readonly barmanPlugin: HelmChart;

    constructor(name: string, args: CloudNativePgArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:CloudNativePg', name, args, opts);

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.chart = new HelmChart(name, {
            namespace,
            chart: "cloudnative-pg",
            values: {
                resources: {
                    requests: { cpu: "5m", memory: "128Mi" },
                    limits: { cpu: "20m", memory: "128Mi" },
                },

            }
        }, { parent: this });

        // Barman Cloud CNPG-I plugin, the replacement for the deprecated in-tree
        // `.spec.backup.barmanObjectStore`. Required because the maintained
        // postgres base images (`<major>-standard-<distro>`) no longer ship the
        // barman-cloud binaries; only the frozen legacy `-bookworm` tags do.
        //
        // Has to live in the same namespace as the operator, which is where this
        // component already is. It brings its own CRD, RBAC, self-signed Issuer
        // and Certificates, so it needs cert-manager from BaseCluster to be up.
        this.barmanPlugin = new HelmChart(`${name}-barman-plugin`, {
            namespace,
            chart: "plugin-barman-cloud",
            values: {
                // Otherwise everything is named `<release>-plugin-barman-cloud`;
                // this keeps it as the plain `barman-cloud` upstream's docs and
                // troubleshooting commands assume.
                fullnameOverride: "barman-cloud",
                resources: {
                    requests: { cpu: "5m", memory: "64Mi" },
                    limits: { memory: "128Mi" },
                },
            }
        }, { parent: this, dependsOn: [this.chart] });
    }
}

