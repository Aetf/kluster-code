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
                    smtp_user: 'AgBN6O5GuQQ3iFH97FCUXAx00fi+XhD8jUFgJFc0Mo7A9XpyUa9tEb2X93Bx3ApIw4HwZG3/+ukouUZhMjA24oUOnRmodlyLIAgIeo6WRsc8Qdi0yiIJrt1uNF7CcM9ztzWjxXlF4041qcyAcWOcgDtbIXmlk60d+3t4xSCm0Us/SZ9uDkTKuQnQikqqq3DltU7KKo/4YvtcGaVz9NHbOuKaBakCt9KAvBmLJ6vEZO0WHtbPFSUQ+tQOKps0V0B3KtAM6kPbGKna4Zbv52SZAreCN79mR5LY3jsoBIql0Tqh7eKYEKQXJFIV/rU2LT4Fk40qY91SABB6XfDJAaMEgyieTQuePhgimghknrOL9brZMI7t8UPcRVVhEOL279RVdldrvJma/vcPpqquXkNl0tQvU+cNy6ZpRbFjB5PUovVot1pkDFsTz+CM93UQ5yylmTBTaZ0n+hrVEUgtvVeFzpgI57dwhw9VLZg3CJw5XYh2rQR6esDd3xNXj7dpkFpJO6A3UCz9ct1a9e3i43YlGwrKGw+V6MWek14UK3eFkhuKfRJ9ikQRpjUGNHk2nx3bKjeMWQgfMpppmutbzIos0G6tCpP0EyxuRfgk6NHSMxy741B0fmXgMesXRwGoevDTA4d9CNCNS6OqSejCAkRYLkYUEp+L1SnM8WkwoK+Wy+LHSkfaXd+QFtkppFVXWTAOEvAR9p/RPcLao/CCDY+uO02M4gqgYWt9Q/kKPg==',
                    smtp_pass: 'AgCCtwWR1hBzmHVjIGbNDgPV752bIY8sG84cNUpzKZM0QQO6R+3Q7Jmn5JVOrLhkAW58YHGmcuiv2SQpQ7nkcmdfOQxIsjyvkjyF68jVrED3mM/LeWsY5a8a77JqLUv15CqEy2nZAb0aGm+guvbGSQEnxx2bcW8psh3Wj01z1YkFs7WOVvn3g88O/UFpz9JIrLTcKuUhECbmeUlKWw0Dp9h/Irw000pCKFN1X0n2hibHDU4MnQ4h7bzGiHaECMIQjT5d3geV6SU+46OsJoDzyTiIRU3dVrS+8TwKues8IePosA1KS9F4LBEK2pkmZksueY+GMvzFSDIaHE6+tduUEcN03cSywrGZZAswMNraqKol3IeL3/c3JWQbyaKkppD/aEhRUFwji2hF1dgb2JckyvrauJEWeb0CtQy4kKFHAQiVBx+K2aKqc1+Au20iao+iSOz91KPTh3Z3IOn/1vr5ghN4IHxmHiuOTdZZ6HZOg4Z7Dmr8S9EniYXdT300FVNb8fZBMnja9qS5hocnU+mpyti8mYR4Z0WfYV55miaaFRZ4JTiWy+f2+rvH0VAs+Vv6UOgktly+WN4ngxd3Wb7eELe+Jb/SpocMyLZ9PI/BYYNQRYMep5PsxjC4IcY2mwuPNX07E6RzNGBJh+GYgQ+VIPiqzYMzpc8o6nalSxM7gE1UrHDyRvuEvEbfzf3aCpM/bV2RFP+KIEfdXcDjvobds93IYksrOsDXQld4/q9ZFyFFnIPkeL6PBc6M',
                }
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
