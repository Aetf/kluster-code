import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BackendCertificate, NodePV } from '#src/base-cluster';
import { serviceFromDeployment, urlFromService, ConfigMap, SealedSecret } from "#src/utils";
import { Serving } from "#src/serving";
import { Redis } from '#src/redis';
import { versions } from "#src/config";

interface NextcloudArgs {
    serving: Serving,
    host: string,

    smtpHost: pulumi.Input<string>,
    smtpPort: pulumi.Input<number>,

    servicePort?: number;
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
        const pvc = args.serving.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "1Gi"
                }
            }
        }, { parent: this, });

        this.namespace = pvc.metadata.namespace;

        this.certificate = args.serving.base.createBackendCertificate(name, {
            namespace: this.namespace,
        }, { parent: this });

        const nginxCm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/nginx/*',
            stripComponents: 2,
            tplVariables: {
                tlsMountPath: this.tlsMountPath,
                servicePort: args.servicePort,
            }
        }, { parent: this });

        const phpCm = new ConfigMap(`${name}-php`, {
            base: __dirname,
            data: 'static/php/*',
            stripComponents: 2,
        }, { parent: this });

        const nextcloudCm = new ConfigMap(`${name}-nc`, {
            base: __dirname,
            data: 'static/nextcloud/*',
            stripComponents: 2,
        }, { parent: this });

        const secret = this.setupSecret(name);

        // redis
        const redis = new Redis(`${name}-redis`, {
            persistentStorageClass: args.serving.base.localStorageClass.metadata.name,
            namespace: this.namespace,
            password: secret.asSecretKeyRef('redis_pass'),
        }, { parent: this });

        // deployment
        const pb = new kx.PodBuilder({
            volumes: [
                {
                    name: homePV.name,
                    persistentVolumeClaim: {
                        claimName: homePV.name,
                    }
                }
            ],
            containers: [{
                image: versions.image.nextcloud,
                env: {
                    NEXTCLOUD_ADMIN_USER: 'admin',
                    NEXTCLOUD_ADMIN_PASSWORD: 'admin',
                    NEXTCLOUD_TRUSTED_DOMAINS: pulumi.all([args.host, name, pvc.metadata.namespace])
                        .apply(([host, name, namespace]) => [host, `${name}.${namespace}`].join(' ')),

                    // database

                    // this has to be IP, using localhost will cause mysql trying to connect via unix socket
                    MYSQL_HOST: '127.0.0.1',
                    MYSQL_DATABASE: name,
                    MYSQL_USER: name,
                    MYSQL_PASSWORD: secret.asEnvValue('db_pass'),

                    // redis
                    REDIS_HOST: pulumi.output(redis.masterService).apply(s => s.internalEndpoint()),
                    REDIS_HOST_PORT: pulumi.output(redis.masterService).apply(s => s.port() || 0),
                    REDIS_HOST_PASSWORD: {
                        secretKeyRef: redis.servicePassword
                    },

                    // nginx reverse proxy
                    TRUSTED_PROXIES: 'localhost',

                    // smtp settings
                    MAIL_FROM_ADDRESS: 'master',
                    MAIL_DOMAIN: 'unlimited-code.works',
                    SMTP_HOST: args.smtpHost,
                    SMTP_PORT: pulumi.interpolate`${args.smtpPort}`,
                    SMTP_SECURE: 'tls',
                    SMTP_AUTHTYPE: 'NONE',
                    // force values
                    NC_default_phone_region: 'US',
                },
                volumeMounts: [
                    // can't directly mount php cm, as the target directory is nonempty.
                    // mount it as subPath
                    phpCm.mount('/usr/local/etc/php-fpm.d/zz-max_children.conf', 'max_children.conf'),

                    // host data access
                    {
                        name: homePV.name,
                        mountPath: this.homeMountPath,
                        mountPropagation: 'HostToContainer'
                    },
                    webdavPV.mount(this.webdavMountPath),

                    // ca certificate for smtp tls
                    // avoid deuplicate in nginx
                    // FUTURE: change to mount after issue https://github.com/pulumi/pulumi-kubernetesx/issues/69
                    {
                        name: this.certificate.secretName,
                        mountPath: '/tls',
                    },
                    // k8s specific settings
                    nextcloudCm.mount('/var/www/html/config/k8s.config.php', 'k8s.config.php'),

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
                image: versions.image.nginx,
                ports: {
                    https: args.servicePort,
                },
                volumeMounts: [
                    nginxCm.mount('/opt/bitnami/nginx/conf/server_blocks'),
                    this.certificate.mount(this.tlsMountPath),
                    pvc.mount('/var/www'),
                ],
                livenessProbe: this.configureProbe(args),
                readinessProbe: this.configureProbe(args),
            }, {
                image: versions.image.mariadb,
                args: [
                    '--character-set-server=utf8mb4',
                    '--collation-server=utf8mb4_unicode_ci',
                    '--skip-innodb-read-only-compressed',
                ],
                env: {
                    BITNAMI_DEBUG: 'true',
                    MARIADB_ROOT_PASSWORD: secret.asEnvValue('db_root_pass'),
                    MARIADB_DATABASE: name,
                    MARIADB_USER: name,
                    MARIADB_PASSWORD: secret.asEnvValue('db_pass'),
                },
                volumeMounts: [{
                    name: pvc.metadata.name,
                    mountPath: '/var/lib/mysql',
                    subPath: 'db'
                }],
            }],
            securityContext: {
                // www-data
                // fsGroup: 82,
            }
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/search": "true"
                }
            },
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
                image: versions.image.nextcloud,
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
                failedJobsHistoryLimit: 1,
                successfulJobsHistoryLimit: 1,
                jobTemplate: {
                    spec: cronpb.asJobSpec({
                        backoffLimit: 1,
                    })
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

    private setupSecret(name: string): SealedSecret {
        return new SealedSecret(name, {
            spec: {
                encryptedData: {
                    db_pass: 'AgBwXwv/Wp28sWUkhe6Dd/gqFyMES3XvzsQPOGk/OvCHNiSWmj4sQCKO85G7bU1udNywoEGdEpsLtWyQ4aQNO4Bs2ZhMBZWvlAi10Fol+lf0bSNoZh4qMayTGf4KlYpQQah58P6mGXyENFgleDawZXWQ0eQMJ85HSKdeCrbNDOUNj4wF8UeqwFevIRyfHdQ44Oc8nZhlPSkIb3/A5FVZMjQ0/LNaqJYQvJVL6Xlse2KTIRanzk70Xx9WS/UjwEFVnPN6PckBBs/wIhUP6RPiVxZCBTm8iF2ALPMVxZ65UVZsunXIzNLlymQ1yM4C5VQRk1xQQnQ8wVafJMQz9dqA7kg05DhJkFbdMmuL3A0fsZpI81NlJUN1mYUZ858wTwDdxxn6cucpgQf7VpR7aikGw91y1Ni/+Zif6/VwNeJSWNHYt9CdoNZYKncX8fIcH9UnTV+0UKOcmqCVmpbLaJIKCsEb2CVNLwhW1ihUwI6NX7N7dhENksprf95p1OPI+tM9Wnd2T7ua9f4yG/X+tL9/SOixuuzVyG7zKubw9NrUAtJVXReidi0vtaTaKBRitgKz/L4IsaKP5OmXTlwJgh73ADvbUxeoz8Cow4AAikaevs4aI3AM7Zc2yYYxyAyVpQsoPOomCe+GsW3x1ImuUeo8aSt/R7y8wKmshb4Wc/fT4yGAmNY8XiUGvFZwQZ/NaThnB4rIydMSm67qN3PFBUrdyoBjl11zYToDONsyDpppKqqk+UHiN5ULgc2seRBSID4=',
                    db_root_pass: 'AgBjipdlUSpFS+IMbrnXZCSBSJdSimke0H4f8JzLwzy3Av4e94jJ546i4ixkHoPc8WXf9U+1EOHbCO3nn+USUqt/rfoOQrAKyFTz/Z9MVddrXkH/w9YQJCa9OQLpVvHVLWwmwGCWwYbBWzpnKx96QIl9rbXHLzzq3Vu3Eg9iTr1rCGSI5ID01he/CrgHV0voco1SutvNiw9YC+FYLmLYl7p5WZPxvmzvS36CLPupH6kkBUCM6NGzT3cENb3Y8yaHtCC6Lp84HoQRo5cuLSbW35FULTb4DkMhhS+CLLZd4raNDl66nQkT+SlSmgUo69ry8iv8bzqiMGEUNPLARd+h6RggIULbg7jht8TwCTA7BgHRWM8XpmqM40yNH59DIIlIDuMW8hjuD08WUVy8Ix7KaijDikgrHfw3iD5LkNCBlo0RKR/vpJbUJj+rmaP9Ootu4Q8mA5H5xyPLhgoMOxNUtdo1TmZa+BckMzkhLA1oxdryGXZNe0lO74rSl1UN1tGL4eMQM1SHDkO6hpuEHSo3tQuDfdpvpuwgT7ttApnAnpYth6ZThNjnMU9ll5ma+OwD9TXe2iJE707Wt7lN1bf30bQC5QPWTW+/UE7xm6wZ8CJNG/g2fYVUVT+WdRC2aVjKQn7oUEqq7sPFpqRoY8ERV/LOomI7p16mRlHc+qUnqaHsfoOUijo9htil+9g/1upZ22cUJzBPGPkpWMGm25yFxizOP7B16BNeOYTpC9mWTuyg42hOHOFfMPECWuHO0QM=',
                    redis_pass: 'AgAV9ddqjFGKVoP4KQjzJPVRk4vTNKEwiZ7aXudG5Ii4jfPpAdncNqWcN/dVDahJYtVX48q1zXULshDwIsNgwOXFJkQRMrohce+SSxUnp9g44dFDDwDYB/FA2fgRMnF9XG4NhpfLoWKd1hKHuoXJBdgMYUc/DwkxQj5BzJ8lDQ6JyAlpmuBaXuJOfE0/4F0nA8IP25LTNW3SIJrWzT+ka9XuhQymrJG6ZEvSbxy4FnX5NOQ0YSim1InV8hctw8l1oNTKv6Yn0a6pKlnq6tir9HNbrKpRKF/QY3AmHjQy915YcDV4BFrMXXdoyQxhkJylBWjxf0XSWSEiaAxJV6vk8gVLG+/lFAwj8LRyTrD/Ar8x1el/8lz3JmEwe2382lBiAkkIZ8Vosp0lo3zIHHoLRf/QiO6aN187VamWShHsno6BAKNv/FIjpB4wfExWvzk7lLe5QbOEYDRtU7kOvEwEnQEWWy/RWN1rshVt3oohtX5g+ebH6i1LdmoTrwFn2Z3tU5Qu3OZqwYrurxGOdHFfnnXxj+wPhGwn6NOodJJ8owLD+rwDbTDFdnoyHXTdCZ5g8mh99YJxKzGVwr6Sw2j8Khpro0FRAyB1kl4T6NfRBpCaK/yaz4KOgAOkSdhBgraWe2oGfJjW/VvYPui9o5XILdj1Q5+7PiLSBTrVfPqgpNpGyLbM/CgqJxGssM+LAa0IwMpzJqyKsiBh6fDaad2zFoBHKqDcAiaKaWo=',
                },
            }
        }, {
            parent: this
        });
    }
}
