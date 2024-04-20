import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { config } from "./config";
import { BaseCluster, NodePV } from "./base-cluster";
import { Serving } from "./serving";
import { K8sDashboard } from "./k8s-dashboard";
import { Nginx } from "./nginx";
import { Exim } from "./mail";
import { Genshin } from "./genshin";
import { SyncthingDiscosrv, Syncthing } from "./syncthing";
import { Ukulele } from "./ukulele";
import { Mc } from "./mc";
import { Bt } from "./bt";
import { Prometheus } from "./mon";
import { IntelDevicePlugins } from "./base-cluster/intel-gpu";
import { Jellyfin } from "./jellyfin";
import { Shoko } from "./shoko";
import { Dufs } from "./dav";
import { CloudNativePg } from "./postgresql";
import { Immich } from "./immich";
import { Hath } from "./hath";
import { Service } from "./utils";

function namespaced(ns: string, createNs?: boolean, args?: k8s.ProviderArgs): k8s.Provider {
    if (createNs ?? true) {
        const namespace = new k8s.core.v1.Namespace(ns, {
            metadata: {
                name: ns,
            }
        }, { deleteBeforeReplace: true });
    }
    return new k8s.Provider(`${ns}-provider`, {
        ...args,
        suppressDeprecationWarnings: true,
        namespace: ns,
    });
}

function setup() {
    // base cluster
    const cluster = new BaseCluster("kluster", { isSetupSecrets: config.setupSecrets }, {
        provider: new k8s.Provider('k8s-provider', {
            suppressDeprecationWarnings: true,
            namespace: 'kube-system'
        }),
    });

    if (config.setupSecrets) {
        return;
    }

    // intel gpu device plugin
    const intelGPU = new IntelDevicePlugins("intel-gpu", {
    }, {
        provider: namespaced('intel-gpu')
    });

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
        smtp: mailer.smtpService,

        externalIPs: [
            "45.77.144.92",
        ],
        httpPort: config.staging ? 10000 : 80,
        httpsPort: config.staging ? 10443 : 443,

        domain: 'unlimited-code.works',
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
    }, { provider: namespaced('serving-system') });

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

    const webdav = new Dufs("dav", {
        serving,
        host: 'dav.unlimited-code.works',
    }, {
        provider: namespaced("dav")
    });

    // Database infrastructure
    const cnpg = new CloudNativePg("cnpg", {}, {
        provider: namespaced("cnpg-system"),
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
    const syncthingProvider = namespaced("syncthing");
    const syncthing = new Syncthing("syncthing", {
        serving,
        host: 'sync.unlimited-code.works',
        storageClassName: cluster.jfsStorageClass.metadata.name,
    }, { provider: syncthingProvider });
    const stdiscosrv = new SyncthingDiscosrv("stdiscosrv", {
        serving,
        host: 'syncapi.unlimited-code.works',
    }, { provider: syncthingProvider, });

    // ukulele, a discord music bot
    // install into default namespace
    const ukulele = new Ukulele("ukulele", {
        base: cluster,
    });

    // Minecraft server
    if (config.enableMc) {
        const mc = new Mc("mc", {
            base: cluster,
            externalIPs: [
                "45.77.144.92",
                "192.168.70.85",
            ]
        }, {
            provider: namespaced("mc"),
        });
    }

    // All media goes in one namespace because otherwise they can not share the
    // NodePV
    const mediaProvider = namespaced("media");
    const mediaPv = new NodePV('media-pv', {
        path: "/mnt/nas/Media",
        node: cluster.nodes.AetfArchHomelab,
        capacity: "10Ti",
        accessModes: ["ReadOnlyMany"]
    }, { provider: mediaProvider });

    // transmission bt with openvpn
    /*
    const bt = new Bt("bt", {
        serving,
        host: 'bt.unlimited-code.works',
        pvc: mediaPv.pvc,
    }, { provider: mediaProvider, });
    */

    // media serving using jellyfin
    const jellyfin = new Jellyfin("jellyfin", {
        base: cluster,
        pvc: mediaPv.pvc,
    }, { provider: mediaProvider });

    const shoko = new Shoko("shoko", {
        base: cluster,
        pvc: mediaPv.pvc,
    }, { provider: mediaProvider });

    // Photo service using Immich
    const immich = new Immich("immich", {
        serving,
        host: 'photos.unlimited-code.works',
        storageClass: cluster.jfsStorageClass.metadata.name,
        dbStorageClass: cluster.localStableStorageClass.metadata.name,
        cacheStorageClass: cluster.localStorageClass.metadata.name,
    }, { provider: namespaced('immich') });

    // Hath@Home
    const hath = new Hath('hath', {
        base: cluster,
        storageClassName: cluster.jfsStorageClass.metadata.name,
    }, { provider: namespaced('hath') });

    // HaOS
    const haosProvider = namespaced('haos');
    const haosService = new Service(`haos`, {
        metadata: {
            name: 'haos'
        },
        spec: {
            type: k8s.types.enums.core.v1.ServiceSpecType.ExternalName,
            externalName: 'haos.zt.unlimited-code.works',
            ports: [
                { name: 'http', port: 8123 },
            ],
        }
    }, { parent: haosProvider, deleteBeforeReplace: true });

    new k8s.networking.v1.Ingress('haos', {
        metadata: {
            annotations: {
                "traefik.ingress.kubernetes.io/router.entrypoints": "websecure",
            }
        },
        spec: {
            tls: [
                { secretName: 'cert-unlimited-code.works' },
            ],
            rules: [{
                host: 'haos.unlimited-code.works',
                http: {
                    paths: [{
                        path: '/',
                        pathType: 'Prefix',
                        backend: {
                            service: {
                                name: 'haos',
                                port: {
                                    name: 'http'
                                }
                            },
                        }
                    }]
                }
            }]
        },
    }, { parent: haosProvider });

}

setup();

