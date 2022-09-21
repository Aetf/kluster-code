import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster } from "./base-cluster";
import { Serving } from "./serving";
import { K8sDashboard } from "./k8s-dashboard";
import { Nginx } from "./nginx";
import { Nextcloud } from "./nextcloud";
import { Exim } from "./mail";
import { Genshin } from "./genshin";
import { SyncthingDiscosrv } from "./syncthing";
import { Ukulele } from "./ukulele";
import { Mc } from "./mc";
import { Bt } from "./bt";
import { Prometheus } from "./mon";

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
    const staging = config.requireBoolean("staging");

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

    // mail transfer agent
    const mailer = new Exim("exim", {
        base: cluster,
        host: "unlimited-code.works",
    }, {
        provider: namespaced('mail-system')
    });

    // serving
    const serving = new Serving("kluster-serving", {
        base: cluster,
        authDomain: 'unlimited-code.works',
        externalIPs: [
            "45.77.144.92",
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
            ],
        }, {
            main: 'jiahui.id',
        }, {
            main: 'jiahui.love',
            sans: [
                "*.jiahui.love",
            ],
        }],
        smtpHost: mailer.address,
        smtpPort: mailer.port,
        httpPort: staging ? 10000 : 80,
        httpsPort: staging ? 10443 : 443,
    }, {
        provider: namespaced('serving-system')
    });

    // monitoring
    const prometheus = new Prometheus("prometheus", {
        serving,
        host: 'mon.unlimited-code.works',
    }, {
        provider: namespaced("mon"),
    });

    // dashboard
    const k8sDashboard = new K8sDashboard("dashboard", {
        serving,
        host: 'k8s.unlimited-code.works',
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
                "unlimitedcodeworks.xyz",
                "www.unlimitedcodeworks.xyz",
            ],
            extraConfig: `error_page 404 /404.html;`
        }, {
            root: "door-jiahui",
            hostNames: ["jiahui.love"]
        }, {
            root: "door-shiyu",
            hostNames: [
                "games.unlimitedcodeworks.xyz",
            ]
        }, {
            root: "door",
            hostNames: [
                "game.unlimitedcodeworks.xyz"
            ]
        }]
    }, {
        provider: namespaced("nginx"),
    });

    // nextcloud
    /* const nextcloud = new Nextcloud("nextcloud", {
        serving,
        host: 'files.unlimited-code.works',
        smtpHost: mailer.address,
        smtpPort: mailer.port,
    }, {
        provider: namespaced("nextcloud"),
    }); */

    // genshin everyday task
    const genshin = new Genshin("genshin", {
    }, {
        provider: namespaced("genshin")
    });

    // syncthing
    const stdiscosrv = new SyncthingDiscosrv("stdiscosrv", {
        serving,
        host: 'stdiscosrv.unlimited-code.works',
        externalIPs: [
            "45.77.144.92",
        ]
    }, {
        provider: namespaced("syncthing")
    });

    // ukulele, a discord music bot
    // install into default namespace
    const ukulele = new Ukulele("ukulele", {
        base: cluster,
    });

    // Minecraft server
    const mc = new Mc("mc", {
        base: cluster,
        externalIPs: [
            "45.77.144.92",
            "192.168.70.85",
        ]
    }, {
        provider: namespaced("mc")
    });

    // transmission bt with openvpn
    const bt = new Bt("bt", {
        serving,
        host: 'bt.unlimited-code.works',
    }, {
        provider: namespaced("bt"),
    });
}

setup();
