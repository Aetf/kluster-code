import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from "#src/crds";
import { NamespaceProbe, HelmChart, SealedSecret } from "#src/utils";
import LocalPathProvisioner from "#src/local-path";
import { JuiceFs } from "#src/juicefs";
import { FrontendCertificate, FrontendCertificateArgs, BackendCertificate, BackendCertificateArgs } from "./certs";

export const CertificateCRD = "apiextensions.k8s.io/v1/CustomResourceDefinition::certificates.cert-manager.io";
export const ClusterIssuerCRD = "apiextensions.k8s.io/v1/CustomResourceDefinition::clusterissuers.cert-manager.io";
export const SealedSecretCRD = "apiextensions.k8s.io/v1/CustomResourceDefinition::sealedsecrets.bitnami.com";

const NODE_NAMES = [
    "AetfArchVPS",
    "AetfArchHomelab",
] as const;
export type Nodes = Record<typeof NODE_NAMES[number], string>;

export interface BaseClusterArgs {
    isSetupSecrets: boolean,
}

/**
 * The base cluster with PVs and PKI infrastructure
 */

export class BaseCluster extends pulumi.ComponentResource<BaseClusterArgs> {
    private readonly sealedSecret: HelmChart;
    private readonly certManager!: HelmChart;
    private readonly reloader!: HelmChart;
    private readonly nfd!: HelmChart;

    public readonly nodes: Nodes;
    public readonly rootIssuer!: crds.certmanager.v1.ClusterIssuer;
    public readonly letsencryptIssuer!: crds.certmanager.v1.ClusterIssuer;
    public readonly letsencryptStagingIssuer!: crds.certmanager.v1.ClusterIssuer;

    public readonly localStorageClass!: k8s.storage.v1.StorageClass;
    public readonly localStableStorageClass!: k8s.storage.v1.StorageClass;
    public readonly jfsStorageClass!: pulumi.Output<k8s.storage.v1.StorageClass>;

    constructor(name: string, args: BaseClusterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("kluster:BaseCluster", name, args, opts);

        // known cluster nodes
        const nodes: Partial<Nodes> = {};
        for (const node of NODE_NAMES) {
            const hostname = node.split(/(?<=[a-z])(?=[A-Z])/).map(s => s.toLowerCase()).join('-');
            // nodes[node] = k8s.core.v1.Node.get(hostname, hostname);
            // no need to get the Node resource, which takes very long
            nodes[node] = hostname;
        }
        this.nodes = nodes as Nodes;

        const namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.sealedSecret = new HelmChart("sealed-secrets-controller", {
            namespace,
            chart: "sealed-secrets",
            version: "2.7.2",
            fetchOpts: {
                repo: "https://bitnami-labs.github.io/sealed-secrets"
            }
        }, { parent: this });

        if (args.isSetupSecrets) {
            return;
        }

        this.certManager = new HelmChart("cert-manager", {
            namespace,
            chart: "cert-manager",
            version: "1.9.1",
            fetchOpts: {
                repo: "https://charts.jetstack.io",
            },
            values: {
                installCRDs: true,
                // this is a helm post-hook that waits for the webhook to be ready,
                // no need in pulumi
                startupapicheck: {
                    enabled: false,
                },
                extraArgs: [
                    // When this flag is enabled, secrets will be automatically removed when the certificate resource is deleted
                    '--enable-certificate-owner-ref=true',
                ]
            }
        }, { parent: this });

        const lpp = new LocalPathProvisioner("local-path-provisioner", { storageClass: "local-path" }, { parent: this });
        this.localStorageClass = lpp.storageClass;
        this.localStableStorageClass = lpp.storageClassStable;

        const jfs = new JuiceFs("juicefs", {
            namespace,
            storageClass: "juicefs",
            metadataStorageClass: lpp.storageClassStable.metadata.name,
        }, { parent: this });
        this.jfsStorageClass = jfs.storageClass;

        this.rootIssuer = this.setupPrivateCA(name);
        [this.letsencryptIssuer, this.letsencryptStagingIssuer] = this.setupLetsEncrypt();

        this.reloader = new HelmChart("reloader", {
            namespace,
            chart: "reloader",
            version: "0.0.129",
            fetchOpts: {
                repo: "https://stakater.github.io/stakater-charts"
            },
        }, { parent: this });

        this.nfd = new HelmChart("nfd", {
            namespace,
            chart: "node-feature-discovery",
            version: "0.11.2",
            fetchOpts: {
                repo: "https://kubernetes-sigs.github.io/node-feature-discovery/charts",
            },
            values: {
                image: {
                    tag: "v0.11.2-minimal"
                },
                tls: {
                    enable: true,
                    certManager: true,
                }
            }
        }, { parent: this });
    }

    protected async initialize(args: pulumi.Inputs): Promise<BaseClusterArgs> {
        return args as BaseClusterArgs;
    }

