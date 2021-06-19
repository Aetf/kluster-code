import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster } from "#src/base-cluster";
import { setAndRegisterOutputs } from "#src/utils";
import { Traefik } from "./traefik";
import { Authelia } from "./authelia";
import { FrontendCertificate } from "./certs";
import { basename } from "path";

export { Middleware } from "./traefik";
export { FrontendService } from './service';
export { BackendCertificate } from './certs';

interface ServingArgs {
    base: BaseCluster,

    domain: string,
    externalIPs: string[],

    httpPort?: number,
    httpsPort?: number,
}

export class Serving extends pulumi.ComponentResource<ServingArgs> {
    public readonly certificates: FrontendCertificate[];

    constructor(name: string, args: ServingArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Serving', name, args, opts);

        const traefik = new Traefik('traefik', {
            externalIPs: args.externalIPs,
            httpPort: args.httpPort ?? 80,
            httpsPort: args.httpsPort ?? 443,
        }, { parent: this });

        const authelia = new Authelia('authelia', {
            domain: args.domain,
            subdomain: 'auth',
            localStorageClassName: args.base.localStorageClass.metadata.name,
        }, { parent: this, dependsOn: traefik.chart.ready });

        this.certificates = [
            new FrontendCertificate('unlimited-code.works', {
                sans: [
                    "*.unlimited-code.works",
                    "*.hosts.unlimited-code.works",
                    "*.stats.unlimited-code.works",
                ],
            }, { parent: this }),
            new FrontendCertificate('unlimitedcodeworks.xyz', {
                sans: [
                    "*.unlimitedcodeworks.xyz",
                    "*.archvps.unlimitedcodeworks.xyz",
                ],
            }, { parent: this }),
            new FrontendCertificate('jiahui.id', {
            }, { parent: this }),
            new FrontendCertificate('jiahui.love', {
                sans: [
                    "*.jiahui.love",
                ],
            }, { parent: this }),
        ];

        setAndRegisterOutputs(this, {});
    }

    protected async initialize(args: pulumi.Inputs): Promise<ServingArgs> {
        return args as ServingArgs;
    }
}
