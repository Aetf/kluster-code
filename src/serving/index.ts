import * as _ from "lodash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster, FrontendCertificate } from "#src/base-cluster";

import { Traefik, Middleware } from "./traefik";
import { Authelia } from "./authelia";
import { FrontendService, FrontendServiceArgs } from "./service";
import { FrontendCertificateArgs } from "#src/base-cluster/certs";

export { Middleware } from "./traefik";

interface ServingArgs {
    base: BaseCluster,

    authDomain: string,
    externalIPs: string[],

    certificates: ({ main: string } & FrontendCertificateArgs)[],

    smtpHost: pulumi.Input<string>,
    smtpPort: pulumi.Input<number>,

    httpPort?: number,
    httpsPort?: number,
}

export class Serving extends pulumi.ComponentResource<ServingArgs> {
    public readonly certificates: FrontendCertificate[];
    public readonly base: BaseCluster;

    public readonly ready: pulumi.Output<pulumi.CustomResource[]>;
    public readonly middlewareAuth: Middleware;

    constructor(name: string, args: ServingArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Serving', name, args, opts);
        this.base = args.base;

        const traefik = new Traefik('traefik', {
            base: args.base,
            externalIPs: args.externalIPs,
            httpPort: args.httpPort ?? 80,
            httpsPort: args.httpsPort ?? 443,
        }, { parent: this });
        this.ready = traefik.ready;

        const authelia = new Authelia('authelia', {
            base: args.base,
            domain: args.authDomain,
            subdomain: 'auth',
            smtpHost: args.smtpHost,
            smtpPort: args.smtpPort,
        }, { parent: this, dependsOn: traefik.chart.ready });
        this.middlewareAuth = authelia.middlewareAuth;

        this.certificates = args.certificates.map(cert => {
            return args.base.createFrontendCertificate(cert.main, cert, { parent: this });
        });

        this.registerOutputs({
            ready: this.ready
        });
    }

    protected async initialize(args: pulumi.Inputs): Promise<ServingArgs> {
        return args as ServingArgs;
    }

    public createFrontendService(
        name: string,
        args: FrontendServiceArgs & { enableAuth?: boolean },
        opts?: Omit<pulumi.ComponentResourceOptions, 'parent'>
    ): FrontendService {
        const enableAuth = args.enableAuth ?? false;
        _.unset(args, 'enableAuth');
        return new FrontendService(name, {
            ...args,
            middlewares: pulumi.output(args.middlewares)
                .apply(ms => [
                    ...(enableAuth ?? false) ? [this.middlewareAuth] : [],
                    ...ms ?? [],
                ])
        }, {
            ...opts ?? {},
            parent: this,
        })
    }
}
