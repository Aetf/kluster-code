import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster } from "./base-cluster";
import { Serving } from "./serving";
import { K8sDashboard } from "./k8s-dashboard";
import { Nginx } from "./nginx";

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
        authDomain: 'unlimited-code.works',
        externalIPs: [
            "45.77.144.92",
            // TODO: add zerotier-one IP
        ],
        certificates: [{
            main: 'unlimited-code.works',
            sans: [
                "*.unlimited-code.works",
                "*.hosts.unlimited-code.works",
                "*.stats.unlimited-code.works",
            ],
        }, {
            main: 'unlimitedcodeworks.xyz',
            sans: [
                "*.unlimitedcodeworks.xyz",
                "*.archvps.unlimitedcodeworks.xyz",
            ],
        }, {
            main: 'jiahui.id',
        }, {
            main: 'jiahui.love',
            sans: [
                "*.jiahui.love",
            ],
        }],
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

    // static serving
    const nginx = new Nginx("nginx", {
        serving,
        staticSites: [{
            root: "blog",
            hostNames: [
                "unlimited-code.works",
                "www.unlimited-code.works",
            ],
            extraConfig: `error_page 404 /404.html;`
        }, {
            root: "door-jiahui",
            hostNames: ["jiahui.love"]
        }, {
            root: "door-shiyu",
            hostNames: [
                "games.unlimited-code.works",
                "games.unlimitedcodeworks.xyz",
            ]
        }, {
            root: "door",
            hostNames: [
                "game.unlimited-code.works",
                "game.unlimitedcodeworks.xyz"
            ]
        }, {
            root: 'files',
            hostNames: [
                "static.unlimited-code.works",
                "static.unlimitedcodeworks.xyz"
            ]
        }]
    }, {
        provider: namespaced("nginx"),
    });
}

setup();
