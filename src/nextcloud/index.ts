import * as _ from 'lodash';
import * as fs from 'fs';
import * as pathFn from 'path';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate, NodePV } from '#src/base-cluster';
import { serviceFromDeployment, urlFromService } from "#src/utils";
import { Serving } from "#src/serving";
import { SealedSecret } from '#src/crds/bitnami/v1alpha1';

interface NextcloudArgs {
    serving: Serving,
    host: string,
    servicePort?: number;
    image?: string,
    nginxImage?: string,
    mariadbImage?: string,
}

export class Nextcloud extends pulumi.ComponentResource<NextcloudArgs> {
    public readonly certificate: BackendCertificate;

    private readonly tlsMountPath: string;
    private readonly homeMountPath: string;
    private readonly webdavMountPath: string;
    private readonly namespace: pulumi.Output<string>;

    constructor(name: string, args: NextcloudArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Nextcloud', name, args, opts);
        this.tlsMountPath = '/tls';
        this.homeMountPath = '/homedata';
        this.webdavMountPath = '/webdav';
        args.servicePort = args.servicePort ?? 8443;
        args.image = args.image ?? 'docker.io/nextcloud:21.0.3-fpm-alpine';
        args.nginxImage = args.nginxImage ?? 'docker.io/bitnami/nginx:1.21.0-debian-10-r20';
        args.mariadbImage = args.mariadbImage ?? 'docker.io/mariadb:10.6.2';

        // nodepv for host file access
        const webdavPV = new NodePV(`${name}-webdav`, {
            path: "/mnt/storage/webroot/webdav",
            node: args.serving.base.nodes.AetfArchVPS,
            capacity: "10Gi",
        }, { parent: this });
        const homePV = new NodePV(`${name}-home`, {
            path: "/home/aetf",
            node: args.serving.base.nodes.AetfArchVPS,
            capacity: "50Gi",
        }, { parent: this });

        // persistent storage for config
        const pvc = new kx.PersistentVolumeClaim(name, {
            metadata: {
                annotations: {
                    // the pvc will be pending because of WaitForFirstConsumer
                    // so don't wait for it in pulumi
                    // see https://github.com/pulumi/pulumi-kubernetes/issues/895
                    "pulumi.com/skipAwait": "true"
                }
            },
            spec: {
                storageClassName: args.serving.base.localStorageClass.metadata.name,
                accessModes: [
                    'ReadWriteOnce',
                ],
                resources: {
                    requests: {
                        storage: "1Gi"
                    }
                }
            }
        }, { parent: this });

        this.namespace = pvc.metadata.namespace;

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace: this.namespace,
        }, { parent: this });

        const cm = this.setupCM(name, args);
        const phpCm = this.setupPhpCM(name, args);

        const secret = this.setupSecret(name);

        // deployment
        const pb = new kx.PodBuilder({
            containers: [{
                image: args.image,
                env: {
                    NEXTCLOUD_ADMIN_USER: 'admin',
                    NEXTCLOUD_ADMIN_PASSWORD: 'admin',
                    NEXTCLOUD_TRUSTED_DOMAINS: pulumi.all([args.host, name, pvc.metadata.namespace])
                        .apply(([host, name, namespace]) => [host, `${name}.${namespace}`].join(' ')),

                    // database
                    MYSQL_HOST: 'localhost',
                    MYSQL_DATABASE: name,
                    MYSQL_USER: name,
                    MYSQL_PASSWORD: {
                        secretKeyRef: {
                            name: secret.metadata.name,
                            key: 'db_pass',
                        }
                    },

                    // nginx reverse proxy
                    TRUSTED_PROXIES: 'localhost',

                    // smtp settings
                    MAIL_FROM_ADDRESS: 'master',
                    MAIL_DOMAIN: 'unlimited-code.works',
                    SMTP_HOST: 'smtp.gmail.com',
                    SMTP_PORT: '587',
                    SMTP_SECURE: 'tls',
                    SMTP_NAME: {
                        secretKeyRef: {
                            name: secret.metadata.name,
                            key: 'smtp_user'
                        }
                    },
                    SMTP_PASSWORD: {
                        secretKeyRef: {
                            name: secret.metadata.name,
                            key: 'smtp_pass',
                        }
                    },

                    // force values
                    NC_default_phone_region: 'US',
                },
                volumeMounts: [
                    // can't directly mount php cm, as the target directory is nonempty.
                    // mount it as subPath
                    phpCm.mount('/usr/local/etc/php-fpm.d/zz-max_children.conf', 'max_children.conf'),

                    // host data access
                    homePV.mount(this.homeMountPath),
                    webdavPV.mount(this.webdavMountPath),

                    // pvc.mount will be used in the nginx container
                    // so do not use pvc.mount, to not create an unnecessary second volume
                    {
                        name: pvc.metadata.name,
                        mountPath: '/var/www',
                        // use a subpath (effectively an empty dir) to avoid clutter in side the container
                        subPath: 'root',
                    },
                    // the following is necessary due to the VOLUME directive in the Dockerfile
                    ...['html', 'tmp'].map(dir => ({
                        name: pvc.metadata.name,
                        mountPath: `/var/www/${dir}`,
                        subPath: dir,
                    })),
                    ...['data', 'config', 'custom_apps', 'themes'].map(dir => ({
                        name: pvc.metadata.name,
                        mountPath: `/var/www/html/${dir}`,
                        subPath: dir,
                    })),
                ],
            }, {
                image: args.nginxImage,
                ports: {
                    https: args.servicePort,
                },
                volumeMounts: [
                    cm.mount('/opt/bitnami/nginx/conf/server_blocks'),
                    this.certificate.mount(this.tlsMountPath),
                    pvc.mount('/var/www'),
                ],
                livenessProbe: this.configureProbe(args),
                readinessProbe: this.configureProbe(args),
            }, {
                image: args.mariadbImage,
                args: [
                    '--character-set-server=utf8mb4',
                    '--collation-server=utf8mb4_unicode_ci',
                    '--skip-innodb-read-only-compressed',
                ],
                env: {
                    BITNAMI_DEBUG: 'true',
                    MARIADB_ROOT_PASSWORD: {
                        secretKeyRef: {
                            name: secret.metadata.name,
                            key: 'db_root_pass',
                        }
                    },
                    MARIADB_DATABASE: name,
                    MARIADB_USER: name,
                    MARIADB_PASSWORD: {
                        secretKeyRef: {
                            name: secret.metadata.name,
                            key: 'db_pass',
                        }
                    }
                },
                volumeMounts: [{
                    name: pvc.metadata.name,
                    mountPath: '/var/lib/mysql',
                    subPath: 'db'
                }],
            }],
            securityContext: {
                // www-data
                fsGroup: 82,
            }
        });

        const deployment = new kx.Deployment(name, {
            spec: pb.asDeploymentSpec({
                strategy: {
                    rollingUpdate: {
                        // allow scale down old RS first, because the database locks the volume,
                        // preventing new RS to scale up
                        maxUnavailable: '100%',
                    }
                }
            }),
        }, { parent: this, });
        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            }
        });

        const front = args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            // TODO: enable auth after authelia odic GA
            enableAuth: false,
        });

        // cron job
        const cronpb = new kx.PodBuilder({
            restartPolicy: 'Never',
            containers: [{
                image: args.image,
                command: ["sh"],
                args: [
                    '-c',
                    urlFromService(service, 'https')
                        .apply(base => new URL('/cron.php', base).href)
                        .apply(url => [
                            'curl',
                            '--cacert', '/tls/ca.crt',
                            '--verbose',
                            '--fail-with-body',
                            url,
                            '|', 'tee', '/dev/fd/2', '|', 'grep', '-q', 'success'
                        ].join(' ')),
                ],
                volumeMounts: [
                    this.certificate.mount(this.tlsMountPath),
                ]
            }]
        });
        const cron = new k8s.batch.v1.CronJob(name, {
            spec: {
                schedule: "*/5 * * * *",
                concurrencyPolicy: 'Forbid',
                failedJobsHistoryLimit: 5,
                successfulJobsHistoryLimit: 1,
                jobTemplate: {
                    spec: cronpb.asJobSpec()
                }
            }
        }, { parent: this });
    }

    private configureProbe(args: NextcloudArgs, override?: k8s.types.input.core.v1.Probe): k8s.types.input.core.v1.Probe {
        return {
            httpGet: {
                path: "/status.php",
                port: "https",
                scheme: "HTTPS",
                httpHeaders: [{
                    name: 'Host',
                    value: args.host,
                }]
            },
            initialDelaySeconds: 10,
            periodSeconds: 10,
            timeoutSeconds: 5,
            successThreshold: 1,
            failureThreshold: 30,
            ...(override ?? {})
        };
    }

    private setupCM(name: string, args: NextcloudArgs): kx.ConfigMap {
        const confFile = 'nextcloud_nginx.conf';
        const tpl = _.template(fs.readFileSync(pathFn.join(__dirname, 'static', confFile), 'utf-8'));

        const cm = new kx.ConfigMap(name, {
            data: {
                [confFile]: tpl({
                    tlsMountPath: this.tlsMountPath,
                    args,
                })
            }
        }, { parent: this });
        return cm;
    }

    private setupPhpCM(name: string, args: NextcloudArgs): kx.ConfigMap {
        const confFile = 'max_children.conf';
        const tpl = _.template(fs.readFileSync(pathFn.join(__dirname, 'static', confFile), 'utf-8'));

        const cm = new kx.ConfigMap(`${name}-php`, {
            data: {
                [confFile]: tpl({})
            }
        }, { parent: this });
        return cm;
    }

    private setupSecret(name: string): SealedSecret {
        return new SealedSecret(name, {
            metadata: {
                // make sure the name is stable, because kubeseal may use the secret name to decrypt
                name,
                annotations: {
                    "sealedsecrets.bitnami.com/namespace-wide": "true",
                }
            },
            spec: {
                encryptedData: {
                    smtp_pass: 'AgBeBkoSkjCdussUsQRQibNojzpEW+2G3iGw+j4q3FcTGr4OXqG5AK2P+mmUykNm3BlNlbsvoDFAQRvz8SkMv5jhUL2bbg7m32j3GRmfi/q+kNJ0k4IzEDv9dV2snfcyoWEU+N/Q+WHOonq3zOxg76AQP/uNRHu2n71JgkshmGHD0B1+4eKGL58EDifq0jJviig6oKQSWCdEHkW1Jq25cUKe6tEB5NI8ppwKJ022famptdxs14duuKRflSjub6tFhv9RR7GBga6Xr2PR7CzyuoVL60o7x/sZwR+6E4Orp7r6/HqFkfvOnI9DsGcVHmvEbh0ASWPQQnmv3UI5MyLZLOpIe7++BTPMN31QdSaOmtapmccPD0R/6fkp7hQQKn41I0knvV7lx1dGtuRpndKYNNB+eHr76CfY0NlyN/a+v8Lr6Kq59TrEyGb8QWILTQDVIHjtBpqSNpExgxyUjH4h6Pc+tABBkbs20gpwwQk+qGDO0xmfKLs6cSaNDlgh1MxAhJz7COkHDPBjMy/8nETyO8/YMFAUmLNY0tZ3pqNSISYQjxqEwHh+MB+B0GUzCv8MpwITLW0P5DD0aQm5/6S7QpJsKQgBjYI+RpC4y3DJEV2Pssv4yuek60ohtGJW3tgtwli7KE+n1F4cTmX7197SXKdkLrWAb4uIywMBmoP/RBrbs4p/UkW7EubA3EobGHSJwt8cYbTAQvuEQ25RxzDr3PnY',
                    smtp_user: 'AgBmpEDMjn2UmenbQG3KoI49l3f1jdzkreZyTl9wm4wJblK614TRuMofi/ZtuPJ8qK+fYAC0MQfX1AqkrcTI4uZlZ67AR7tAAyGZxcRixLmdbxbnArEXser0kG9OkUpwJtUnSH8Ov/o1r6YkM6XrzFCPxfY5rCQsJjKAVhPH2VBK7pe0Llu1vZfs1BStOd9W5wzNphdL3Vzn542dG0xEytwxi+FSUC4rZaA5xjAsaLe6QwZeWehtWYZ8HXO7ZkiT6wG1ZePS4Pla6+vRKUIWNcI2yQEY4wDHwFy5XX+D3qoU06e3khCwiFPa94bcPcDkADscbOcYQiNJ9TWue6ZfNaaYJmWTYGbuApm6mG2n4YcGe8fD67qAuazMndBDF6+ClpJAuodlRS5DQ3CDbACimYEpWAS6HhVWskbW8KDhEWD8CRf4dvrslyZUGKaTnVXEBEDmRbuveuGDGopIyoew72pkgTfQh04B9Jg0v6slXTEwxb4L8RPcfLr+cQpICCgtqOxfqL5oJP16bQ0/t76Z/0LxKfXZfgyCTXAK7lDLC9k19nRgFCBXzT/c3dSrnUPVy28V2xyOb5IBy6MFe2+bph/Q+QmiacSPV6FRYH3lCru9etLOqvjTLrHG4KZwMm7xHwXIY6kIdc/z+kzMIl27DfYlJzDtdjDmqKe8XfdlYon3No2JxBJCMMl66jRwDNfOFRnee08xaCfQnlYUF7RkJob5Wg==',
                    db_pass: 'AgBwXwv/Wp28sWUkhe6Dd/gqFyMES3XvzsQPOGk/OvCHNiSWmj4sQCKO85G7bU1udNywoEGdEpsLtWyQ4aQNO4Bs2ZhMBZWvlAi10Fol+lf0bSNoZh4qMayTGf4KlYpQQah58P6mGXyENFgleDawZXWQ0eQMJ85HSKdeCrbNDOUNj4wF8UeqwFevIRyfHdQ44Oc8nZhlPSkIb3/A5FVZMjQ0/LNaqJYQvJVL6Xlse2KTIRanzk70Xx9WS/UjwEFVnPN6PckBBs/wIhUP6RPiVxZCBTm8iF2ALPMVxZ65UVZsunXIzNLlymQ1yM4C5VQRk1xQQnQ8wVafJMQz9dqA7kg05DhJkFbdMmuL3A0fsZpI81NlJUN1mYUZ858wTwDdxxn6cucpgQf7VpR7aikGw91y1Ni/+Zif6/VwNeJSWNHYt9CdoNZYKncX8fIcH9UnTV+0UKOcmqCVmpbLaJIKCsEb2CVNLwhW1ihUwI6NX7N7dhENksprf95p1OPI+tM9Wnd2T7ua9f4yG/X+tL9/SOixuuzVyG7zKubw9NrUAtJVXReidi0vtaTaKBRitgKz/L4IsaKP5OmXTlwJgh73ADvbUxeoz8Cow4AAikaevs4aI3AM7Zc2yYYxyAyVpQsoPOomCe+GsW3x1ImuUeo8aSt/R7y8wKmshb4Wc/fT4yGAmNY8XiUGvFZwQZ/NaThnB4rIydMSm67qN3PFBUrdyoBjl11zYToDONsyDpppKqqk+UHiN5ULgc2seRBSID4=',
                    db_root_pass: 'AgBjipdlUSpFS+IMbrnXZCSBSJdSimke0H4f8JzLwzy3Av4e94jJ546i4ixkHoPc8WXf9U+1EOHbCO3nn+USUqt/rfoOQrAKyFTz/Z9MVddrXkH/w9YQJCa9OQLpVvHVLWwmwGCWwYbBWzpnKx96QIl9rbXHLzzq3Vu3Eg9iTr1rCGSI5ID01he/CrgHV0voco1SutvNiw9YC+FYLmLYl7p5WZPxvmzvS36CLPupH6kkBUCM6NGzT3cENb3Y8yaHtCC6Lp84HoQRo5cuLSbW35FULTb4DkMhhS+CLLZd4raNDl66nQkT+SlSmgUo69ry8iv8bzqiMGEUNPLARd+h6RggIULbg7jht8TwCTA7BgHRWM8XpmqM40yNH59DIIlIDuMW8hjuD08WUVy8Ix7KaijDikgrHfw3iD5LkNCBlo0RKR/vpJbUJj+rmaP9Ootu4Q8mA5H5xyPLhgoMOxNUtdo1TmZa+BckMzkhLA1oxdryGXZNe0lO74rSl1UN1tGL4eMQM1SHDkO6hpuEHSo3tQuDfdpvpuwgT7ttApnAnpYth6ZThNjnMU9ll5ma+OwD9TXe2iJE707Wt7lN1bf30bQC5QPWTW+/UE7xm6wZ8CJNG/g2fYVUVT+WdRC2aVjKQn7oUEqq7sPFpqRoY8ERV/LOomI7p16mRlHc+qUnqaHsfoOUijo9htil+9g/1upZ22cUJzBPGPkpWMGm25yFxizOP7B16BNeOYTpC9mWTuyg42hOHOFfMPECWuHO0QM=',
                },
                template: {
                    metadata: {
                        annotations: {
                            "sealedsecrets.bitnami.com/namespace-wide": "true",
                        }
                    }
                }
            }
        }, {
            deleteBeforeReplace: true,
            parent: this
        });
    }
}
