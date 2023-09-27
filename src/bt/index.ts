import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate } from '#src/base-cluster';
import { ConfigMap, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";

interface BtArgs {
    serving: Serving,
    host: string,
    pvc: pulumi.Input<kx.PersistentVolumeClaim>,
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
                    'OPENVPN_USERNAME': 'AgAwNa64mIuj5mSyjBZzFHgmnVeOUZaLuPLbp8HYNBXTxSvLHSPDN/XpYdM9EISuRIpYeGoWd2Gxd1gUtDrRsyGqHY3dS2iMnxsIYcMDrEuZI2rCYL4rZk2jLCkP345Uo6hrJAWfzWHjC/t8CzbEE0xhhp/J/WktXw9Akdeu2Hcvun0D9OK+WJLFhIs5LnrLEyx3EF6dvyiUxd5ZrjsOD/pHLqrEzpRXRDFNSSq+WRdJck/iPpGnx7q+roNalybC7U3ohdxdc7E1XMzwcwg7ODu+P0QraiiGyD+rnoa24G9V2Bsg4hiltspf/bGkvAlgk8a/iHPCkz87auVYn4A7PQ0WmCmXfAvNDKrt6RFW23tRP5JYbJyIH+NTuKRfi2yttCB2lVFcLDSi867SGWNRzJAwJNPy+72e11K0csarTeaUQAKXjSGluRYq96uB0V5ivcejw61nxmDZqy7qlxfJ2fIqN7lXfXUEx91T0+lI1zjShMs3e6qmC2FB8Tit9YgUtr/ERO0qErjKx/342IRKBIylBqIYao6QUHwHigRXYTAU1jNDV0FkolzZT9J/mCxSTWruItl1F4R+Jnjb/L/INZuK68tdYpfMJmZNJgo7zzpFFikcDD40xVHvFDdcOEurUs2t6iLrJ5ycJCMq+Xq7nwyZpbKZMtDEF90MmpLHVddqPGNVNdOjmqd68xEASseFgMv2TcG/4C4/q+8=',
                    'OPENVPN_PASSWORD': 'AgAPTzZfybtX9IDZIPsF12MTXl+qGv1iAcIPN7GJIhfgKrtnmTM56q+gMV5vFK/jEGpJqmNDYXnR4DBBHM+aUKM8Xsc7riyr/0614wUxjcWQhNvYpueKlslCZqoJkueGttUy3fK+s4aP8zj2Wnxpnp/ir3ntdv+inwobiLdQgXlyTmxmnnJKAz8N3pHwWRnRZyAnoc7sQy608qL4bH3NtT8mbZuHKg1VRQcm0/k+VTkglX9e9O2ubig7NS7eE+w5K0AB0PO5rGgxuycdBwGN2RmTGOqT6TxazgFVoXiK439bwzsp/bBbOoFD6QO453k+VrkkYF7o8OuM5/Vlm4bnq7e6N+ZnLwL5qIv+/iLGeFst24v5F/vitpmlYYTSL3RCnQeMFFElvJKb7+3hkU8PyB1QOLBATmK6Y5Frh/t7wvc3i8h9hAUI18afDm6e5BoGk9vwroYIgvtCCN6h8dON76fIE42Y03gktvG4LdTuZ6bOmwZ6rQwAbEA8glTZvKm835ja7i1P0yomoA7HGPeGMg9joza4NKGeP71h5OA9Zql/7f+Aclw5Mebckrqrpx4Jnn1iM4QjPCTKZNS+TpbgHRbOmi9uy6x34HM9SXPGOKne5Va2GMkEg1pFup1JYHHlJyv6f83pYclV7v5YMPgEEiHU9xN9q0DruDB63VfGgoG99fNQB/rsJE+Nz7L1iIoQ4wxa5UAgBq9hb0k1dNQzvoe+S1XDBMrYi32sWYpqBEcIvGQGqaOwrULfL5+hV8YynJUuMQ==',
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

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace: cm.metadata.namespace,
        }, { parent: this });

        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            containers: [
            {
                name,
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
                    pulumi.output(args.pvc).apply(pvc => pvc.mount('/data')),
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
                /* fsGroup: 1000, */
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
