import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { config } from "./config";
import { BaseCluster, NodePV } from "./base-cluster";
import { Serving } from "./serving";
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
import { Spoolman } from "./spoolman";
import { Haos } from "./haos";


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

        externalIPs: new pulumi.Config().requireObject<string[]>('servingExternalIPs'),
        httpPort: config.staging ? 10000 : 80,
        httpsPort: config.staging ? 10443 : 443,

        domain: 'unlimited-code.works',
        // TLS passthrough listeners (SNI routing, no termination).
        // Keep in sync with the hosts of tlsPassthrough FrontendServices.
        passthroughHosts: [
            'syncapi.unlimited-code.works',
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
    }, { provider: namespaced('serving-system') });

    // monitoring
    const prometheus = new Prometheus("prometheus", {
        serving,
        domain: 'unlimited-code.works',
        subdomain: 'mon',
        authSubdomain: 'auth',

        smtp: mailer.smtpService,
    }, {
        provider: namespaced("mon"),
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
        // stable device id
        deviceKeyEncrypted: "AgACZGpBExpkr6biwFKd2n25WUdqmNrlu75DZsqRyJfCEbRah2mrGlhSNgOboVSiRr4lSC7WvGieud8Vqo8JtqIjfAmToLCs0zgYW/2+/jQoqsnIygFnJBel9v9ZXTEm89jI2tSJjQSOASD7NWm/J8fknV7o44BNBYf8zde844JGUQaGDkYNhPvdflmCoL3EPlle5Qi22G0QtcL8UOANEH0RJvOhyQZKWZxBerITg36OPAVPVRcIdN4HTeQ6DuDf21je+AwozhhRhCIz35z0FKA0bN7vwKMF3ixTAry+8vLIi78H1zmhC1+nFuN02GzJcyfvQeL5I4XV1aS1CwOTPRRzoVH3UfdJ6hp8SU+H1malhzAquAKMmJO+Q9NVDtgrRXERa7xRvGOZdvkUHwxDzAmiifvDEpFThywxnqQxy4ECQohWPxLU1uTssd07ldbm0oRIhDiwShPr2qOwwnCBagsWAbk9b3geBtJP+NJEYCOgbGLJaPXjMhOdx6YRyyVvCLQsJ8ilFt+a+ksIoUuatp0S6zGv+g/UVp0dWYUDiwXwImQtr29f/Lytf0Ij7T6CiqztuFu7y93eCeeVD7QFIdWNt2LPjeK0iAAayTw6o115tCOLqjp0WcRSt3kmwTkNhMTyQT4SlzkZEXF6A/oH3tqJE7GcF01bNE/BQfcQXSn/jx4L9gEa3cA/8K9sxt/XQlxFoYGZLFcUvkNsZgAo0cEvC8LdnPQYQ0a5N+7yd0s/T6ntSRRU5Vyl1iTOIObxuTsJQC+gaEICy/bIeNE7rCYDjTnNtNSOqq5aYKBNVSZmL5Qus1MRYYO65jW2/gaPGZNme3XIjOnRsjLC1BfOpHDqIec7xLOzPGbK5/INxdzbfCgDTJWBRTB6mOd9QZYSaaRu0LxdD503wcdl1HXOvL7SQjyg04MWOkBYC2xwCQdRJAbbNmJvMT8/rDqDJJsXONoJHCsQ+FiiHw4M3qGlW9WAodW0CBccituaxOkQut+wCMkj/A0Z3SwU1QPvWRF+cyLIt3rrpT53BX2Nz2DzNtQEn/+89xfGhBL944Ye4c0pAdZ0fNO3+rdYPnCSoYsafQ==",
        // gdrive bridge lives only on this instance
        gdriveSync: {
            guiApiKeyEncrypted: "AgCVwizCACarbMM/AEOnbYbhP7CaHCNC70Se+oVY4LnX1AyhNzUvoi0jUGfbxdvEy6QCaOTvW4bzDAhtMXna/N134Hv8aq3XwDfb1b1+spODSudfcK7ElcSaTzAb4+bS065Ls01TGs5zRv5I5zKszUNSuWKyk3cXptUKpL+ZZSrRX0msavX3Uo1GOdgZyfdLjA/Q6HMgn013eaHz8lnDEL2lUh99sXnCI9afCFu+J5dTsa8FlVAeecsEZpJ6irbvMTmULekvhxg2qEeeWgobiZF9eTZOdn9jq8vGJ0Zlugd5emSPOE7bLxIDm0wsr6seZlkaIvz8pjE7NdnEvGo3uliK6/alcgGdunZiOoXUfHVJusDhevKZS42BZgUcX1ad9zZCUDSbkg1TJ5aHomOHkRA3Dd/E8X2YB603W+U3R7XvxuwNORbr4WdOX14Uw3EGOSOWFJBbrAoqzzkT8y3ArfS0S7oddz+hHCD8kStX/VmIQrrLVahh2nrI7CLLIa4G7sps53vIDa/slaBYvzJ2dYkwKvOSobtnYWfppvEdstNLoBwtdaNbLurRzb2EiwRCx/qadhXAV2QKHO/1o+ACqGrHzLxEbHsxs9QYNMor9SV0uIbIr25JT2qRmvXDO1mgga+Z9x20WmThhr5HrRcikJoR6ccnC8vQ+8JHxaFBXX8Xtt01xmg24pv0zwSLwgwtmAzpy9zNFsGaYG341TpLwU0uSSJXJX+8OBSy7E+8zcgsBojL/UJqMri3Tl7oRygHBOM=",
            rcloneServiceAccountEncrypted: "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",
            rcloneTeamDriveEncrypted: "AgCZPy+Wq2f1oS9dOX2x7Q60XhierD1+wqrxcNrTgFii5WvBmHeW2H1YXrB/9KAs7L8CiAmlvIf92++cXeDEfEqLqsSgHISGeKARhPnkJe4kNSblJVOhrCAQ5G04CEmd1eepeyfOaf06SYrSO6cjfCXxp1YjnjzGx0gWa9ST9K8qvUng0MzBfKPVAjF8gaSjUkp70DPREOltHArsBcyAtMc5pAsCWKkBQiMldm777uDR+CVsnn0S6D8xownMq9A/BYaFH83WzkIxW49gXaA83iG/6iMTASFWOyOBDx3Ao6VLsN08SXeoYL88/uJIdrHHX41ScIbecT/LxQq3NQDZTJCcCNXgmgrXV7PPekLw09ASS8cdolyN1qfpU2GWaCdUP1dBLhevEHTMTLXdBWt38HLOT8Vwi5N//vjl1z2ZPtQEi7vir8pUxU9Oj63ZxL44nILi085Q64FG+TUqmP1iR+ZtgoEe4aL5bkB4/hkR6oZdhSugnJhvV8qY4y6RhbRRMd47p/zi7LgfIWSI+MH3Wyj2hEVpiztUGIcS3E9fmYTc2ti35IuFqS6hdTKpimyOkiE1fsvNAsJZoR71BVEUcvqTvCajQwRH8JhHankSycsxjmg5UGAGLPSbsguYs/obT9R7MFCYh+RPUFkjh/sTaCp/1JcrVylHB0mU5AAdbBWOUPP8oRCMf/lMs4ITrlVDgHpeKsMms3O5810c3dGHt6QOxra/",
        },
        juicefsColocation: true,
        syncLbPool: 'internet',
    }, { provider: syncthingProvider });
    const stdiscosrv = new SyncthingDiscosrv("stdiscosrv", {
        serving,
        host: 'syncapi.unlimited-code.works',
    }, { provider: syncthingProvider, });

    // Second syncthing on the homelab, backed by the /mnt/nas/Sync host path.
    // Own namespace so the static NodePV PVC isn't shared cross-namespace.
    const syncthingNasProvider = namespaced("syncthing-nas");
    const syncNasPv = new NodePV('sync-nas-pv', {
        path: "/mnt/nas/Sync",
        node: cluster.nodes.AetfArchHomelab,
        capacity: "1Ti",
        accessModes: ["ReadWriteOnce"],
    }, { provider: syncthingNasProvider });
    const syncthingNas = new Syncthing("syncthing-nas", {
        serving,
        host: 'sync-nas.unlimited-code.works',
        dataPvc: syncNasPv.pvc,      // static /mnt/nas/Sync PV
        juicefsColocation: false,    // pinned to homelab node by the PV instead
        syncLbPool: 'homelan',       // reachable on home-LAN + ZeroTier, no internet LB
        // no deviceKeyEncrypted -> self-generated device id
        // no gdriveSync         -> no gdrive bridge
    }, { provider: syncthingNasProvider });

    // ukulele, a discord music bot
    // install into default namespace
    if (config.enableUkulele) {
        const ukulele = new Ukulele("ukulele", {
            base: cluster,
        });
    }

    // Minecraft server
    if (config.enableMc) {
        const mc = new Mc("mc", {
            base: cluster,
            serving,
            mapHost: "mcmap.unlimited-code.works"
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
    if (config.enableBt) {
        const bt = new Bt("bt", {
            serving,
            host: 'bt.unlimited-code.works',
            pvc: mediaPv.pvc,
        }, { provider: mediaProvider, });
    }

    // media serving using jellyfin
    const jellyfin = new Jellyfin("jellyfin", {
        serving,
        host: 'tube.unlimited-code.works',
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
    const haos = new Haos("haos", {
        serving,
        host: 'haos.unlimited-code.works',
        externalName: 'haos.zt.unlimited-code.works',
    }, { provider: namespaced('haos') });


    const spoolman = new Spoolman("spoolman", {
        serving,
        host: 'spool.unlimited-code.works',
    }, {
        provider: namespaced("spool")
    });
}

setup();

