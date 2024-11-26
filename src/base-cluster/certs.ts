import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import * as crds from "#src/crds";
import { BaseCluster } from "./base";

export type ClusterCertificateSpec = Omit<crds.types.input.cert_manager.v1.CertificateSpec, 'issuerRef' | 'secretName'> & {
    secretName?: pulumi.Input<string>,
    secretLabels?: Record<string, pulumi.Input<string>>,
    secretAnnotations?: Record<string, pulumi.Input<string>>,
    issuer: crds.cert_manager.v1.ClusterIssuer | crds.cert_manager.v1.Issuer
};
export type ClusterCertificateArgs = Omit<crds.cert_manager.v1.CertificateArgs, 'spec'> & {
    spec: ClusterCertificateSpec,
};

export class ClusterCertificate extends crds.cert_manager.v1.Certificate {
    public readonly secretName!: pulumi.Output<string>;

    constructor(certName: string, args: ClusterCertificateArgs, opts?: pulumi.CustomResourceOptions) {
        super(certName, {
            ...args,
            spec: {
                secretName: certName,
                secretTemplate: {
                    annotations: {
                        "reloader.stakater.com/match": "true",
                        ...args.spec.secretAnnotations || {},
                    },
                    labels: args.spec.secretLabels,
                },
                issuerRef: {
                    name: pulumi.output(args.spec.issuer.metadata).apply(md => md.name!),
                    kind: args.spec.issuer.kind,
                },
                // common args
                duration: '2160h', // 90d
                renewBefore: '360h', // 15d
                privateKey: {
                    algorithm: "ECDSA",
                    size: 256
                },
                usages: [
                    "server auth",
                    "client auth"
                ],
                ...args.spec,
            },
        }, opts);

        this.secretName = pulumi.output(certName);
    }

    public mount(destPath: string, srcPath?: string): kx.types.VolumeMount {
        return {
            destPath,
            srcPath,
            volume: {
                name: this.secretName,
                secret: {
                    secretName: this.secretName
                }
            }
        };
    }
}

export interface BackendCertificateArgs {
    namespace: pulumi.Input<string>,
    secretLabels?: Record<string, pulumi.Input<string>>,
    secretAnnotations?: Record<string, pulumi.Input<string>>,
    base?: BaseCluster,
    createPkcs12?: boolean,
    pkcs12?: pulumi.Input<crds.types.input.cert_manager.v1.CertificateSpecKeystoresPkcs12>;
}

export class BackendCertificate extends ClusterCertificate {
    constructor(name: string, args: Omit<BackendCertificateArgs, 'base'> & { base: BaseCluster }, opts?: pulumi.CustomResourceOptions) {
        const certName = `cert-svc-${name}`;
        const maybePkcs12 = {
            create: true,
        }
        super(certName, {
            metadata: {
                labels: {
                    'unlimited-code.works/cert-type': 'backend',
                }
            },
            spec: {
                dnsNames: [pulumi.interpolate`${name}.${args.namespace}`],
                issuer: args.base.rootIssuer,
                secretLabels: args.secretLabels,
                secretAnnotations: args.secretAnnotations,
                keystores: {
                    pkcs12: args.pkcs12,
                }
            }
        }, opts);
    }
}

export interface FrontendCertificateArgs {
    sans?: string[],
    base?: BaseCluster,
}

export class FrontendCertificate extends ClusterCertificate {
    constructor(main: string, args: Omit<FrontendCertificateArgs, 'base'> & { base: BaseCluster}, opts?: pulumi.CustomResourceOptions) {
        const certName = `cert-${main}`;

        const config = new pulumi.Config();
        const issuer = config.requireBoolean('staging') ? args.base.letsencryptStagingIssuer : args.base.letsencryptIssuer;

        super(certName, {
            metadata: {
                labels: {
                    'unlimited-code.works/cert-type': 'frontend',
                }
            },
            spec: {
                dnsNames: [main, ...args.sans ?? []],
                issuer,
            }
        }, opts);
    }
}