    /**
     * Setup a private CA issuer using self-signed certificate
     */
    private setupPrivateCA(name: string): crds.certmanager.v1.ClusterIssuer {
        const bootstrap = new crds.certmanager.v1.ClusterIssuer(`${name}-ca-bootstrap`, {
            spec: {
                selfSigned: {}
            }
        }, { parent: this, dependsOn: [this.certManager.resources[ClusterIssuerCRD]] });

        const certName = `${name}-ca`;
        const ca = new crds.certmanager.v1.Certificate(certName, {
            spec: {
                isCA: true,
                commonName: certName,
                secretName: certName,
                issuerRef: {
                    // the extra shenanigans is necessary because we need to
                    // assert the name is not undefined, which isn't the case
                    // with auto lifting `bootstrap.metadata.name`
                    name: pulumi.output(bootstrap.metadata).apply(md => md.name!),
                    kind: bootstrap.kind,
                },
                privateKey: {
                    algorithm: "ECDSA",
                    size: 256
                },
            }
        }, { parent: this, dependsOn: [this.certManager.resources[CertificateCRD]] });
        return new crds.certmanager.v1.ClusterIssuer(certName, {
            metadata: {
                name: certName,
            },
            spec: {
                ca: {
                    secretName: certName,
                }
            }
        }, { parent: this, dependsOn: [this.certManager.resources[ClusterIssuerCRD]], deleteBeforeReplace: true });
    }

    /**
     * Setup let's encrypt issuer
     */
    private setupLetsEncrypt(): crds.certmanager.v1.ClusterIssuer[] {
        // cloudflare API token for letsencrypt dns challenge
        // the API token should have the following settings
        // Permissions:
        // * Zone - DNS - Edit
        // * Zone - Zone - Read
        // Zone Resources:
        // * Include - All Zones
        const key = 'token';
        const cloudflare_api_token = new SealedSecret('cloudflare-api-token', {
            spec: {
                encryptedData: {
                    [key]: "AgCQHt140MhzcaBmIOoFhragr7KQWM/2G/SsZrsNOH2I3NvNP5s9mHs2/IFiefauoTUoH4Nf04qUuRWQlYz+K558fWQSA2J3LRRT8aJ2hNKZfQVHFZH67+gr4qoCGLEcVF0CWJ8a+eJQOtOq2WOj5jBbyfYW64jGvGy3BOghfba3pcqseO62eWnWEu0kJLTLY5Av8Lq36WsewexAHRlCidQli8QqgMwpXFhyNzPXVe0FyscdfesvTfYFPP52j4Cu3xG05SDRaxb1Ynq+9dVCgtqtxnDtU13QU0TgZQv0i6ndnhtsh6faivADnowzRCfimrDcbdQqvAFYJv/2rJQjiafg48rrjWEcHKbUj3GESWe5RetJouzyaPl2/9Rt5SlN6IM1xS+q8TBf74eSLZ6GfpAf/s+pPKBW5wMONShuiLvFXx5wuLVN/WPm5w62j8Qs+ko16cpHpOk6oVBeKlFb2pjddm63/4oOaRRs2k3tMwaCBClYDwXgQvojR9p0vxm++v24HAGKuzaGBcxsUj3QEB4B9J0SF9B92HcJ8bZrjBduGRDP1lEn8LU+zdRmAZEErO52twgyh1xhz6KrWx4OMrHGZCUxkAdKq+QiveySPwHAle/swn0LkOufecmvPxMVvhh4uwrx0o6zCyfzpNsTC2PTaNX/1ef+Ber+/ytMfCD2zqXoJVbFB+1OS6fyW8daoZVfU2Vz5FvRTy+iCLeT/Dk1euQr4NpmRAPgurs0myBAyU98o8MhrrIH",
                },
            }
        }, { parent: this, dependsOn: [this.sealedSecret.resources[SealedSecretCRD]] });

        return ['', '-staging'].map(stage => new crds.certmanager.v1.ClusterIssuer(`letsencrypt${stage}`, {
            metadata: {
                name: `letsencrypt${stage}`
            },
            spec: {
                acme: {
                    email: "aetf@unlimited-code.works",
                    server: `https://acme${stage}-v02.api.letsencrypt.org/directory`,
                    privateKeySecretRef: {
                        name: `letsencrypt${stage}-account-key`
                    },
                    solvers: [
                        {
                            dns01: {
                                cloudflare: {
                                    email: "7437103@gmail.com",
                                    apiTokenSecretRef: cloudflare_api_token.asSecretKeyRef(key)
                                }
                            }
                        }
                    ]
                }
            }
        }, { parent: this, dependsOn: [this.certManager.resources[ClusterIssuerCRD]], deleteBeforeReplace: true }));
    }

    public createFrontendCertificate(main: string, args: FrontendCertificateArgs, opts?: pulumi.CustomResourceOptions): FrontendCertificate {
        return new FrontendCertificate(main, {
            base: this,
            ...args,
        }, {
            parent: this,
            ...opts,
        });
    }

    public createBackendCertificate(certName: string, args: BackendCertificateArgs, opts?: pulumi.CustomResourceOptions): BackendCertificate {
        return new BackendCertificate(certName, {
            base: this,
            ...args,
        }, {
            parent: this,
            ...opts,
        });
    }

    public createLocalStoragePVC(
        name: string,
        spec: pulumi.Input<k8s.types.input.core.v1.PersistentVolumeClaimSpec>,
        opts?: pulumi.CustomResourceOptions
    ): kx.PersistentVolumeClaim {
        return new kx.PersistentVolumeClaim(name, {
            metadata: {
                annotations: {
                    // the pvc will be pending because of WaitForFirstConsumer
                    // so don't wait for it in pulumi
                    // see https://github.com/pulumi/pulumi-kubernetes/issues/895
                    "pulumi.com/skipAwait": "true"
                }
            },
            spec: {
                storageClassName: this.localStorageClass.metadata.name,
                accessModes: [
                    'ReadWriteOnce',
                ],
                resources: {
                    requests: {
                        storage: "1Gi"
                    }
                },
                ...spec,
            }
        }, {
            parent: this,
            protect: true,
            ...opts ?? {}
        });
    }
}
