import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import * as crds from "#src/crds";

function commonCertificateArgs(): any {
    return {
        duration: '2160h', // 90d
        renewBefore: '360h', // 15d
        privateKey: {
            algorithm: "ECDSA",
            size: 256
        },
        usages: [
            "server auth",
            "client auth"
        ]
    }
}

interface BackendCertificateArgs {
    namespace: pulumi.Input<string>,
    issuer?: crds.certmanager.v1.ClusterIssuer | crds.certmanager.v1.Issuer,
}

export class BackendCertificate extends crds.certmanager.v1.Certificate {
    private static defaultIssuer = crds.certmanager.v1.ClusterIssuer.get('backend-issuer', 'kluster-ca');

    public readonly secretName!: pulumi.Output<string>;

    constructor(name: string, args: BackendCertificateArgs, opts?: pulumi.CustomResourceOptions) {
        const certName = `cert-svc-${name}`;
        super(certName, {
            spec: {
                ...commonCertificateArgs(),
                secretName: certName,
                dnsNames: [pulumi.interpolate`${name}.${args.namespace}`],
                issuerRef: BackendCertificate.configureIssuer(args.issuer),
            }
        }, opts);

        this.secretName = pulumi.output(certName);
    }

    private static configureIssuer(issuer?: crds.certmanager.v1.ClusterIssuer | crds.certmanager.v1.Issuer): crds.types.input.certmanager.v1.CertificateSpecIssuerRefArgs {
        const obj = issuer ?? this.defaultIssuer;
        return {
            name: obj.metadata.name,
            kind: obj.kind,
        };
    }

    protected async initialize(args: pulumi.Inputs): Promise<BackendCertificateArgs> {
        return args as BackendCertificateArgs;
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

interface FrontendCertificateArgs {
    sans?: string[],
    issuer?: crds.certmanager.v1.ClusterIssuer | crds.certmanager.v1.Issuer,
}

export class FrontendCertificate extends crds.certmanager.v1.Certificate {
    private static _defaultIssuer: crds.certmanager.v1.ClusterIssuer;
    private static get defaultIssuer() {
        if (_.isUndefined(FrontendCertificate._defaultIssuer)) {
            const config = new pulumi.Config();
            const issuerName = config.requireBoolean('staging') ? 'letsencrypt-staging' : 'letsencrypt';
            FrontendCertificate._defaultIssuer = crds.certmanager.v1.ClusterIssuer.get('frontend-issuer', issuerName);
        }
        return FrontendCertificate._defaultIssuer;
    }

    public readonly secretName: pulumi.Output<string>;

    constructor(main: string, args: FrontendCertificateArgs, opts?: pulumi.CustomResourceOptions) {
        const certName = `cert-${main}`;

        super(certName, {
            spec: {
                ...commonCertificateArgs(),
                secretName: certName,
                dnsNames: [main, ...args.sans ?? []],
                issuerRef: FrontendCertificate.configureIssuer(args.issuer)
            }
        }, opts);
        this.secretName = pulumi.output(certName);
    }

    private static configureIssuer(issuer?: crds.certmanager.v1.ClusterIssuer | crds.certmanager.v1.Issuer): crds.types.input.certmanager.v1.CertificateSpecIssuerRefArgs {
        const obj = issuer ?? FrontendCertificate.defaultIssuer;
        return {
            name: obj.metadata.name,
            kind: obj.kind,
        };
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
