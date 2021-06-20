import * as fs from 'fs';
import * as pathFn from 'path';

import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate, NodePV } from '#src/base-cluster';
import { Serving } from "#src/serving";
import { serviceFromDeployment } from '#src/utils';

export interface StaticSite {
    // document root is relative to /srv/http in hostPath, i.e. siteMountPath in container
    root: string,
    hostNames: string[],
    // extra directives in the server block
    extraConfig?: string,
}

interface NginxArgs {
    serving: Serving,
    staticSites: StaticSite[],
}

export class Nginx extends pulumi.ComponentResource<NginxArgs> {
    public readonly certificate: BackendCertificate;

    private readonly tlsMountPath: string;
    private readonly siteMountPath: string;

    constructor(name: string, args: NginxArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Nginx', name, args, opts);
        this.tlsMountPath = '/tls';
        this.siteMountPath = '/app';

        const cm = this.setupCM(name, args);

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace: cm.metadata.namespace,
        }, { parent: this });

        const siteHostname = 'aetf-arch-vps';
        const nodepv = new NodePV(`${name}-sites`, {
            path: "/mnt/storage/webroot",
            node: k8s.core.v1.Node.get(siteHostname, siteHostname).metadata.name,
            capacity: "10Gi",
            accessModes: [ "ReadOnlyMany" ]
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: 'docker.io/bitnami/nginx:1.21.0-debian-10-r0',
                ports: {
                    https: 8443,
                },
                volumeMounts: [
                    cm.mount('/opt/bitnami/nginx/conf/server_blocks'),
                    nodepv.mount(this.siteMountPath),
                    this.certificate.mount(this.tlsMountPath),
                ],
                livenessProbe: {
                    tcpSocket: {
                        port: 'https',
                    },
                    periodSeconds: 10,
                    timeoutSeconds: 5,
                    successThreshold: 1,
                    failureThreshold: 6,
                },
                readinessProbe: {
                    tcpSocket: {
                        port: 'https',
                    },
                    initialDelaySeconds: 5,
                    periodSeconds: 5,
                    timeoutSeconds: 3,
                    successThreshold: 1,
                    failureThreshold: 3
                }
            }],
        });

        const deployment = new kx.Deployment(name, {
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            },
        });

        const front = args.serving.createFrontendService(name, {
            host: _.concat([], ...args.staticSites.map(s => s.hostNames)),
            targetService: service,
            enableAuth: true,
        });
    }

    private setupCM(name: string, args: NginxArgs): kx.ConfigMap {
        const confFile = 'static_sites.conf';
        const tpl = _.template(fs.readFileSync(pathFn.join(__dirname, 'static', confFile), 'utf-8'));

        const cm = new kx.ConfigMap(name, {
            data: {
                [confFile]: tpl({
                    tlsMountPath: this.tlsMountPath,
                    sites: args.staticSites.map(site => ({
                        server_name: site.hostNames.join(' '),
                        root: pathFn.join(this.siteMountPath, site.root),
                        extra: site.extraConfig
                    })),
                })
            }
        }, { parent: this });
        return cm;
    }
}
