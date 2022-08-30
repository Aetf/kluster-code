import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";

interface BtArgs {
    serving: Serving,
    host: string,
}

export class Bt extends pulumi.ComponentResource<BtArgs> {
    public readonly certificate: BackendCertificate;

    private readonly tlsMountPath: string;

    constructor(name: string, args: BtArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Bt', name, args, opts);
        this.tlsMountPath = '/tls';

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    'OPENVPN_USERNAME': 'AgAlu4p768QXgd7QU0JK8tIizjA96C07Q/BV56eQNKF/OsJQ/btQ4ri1T45cs20eQE0HESONiD+qEhejBj17NMKTN0zDJueTXxbxskgau5oFmgRVrvvYiPIZhFdoEhMbm3ZXqmw68YtANHWQ615UO3a7VSDlBtkZ/CJVW4oY6cJ+8bKwIaeJzrM54Ls5PuQTkIRH7Jdmt6KNzFwSiMl+AaHAh9MW2T+vKxcZs3FnIS5DXHxDRHmIjGmL3bhonIFwg/IT0b2MG3aePNEBcTcQ+61Miy2r+1kV0j9UZmhOhQ5QNiq9dgBvYGFJ1/kmL67MZjYfhzuhXzQkMXXrp8FKorf8kQ4ct0yPD/gzzlHdqx46YJzFzRp0ViG6bmPe1sAoFzoN6whaaEuLgUJFPjIJC/jYGqKEQ1f5VDRHFqJAp9mmCDCLkb/Ct8d46P699HPgJJnVJMr7Jbabeia4ortdidPQsk2af2TLem1/Nr2uHvQjy8ZTbPMcuaQfbt2Non/kjJtQmdw2UZAQB8ytb0zUWgIgYWyuKy7EKwBAhggwg0uT2zd5cERiebc/+HDRFBpHDpQ5rIxa3KjbHPxa0XiamBs1gx+bzCM9SNRX+NKJ8jpGv9emq/+ryZWOf7etEBpm8A8fIibJupzwRBK1hhLnafcE8Z5+7An3psIMUXkVbTHUkwraFkheMmZX7LAZUpysBBCffn+UpzFlDw==',
                    'OPENVPN_PASSWORD': 'AgAKxfIODupi/+k9UHcDWbho97eoW4ZFNJqy4tXBcV8KRqJZIf9evaW9nWVhFIjFDVoe0ppRDIYUIrYabL3l/rMziyq/Ep8J+0rInyGIg9TD0iiR6EqKfda32jHNkkoWzh9o7VxfB+TtD3UYLrBlhrjqAl0e5iOov9ILD0XikYYTxJA0eEJMgRiIbo4VeJ/2Sy1XHMV8ECcK7KPICCbtenh3a8QuyGTONQCoGyeXAfQ6t7nzgUFvg5yHAY8zdmlKH12w4Miv1qqv9dUuZ2UzavAGPZV9KQi4Gi4TlRbsYSBP6wsaBD42CmL56Mm8BxE5Fi50MDni5V82OXJ5vrJUbWFL4Z90xpiSWeKyxSgmhBsL6l90Fwz9oNCPKtem9RFJH1rCQ5JUrdfdeekZtW6rfjslfTanGtdVfpxPMeJG/Twa1OcmWzDzGerwCV3LXs9hDoHhx76H8EmF3vvVxFNR4KJQ8MnBYhjOxX32/WXHZQFPCaM6lrtehjXsYIiL0poBb9CYN+/RaDwNyD9eiFmDM0R7BmKavOgUE7CfrbKAeTL/Ta4y1c+5FRTH6ljKFkLdjH+TVQJhHWonUd5OOdvOe9Xw//qiZHs9Wp72h4M3LxIVeNcFF2BNXd5aVg9oC/cMweAr1iu6gf85XYxTilgclBYSf2TK7emcA2vwTNllnXOmXAl7tcxHGMGbx83gIcK6gkXmSjnGC/GIR1Yc+KDCRMoRd4sD5//NA/QtSD9+jBHRkfoZyJY3UdrqZ63S6jQb9r4o',
                },
                template: {
                    data: {
                        'openvpn-credentials.txt': '{{ index . "OPENVPN_USERNAME" }}\n{{ index . "OPENVPN_PASSWORD" }}\n',
                    }
                }
            }
        }, { parent: this });

        // configmap for the nginx sidecar
        const cm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
            tplVariables: {
                tlsMountPath: this.tlsMountPath,
                serverName: args.host,
            }
        }, { parent: this });

        // download storage
        // TODO: use NodePV on homelab
        const pvc = args.serving.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "100Gi"
                }
            }
        }, { parent: this, });

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace: pvc.metadata.namespace,
        }, { parent: this });

        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            containers: [
            {
                image: 'docker.io/haugene/transmission-openvpn:latest',
                env: {
                    'OPENVPN_PROVIDER': 'PIA',
                    'OPENVPN_CONFIG': 'us_seattle',
                    'TZ': 'America/Los_Angeles',
                    'WEBPROXY_ENABLED': 'false',
                    'TRANSMISSION_WEB_UI': 'transmission-web-control',

                    // will use the nginx sidecar to expose the rpc to the cluster
                    'TRANSMISSION_RPC_BIND_ADDRESS': 'localhost',

                    'PUID': '1000',
                    'PGID': '1000',
                },
                volumeMounts: [
                    pvc.mount('/data'),
                    secrets.mount('/config/openvpn-credentials.txt', 'openvpn-credentials.txt'),
                ],
                securityContext: {
                    capabilities: {
                        add: [ 'NET_ADMIN' ],
                    }
                }
            },
            // to make sure the transmission rpc client only listens on internal
            // ip, we make it bind to localhost only, and then use a nginx proxy
            // to actually serve it as a backend service
            {
                image: 'docker.io/bitnami/nginx:1.23.1-debian-11-r14',
                ports: {
                    https: 8443,
                },
                volumeMounts: [
                    cm.mount('/opt/bitnami/nginx/conf/server_blocks'),
                    this.certificate.mount(this.tlsMountPath),
                ],
                livenessProbe: {
                    tcpSocket: {
                        port: 'https',
                    },
                },
                readinessProbe: {
                    tcpSocket: {
                        port: 'https',
                    },
                }
            }],
            securityContext: {
                fsGroup: 1000,
            }
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            },
        });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            enableAuth: true,
        });
    }
}
