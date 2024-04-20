import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster, FrontendCertificate } from "#src/base-cluster";
import { FrontendCertificateArgs } from "#src/base-cluster/certs";
import { Service } from "#src/utils";

import { Traefik, Middleware } from "./traefik";
import { Authelia } from "./authelia";
import { FrontendService, FrontendServiceArgs } from "./service";

export { Middleware, TLSOption } from "./traefik";
export { FrontendService } from "./service";

interface ServingArgs {
    base: BaseCluster,
    // SMPT service for sending email
    smtp: Service,

    // External IP and port to listen on
    externalIPs: string[],
    httpPort?: number,
    httpsPort?: number,

    // Domain to serve on
    domain: pulumi.Input<string>,
    certificates: ({ main: string } & FrontendCertificateArgs)[],
}

export class Serving extends pulumi.ComponentResource<ServingArgs> {
    public readonly certificates: FrontendCertificate[];
    public readonly base: BaseCluster;

    public readonly crdsReady: pulumi.Output<pulumi.CustomResource[]>;
    public readonly middlewareAuth: Middleware;
    public readonly middlewareAuthBasic: Middleware;

    constructor(name: string, args: ServingArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Serving', name, args, opts);
        this.base = args.base;

        const traefik = new Traefik('traefik', {
            base: args.base,
            externalIPs: args.externalIPs,
            httpPort: args.httpPort ?? 80,
            httpsPort: args.httpsPort ?? 443,
        }, { parent: this });
        this.crdsReady = traefik.ready;

        const authelia = new Authelia('authelia', {
            base: args.base,
            crdsReady: this.crdsReady,
            domain: args.domain,
            subdomain: 'auth',
            smtp: args.smtp,
        }, { parent: this });

        this.middlewareAuth = new Middleware('auth', {
            forwardAuth: {
                address: authelia.url,
                // this is safe because traefik sanitize all forwarded header
                // before handling req to middlewares
                trustForwardHeader: true,
                authResponseHeaders: [
                    "Remote-User",
                    "Remote-Name",
                    "Remote-Email",
                    "Remote-Groups",
                ],
                tls: {
                    caSecret: authelia.certificate.secretName,
                    certSecret: traefik.certificate.secretName,
                }
            }
        }, { parent: authelia });
        this.middlewareAuthBasic = new Middleware('auth-basic', {
            forwardAuth: {
                address: authelia.urlBasic,
                // this is safe because traefik sanitize all forwarded header
                // before handling req to middlewares
                trustForwardHeader: true,
                authResponseHeaders: [
                    "Remote-User",
                    "Remote-Name",
                    "Remote-Email",
                    "Remote-Groups",
                ],
                tls: {
                    caSecret: authelia.certificate.secretName,
                    certSecret: traefik.certificate.secretName,
                }
            }
        }, { parent: authelia });

        this.certificates = args.certificates.map(cert => {
            return args.base.createFrontendCertificate(cert.main, cert, { parent: this });
        });

        this.registerOutputs({
            crdsReady: this.crdsReady,
        });
    }

    protected async initialize(args: pulumi.Inputs): Promise<ServingArgs> {
        return args as ServingArgs;
    }

    public createFrontendService(
        name: string,
        args: FrontendServiceArgs & { enableAuth?: boolean, enableBasicAuth?: boolean },
        opts?: Omit<pulumi.ComponentResourceOptions, 'parent'>
    ): FrontendService {
        const enableAuth = args.enableAuth ?? false;
        const enableBasicAuth = args.enableBasicAuth ?? false;
        delete args['enableAuth'];
        delete args['enableBasicAuth'];
        return new FrontendService(name, {
            ...args,
            middlewares: pulumi.output(args.middlewares)
                .apply(ms => [
                    ...(enableAuth ?? false) ? [this.middlewareAuth] : [],
                    ...(enableBasicAuth ?? false) ? [this.middlewareAuthBasic] : [],
                    ...ms ?? [],
                ])
        }, {
            ...opts ?? {},
            parent: this,
        })
    }
}
