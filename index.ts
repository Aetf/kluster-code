import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster } from "./base-cluster";
import { Serving } from "./serving";
import { K8sDashboard } from "./k8s-dashboard";

function namespaced(ns: string, args?: k8s.ProviderArgs): k8s.Provider {
    const namespace = new k8s.core.v1.Namespace(ns, {
        metadata: {
            name: ns,
        }
    }, { deleteBeforeReplace: true }).metadata.name;
    return new k8s.Provider(`${ns}-provider`, {
        ...args,
        suppressDeprecationWarnings: true,
        namespace: ns,
    });
}

function setup() {
    const config = new pulumi.Config();
    const isSetupSecrets = config.requireBoolean("setupSecrets");

    // base cluster
    const cluster = new BaseCluster("kluster", { isSetupSecrets }, {
        provider: new k8s.Provider('k8s-provider', {
            suppressDeprecationWarnings: true,
            namespace: 'kube-system'
        })
    });

    if (isSetupSecrets) {
        return;
    }

    // serving
    const serving = new Serving("kluster-serving", {
        base: cluster,
        domain: 'unlimited-code.works',
        externalIPs: [
            "45.77.144.92",
            // TODO: add zerotier-one IP
        ],
        httpPort: 10000,
        httpsPort: 10443,
    }, {
        provider: namespaced('serving-system')
    });

    // dashboard
    const k8sDashboard = new K8sDashboard("dashboard", {
        serving,
    }, {
        provider: namespaced("dashboard"),
    });

    // admin user
    const admin = new k8s.core.v1.ServiceAccount("admin-user", {});
    new k8s.rbac.v1.ClusterRoleBinding("admin-user", {
        roleRef: {
            apiGroup: "rbac.authorization.k8s.io",
            kind: "ClusterRole",
            name: "cluster-admin",
        },
        subjects: [{
            kind: admin.kind,
            name: admin.metadata.name,
            namespace: admin.metadata.namespace,
        }],
    });
}

setup();
