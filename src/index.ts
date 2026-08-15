import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as fs from "fs";
import * as os from "os";

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
import { EgressGateway } from "./egress";
import { Hath } from "./hath";
import { SealedSecret, Service } from "./utils";
import { Spoolman } from "./spoolman";
import { Haos } from "./haos";
import { Splitpro } from "./splitpro";


// All k8s providers connect using the ambient kubeconfig. We pass its *content*
// (not the resolved path) so provider state is identical no matter where Pulumi
// runs: locally the path is ~/.config/kube/config, in CI it is
// /home/runner/.kube/config, and storing the path churns the state on every run.
// Wrapped in pulumi.secret() so the admin credentials stay encrypted in state.
const kubeconfig = pulumi.secret(
    fs.readFileSync(process.env["KUBECONFIG"] ?? `${os.homedir()}/.kube/config`, "utf8"),
);

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
        kubeconfig,
        suppressDeprecationWarnings: true,
        namespace: ns,
    });
}

function setup() {
    // base cluster
    const cluster = new BaseCluster("kluster", { isSetupSecrets: config.setupSecrets }, {
        provider: new k8s.Provider('k8s-provider', {
            kubeconfig,
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

    // Hath@Home. Its public identity is the vps IP its LoadBalancer sits on,
    // so it egresses through the vps too -- which is what lets the pod be
    // scheduled on homelab, next to a disk big enough for its cache.
    const hathProvider = namespaced('hath');
    const hathEgress = new EgressGateway('hath-egress', {
        node: cluster.nodes.AetfArchVPS,
        endpointHost: 'aetf-arch-vps.zt.unlimited-code.works',
    }, { provider: hathProvider });
    // Storage was jfs-backed (S3) until the jfs local block cache, shared and
    // far smaller than hath's ~50GiB working set, turned most image serves into
    // an S3 GetObject -- the dominant driver of the AWS bill. Moved to a
    // NAS-backed NodePV, following media-pv/sync-nas-pv.
    const hathPv = new NodePV('hath-pv', {
        path: "/mnt/nas/Hath",
        node: cluster.nodes.AetfArchHomelab,
        capacity: "60Gi",
        accessModes: ["ReadWriteOnce"],
    }, { provider: hathProvider });
    const hath = new Hath('hath', {
        base: cluster,
        dataPvc: hathPv.pvc,
        juicefsColocation: false, // pinned to homelab by the PV instead
        egress: hathEgress,
    }, { provider: hathProvider });

    // HaOS
    const haos = new Haos("haos", {
        serving,
        host: 'haos.unlimited-code.works',
        externalName: 'haos.zt.unlimited-code.works',
    }, { provider: namespaced('haos') });


    const splitproProvider = namespaced("splitpro");
    // Expense splitting. Unlike most apps here it is not behind the forward-auth
    // middleware -- it has its own accounts and talks to Authelia over OIDC.
    const splitproSecret = new SealedSecret("splitpro-auth", {
        spec: {
            encryptedData: {
                nextauth_secret: "AgCxrza2/SyI6annNOkX8Otwsg7o6zOmD+NzSEveY+y9pEUkhVZlRlE6wWgSzdwrnAwa64GMPiVauOE4vFXZ9HFlyR0mm+7xBo3WlDgsGPGo3ZcDf4UUL/H2UPLjqRdYWtlgUaXfs+L3G9FnvFYWTud8b4fl1cKQZv7k+g0OMm11roD9yUwi1v9vCE3iZ5TNUBCUm2dW0q1flZakWu6lUiTn7xBGC10Yc+ERAb11p353qfvawyNghSu24IwHe1SaOGSpPRID8sKvckUn8kDAQS8bgtctZ79t59pkg2EsO51ltcGeAo+CzG4/TIGfSmOtkW+ORCRpX9wmEEeFExbQz5Z6RcyurUI5LOzP/ujzKdag4023NSkSQBzOsBW6NraJQFiHTXa+uLFScm1qK8RrjRsyJWTFqtFjVkprXcGdPjpQ6mGBKqFXfZviACP7kY+LpabGoE1gxHeIkvTP2XxONppxH+66ZJ4VxYSjzbkW/VoeliwaTmNLb5ifzFhFv3VlHH6s73KKUVJhCDNI541cgwcGO4io8cRO/m1bxfmWwg4asPVVwr6OaM/g4FdPHs8bi8X+CVboIr5yXayIBBqwl500KHd8ahJvgokde7g7xy/Y3qowrBdQpDCotfDb/fetCynCXLDYdnvA+NnfHeWrLfLideH2NU+dmTKXJJ3dK2M9x3nXngiEs7pwG5qUA8aZRCEXzDCcfIXEjHK0Syy98LORnQigCxkOcxELR5H6VyGOL/IRK3AHTL3MrfacYw==",
                oidc_client_id: "AgCRdf4kBsL9nHi2WlRQJDRF6q6SZkJnGGxGoumP5oZisOixyNlaJ4XfdJdzljq9c5OR/qCwTkp/s4Z8Hq2VDUIDLmIv/YtNSvH1I8cmxS5UAWOtD+AVTy7FFGbKNq0v27n3Re3TrEenjQshZ32ssN7nN1oQ1wcQyF9k4Y5IvZtAl/6FBSA7mZH1OvEs0sDL1g4bHVJP0YnDGHM+mJnEamTPWtVgpw02Oir//U/c3dHVVoqWPubC2KtOGZ+B5qpG8MNflMAtynmIDTDfw8Spisswn5Ol39SwYhPwbdShxR0haoWaddM2Qws2+sv1Exf05hysJXfu05WCAT93Ps2yvBfwwlSZEq24/3HPq/dgmQOGI6QgkyI9RVDlQODc1j7gLuMbPcD+wkNubfxQzJOu2W15TMlwBbQCPLbOgeGcmMDmDu+d1MxvKrB1hKGk9VuFqLR6azRdkmuFKMSoY8P++8HTKg8o3BzfJ0qMtglaESOZlffAdFVxCYni/yfNe4G1+sek9YZ5dQA7b37Q8kEy33Hml0hR/+wPGBwcX2JCOCnJce4D+D+QlzqqwQYm4+Htu94Sol00wwNyrLK/6BO7E40TtgwwymcS8EKTBp3bnZebw7N5ieR4LGq5vBlAf8Tkf65QWWZku+VMQKY/Zub4JYW+64Rw7eMbd2hIWpMMVZcRJq8I/rxaDyYuq4ulJ6pzRGpil4pOL1tTJg==",
                oidc_client_secret: "AgBoWJUR0tP5kMzLO8KhiVvj+FM69fyun18CTukSLPEyKhJnUfkfhTB/MW/YI6awFgma5DpGMZYDv/s5vMmfI8z6NcTI2TGRTfkIEWcQo3vkuHudLOIppESlPgKHPAvxeqxfEf2QPhmnCoZ7Dyil5beWaAAMvMgoPqxO4ARa/bSoPfVx4iHv0BsvcUMbsUvXhVBFFx4IdW3lR/vej1SKiI3q70fQ95Gzeu04eLfATseAsKlYijniGaYV++dcc+XK4bCakNUF8EWm1pjw7Wkaon1B85SeC9FOQeVPmOrg98ZKFuhJCBlIun19M/x3d41HctwY3VzHCuT+2JK/f5X1u5YaZApIy8CLIYX9KXBGCWfjLtdEzQ3f6qRmhtptmUHIDulxZUJtPFjW93XYDqODnaLkyFxIUn2O2Xea1EAYQjaoGsqUFUjQtF8sbd8y3L7ZcsWwEGIud3D9i4qdWGe0jD7AHilZibAawhUylOAF/WGm8ZH5/pWysACGQh7Sgi0g8Zf5XJTyMoVRIccN0t+IVtFvpLLQDAXkd9wyWMTCMyyN84Wcn2TNitJPR2T9mwS1xGc1dJ5mpa6t+lm/ViFWcYNfRLFd5oRPTK9yatuebzLlCxwdPdsOClXCGW8yVR6pgKXoJN72e//rfAyK51UU2wj45vPPr9UCQxA6MfHl+p83WAMnPG/sFXXUXmdUX1yCT61aYEIsN4k95RTccrXejGjgIU0mHWTuw9um59AX/D6YZ2204FwOThoPFm6ECwBZJxFt/8R3nxb53GkwR2ywM35+zNy2Ibz5H80=",
            }
        }
    }, { provider: splitproProvider });
    const splitpro = new Splitpro("splitpro", {
        serving,
        host: 'split.unlimited-code.works',
        domain: 'unlimited-code.works',
        authSubdomain: 'auth',
        dbStorageClass: cluster.localStableStorageClass.metadata.name,
        uploadStorageClass: cluster.localStableStorageClass.metadata.name,
        authSecret: splitproSecret,
        // webPush / plaid / goCardless / openExchangeRates are opt-in, see
        // src/splitpro/index.ts
    }, {
        provider: splitproProvider
    });

    const spoolman = new Spoolman("spoolman", {
        serving,
        host: 'spool.unlimited-code.works',
    }, {
        provider: namespaced("spool")
    });
}

setup();

