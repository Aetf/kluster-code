import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { serviceFromDeployment } from "#src/utils";
import { Serving, Middleware, TLSOption } from "#src/serving";

interface SyncthingDiscosrvArgs {
    serving: Serving,
    host: string,
    externalIPs: string[],
}

export class SyncthingDiscosrv extends pulumi.ComponentResource<SyncthingDiscosrvArgs> {
    constructor(name: string, args: SyncthingDiscosrvArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:SyncthingDiscosrv', name, args, opts);

        const service_account = new k8s.core.v1.ServiceAccount(name, {}, { parent: this });
        const namespace = service_account.metadata.namespace;

        const certificate = args.serving.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        const pvc = args.serving.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "10Mi",
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                image: 'syncthing/discosrv:1.18.0',
                args: [
                    '-cert=/tls/tls.crt',
                    '-key=/tls/tls.key',
                ],
                ports: {
                    https: 8443,
                },
                volumeMounts: [
                    certificate.mount('/tls'),
                    pvc.mount('/var/stdiscosrv'),
                ],
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
                name,
            },
        });
        // stdiscosrv requires client certificate
        const tlsOption = new TLSOption(name, {
            sniStrict: true,
            clientAuth: {
                // TODO: change to RequreAnyClientCert after
                // https://github.com/traefik/traefik-helm-chart/issues/503
                clientAuthType: 'RequestClientCert',
            }
        }, { parent: this });
        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            tlsOption,
            middlewares: [
                // stdiscosrv needs client cert info
                // note that X-Client-Port is only needed if connecting using http
                // but we connect using https
                // https://docs.syncthing.net/users/stdiscosrv.html#requirements
                // https://github.com/syncthing/syncthing/pull/6065
                new Middleware('client-cert', {
                    passTLSClientCert: {
                        pem: true
                    }
                }, { parent: this })
            ],
        });
    }
}
