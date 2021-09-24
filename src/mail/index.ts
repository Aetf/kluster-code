import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster, ClusterCertificate } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import * as crds from "#src/crds";

interface EximArgs {
    base: BaseCluster,
    host: pulumi.Input<string>,
}

/**
 * Internal SMTP relay to consolidate email settings
 */
export class Exim extends pulumi.ComponentResource<EximArgs> {
    public port: pulumi.Output<number>;
    public address: pulumi.Output<string>;

    constructor(name: string, args: EximArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Exim', name, args, opts);
        this.port = pulumi.output(8025);

        const secret = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    smtp_pass: 'AgCbYeEJLvkX6TxOQ2SSir9wwIMZGNlBrIQ7ixT+PMijKD4a1B9zZoAyiO8ERA6F98VHl7V30upeEACKmhNHG/RcVlgTRtIs/q8+7HyjgOJk+DMMwEU8qjPg8cPowOJPF3rmsNsc38Ye27ke3PPHLrqyL9yiKMwEGkG1267TCneIO51385tUmQRICqeOnvpXO6oUYZgAjJdR4GAQvc0BdUWrbanBAQFIp8Aoh/RSw1dDrofprHSABYuhhue07syOcx8mYt7V2HWy4B5tB4HFsQrbuZJ2jFGpV5qnbc/+KcO1y5HrPZis3IinJ2yBe5U4vWuw3TIQquaP6Ty6/ohMajCxAHz9FTOeFBbHIVX+5V2taMxSWl+q6Ee6ETSQlmm4w4WINj2AQY9cscAZZ5YgsXPS37cTcfuZ3PoJtYqyUrJj/MgA5jEeyKX3AfXOiNjOg7mdDR/BjdqLjdE+xocU7+rRfsEssxJbw0gg8vYkFE7QVW/43jEXhSOM2YHWGZrevfPhwERdT9wtwYbo7H0haw7OhCRVi9SF4BYrj97LZmQtKSDRg1pxGX+ptgi8mUvqiX9dtpPbb8K21BbT7Ir+C0OICPlKs1x97Utd6tgzt1d1kizdEVKpTJz8b2Ipd2D/SS4Wemiu+6//dS2LBricNTn8J8eriZlQ90xKOujfg+nDhjbn72TKganUsvCrO52KIPB64w14o/Tjrxo4+rzd2C+8',
                    smtp_user: 'AgBXctqqmBwG3Sh1V/ST13++1JzS6hkT1w53G+qRSDBJ1pBU6AVO7s2qKvxAVJBkt30XZljufPxsocGdvsETwjOkTkPN6ZeNRiv+GgErmDvlY4w/ZVdAD0mttnRV1ZMmj/1uXZa7scxv/ZLNsUoLZrxlYPGnpZBNeX5dAw65Ju2vFEWhYyLw/tmBvvT9lC9vdp89Rf9CY55MMNZrLpPovJtvqCF+fbKn/OaJkpHhg8ICOeFrfcAus7bGtqp8kBAARoH8BdOshB6Xz7nDsAPB8s92mr9vGQIqCR0pAIFNhFhbaxYTojQSWlt2A7nF0ihkbzCvMrIBo8zDC/Xq0a1TcWDMah3TWpv8ecw0WoayR5BMKYCtnZX+NMhlZuSHMlH9iAwfXG0ABdlKy8OBWhjgrKUQybNLqVHYsctpoCR/xJ52Kces/PhAdoQFYZFtMa7PFZpUUYBvCBiTZderkfckEup2F+XfZnwyeyRUK/rqzsDwU61x7SkLiSTqL8y3Auu5RyiwFN+Xn+8mL8cZwxO3XZv7sGpSNAL5MRufAVEGp+IvNBPfwu7FsstBYHF+hWbFJb27q7UevTVdo9tSNkf20oX5h94uHEGpUhXpC4Ark7qZzNBa06j5Gr2xMAXtsei8Vj7l3FVjflm94fDr1WLCFkKgj4+6leGHBW7WIqLk2L8RxqLalR9ERkCW1YI8SNFpmWrfrCDLh2dwqwYk7A3XruAlhA==',
                }
            }
        }, { parent: this });

        const dkimCert = new ClusterCertificate(`cert-dkim-${name}`, {
            spec: {
                commonName: 'dkim-k8s',
                issuer: args.base.rootIssuer,
                privateKey: {
                    // TODO: change to Ed25519 once cert-manager 1.5.0 is released, also dkim dns record needs to change
                    algorithm: "RSA",
                    size: 2048,
                },
            }
        }, { parent: this });

        const cert = args.base.createBackendCertificate('smtp', {
            namespace: secret.metadata.namespace
        }, { parent: this });

        const cm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: 'docker.io/devture/exim-relay:4.94.2-r0-2',
                ports: {
                    smtp: this.port,
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
                    "reloader.stakater.com/search": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name: 'smtp',
            },
        });

        this.address = pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`;
    }
}
