import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import * as crds from "#src/crds";
import { BaseCluster } from "./base";

interface ClusterCertificateArgs {
    dnsNames: pulumi.Input<pulumi.Input<string>[]>,
    issuer: crds.certmanager.v1.ClusterIssuer | crds.certmanager.v1.Issuer
}

export class ClusterCertificate extends crds.certmanager.v1.Certificate {
    public readonly secretName!: pulumi.Output<string>;

    constructor(certName: string, args: ClusterCertificateArgs, opts?: pulumi.CustomResourceOptions) {
        super(certName, {
            spec: {
                secretName: certName,
                dnsNames: args.dnsNames,
                issuerRef: {
                    name: args.issuer.metadata.name,
                    kind: args.issuer.kind,
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
                ]
            }
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
    base?: BaseCluster,
}

export class BackendCertificate extends ClusterCertificate {
    constructor(name: string, args: Omit<BackendCertificateArgs, 'base'> & { base: BaseCluster }, opts?: pulumi.CustomResourceOptions) {
        const certName = `cert-svc-${name}`;
        super(certName, {
            dnsNames: [pulumi.interpolate`${name}.${args.namespace}`],
            issuer: args.base.rootIssuer,
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
            dnsNames: [main, ...args.sans ?? []],
            issuer,
        }, opts);
    }
}
