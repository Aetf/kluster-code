import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster, FrontendCertificate } from "#src/base-cluster";

import { Traefik, Middleware } from "./traefik";
import { Authelia } from "./authelia";

export { Middleware } from "./traefik";
export { FrontendService } from './service';

interface ServingArgs {
    base: BaseCluster,

    domain: string,
    externalIPs: string[],

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
            domain: args.domain,
            subdomain: 'auth',
        }, { parent: this, dependsOn: traefik.chart.ready });
        this.middlewareAuth = authelia.middlewareAuth;

        this.certificates = [
            args.base.createFrontendCertificate('unlimited-code.works', {
                sans: [
                    "*.unlimited-code.works",
                    "*.hosts.unlimited-code.works",
                    "*.stats.unlimited-code.works",
                ],
            }, { parent: this }),
            args.base.createFrontendCertificate('unlimitedcodeworks.xyz', {
                sans: [
                    "*.unlimitedcodeworks.xyz",
                    "*.archvps.unlimitedcodeworks.xyz",
                ],
            }, { parent: this }),
            args.base.createFrontendCertificate('jiahui.id', {
            }, { parent: this }),
            args.base.createFrontendCertificate('jiahui.love', {
                sans: [
                    "*.jiahui.love",
                ],
            }, { parent: this }),
        ];

        this.registerOutputs({
            ready: this.ready
        });
    }

    protected async initialize(args: pulumi.Inputs): Promise<ServingArgs> {
        return args as ServingArgs;
    }
}
