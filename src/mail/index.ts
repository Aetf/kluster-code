import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster, ClusterCertificate } from '#src/base-cluster';
import { Service, ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import * as crds from "#src/crds";
import { versions } from "#src/config";

interface EximArgs {
    base: BaseCluster,
    host: pulumi.Input<string>,
}

/**
 * Internal SMTP relay to consolidate email settings
 */
export class Exim extends pulumi.ComponentResource<EximArgs> {
    public readonly smtpService: Service;

    constructor(name: string, args: EximArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Exim', name, args, opts);

        const secret = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    smtp_user: 'AgBN6O5GuQQ3iFH97FCUXAx00fi+XhD8jUFgJFc0Mo7A9XpyUa9tEb2X93Bx3ApIw4HwZG3/+ukouUZhMjA24oUOnRmodlyLIAgIeo6WRsc8Qdi0yiIJrt1uNF7CcM9ztzWjxXlF4041qcyAcWOcgDtbIXmlk60d+3t4xSCm0Us/SZ9uDkTKuQnQikqqq3DltU7KKo/4YvtcGaVz9NHbOuKaBakCt9KAvBmLJ6vEZO0WHtbPFSUQ+tQOKps0V0B3KtAM6kPbGKna4Zbv52SZAreCN79mR5LY3jsoBIql0Tqh7eKYEKQXJFIV/rU2LT4Fk40qY91SABB6XfDJAaMEgyieTQuePhgimghknrOL9brZMI7t8UPcRVVhEOL279RVdldrvJma/vcPpqquXkNl0tQvU+cNy6ZpRbFjB5PUovVot1pkDFsTz+CM93UQ5yylmTBTaZ0n+hrVEUgtvVeFzpgI57dwhw9VLZg3CJw5XYh2rQR6esDd3xNXj7dpkFpJO6A3UCz9ct1a9e3i43YlGwrKGw+V6MWek14UK3eFkhuKfRJ9ikQRpjUGNHk2nx3bKjeMWQgfMpppmutbzIos0G6tCpP0EyxuRfgk6NHSMxy741B0fmXgMesXRwGoevDTA4d9CNCNS6OqSejCAkRYLkYUEp+L1SnM8WkwoK+Wy+LHSkfaXd+QFtkppFVXWTAOEvAR9p/RPcLao/CCDY+uO02M4gqgYWt9Q/kKPg==',
                    smtp_pass: 'AgAxaK6mTqe6sprsgqcY0LJCzDWw6LH13VV67f6ahY7220fs4/0K88WPutZLfBwLqw6udknQ+cQLQeCwa9BDC7zcFmbTccPtCKshZEEoBbFU+8KWne5kOq2s1tdmaBdZpBOVDe75d1uRI6OIvQoSR7zPUxxLEFC3TIxczC53QmzaoKVi5UmpI0DNLG5t6cu1tMRrvFNql6386b+Ny5FvJtdDEsmAoZJrEqEvCHD6toH2z/tId13X6cjUWFIdR7y6emgi3PAKnM8+O8T7eSGZS+G3xX5xXzt9AG851EiMeY37kpmiPSkTHo4r4jboa8wTZM0dcnRNm6h5AAruiastpJTiytMLHPuZRz2KF7mlWwJvQQUlL0M1tIwNQMiFeGaNSayAAtoFlF9cPB/qjE7YZVK1yCQ1+0k7jyDQCrIngBkn97GxZgasYpEoZDjx4hfoobZAgp/Nx4BR2AhZQoUyr+WXv+CQfxhh9fsupY2YjeHlQDLF2BE2M73Qnj4iOgaq2PYB45dxEyYqXzdO9hf1KqYVQ8ODn+oJx9+BngV2pr8LGle8vtLmBK+ZfLtw3hGQ4yUAvDpCzdxbirEZO40CalveJ7xvDeYP0RTsYELNa8fHdpo5Z7bAanUECgpkqU6wnM0MbUvlgcJiw+V0dDBd8pjZNzFDhtaSnAREuj88UTFfWaFj666oPytOoY2AsYpGFrOLktKgTpxa9irXikGYflh7',
                },
            }
        }, { parent: this });

        const dkimCert = new ClusterCertificate(`cert-dkim-${name}`, {
            spec: {
                commonName: 'dkim-k8s',
                issuer: args.base.rootIssuer,
                privateKey: {
                    algorithm: "RSA",
                    size: 2048,
                },
            }
        }, { parent: this });

        const cert = args.base.createBackendCertificate('smtp', {
            namespace: pulumi.output(secret.metadata).apply(md => md.namespace!)
        }, { parent: this });

        const cm = new ConfigMap(name, {
            ref_file: __filename,
            data: 'static/*',
            stripComponents: 1,
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: versions.image.exim,
                resources: {
                    requests: { cpu: "1m", memory: "8Mi" },
                    limits: { cpu: "1m", memory: "8Mi" },
                },
                ports: {
                    smtp: 8025,
                },
                env: {
                    HOSTNAME: args.host,
                    // do not delivery to local
                    LOCAL_DOMAINS: "",
                    // allow relay from localhost and kubernetes internal
                    RELAY_FROM_HOSTS: "127.0.0.0/8:10.0.0.0/8",
                    // allow relay to any domain
                    RELAY_TO_DOMAINS: "*",
                    SMARTHOST: 'smtp.gmail.com::587',
                    SMTP_USERNAME: secret.asEnvValue('smtp_user'),
                    SMTP_PASSWORD: secret.asEnvValue('smtp_pass'),
                },
                volumeMounts: [
                    cm.mount('/etc/exim/exim.conf', 'exim.conf'),
                    dkimCert.mount('/etc/exim/keys/dkim'),
                    cert.mount('/tls'),
                ]
            }],
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        this.smtpService = serviceFromDeployment(name, deployment, {
            metadata: {
                name: 'smtp',
            },
        });
    }
}
