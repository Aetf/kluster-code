import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as crds from "#src/crds";
import * as kx from "@pulumi/kubernetesx";

import { NamespaceProbe, HelmChart, SealedSecret, ConfigMap } from "#src/utils";
import { BaseCluster } from '#src/base-cluster';
import { Redis } from '#src/redis';
import { Serving } from '#src/serving';

interface ImmichArgs {
    serving: Serving,
    host: pulumi.Input<string>,
    storageClass: pulumi.Input<string>,
    dbStorageClass: pulumi.Input<string>,
    cacheStorageClass: pulumi.Input<string>,
}

export class Immich extends pulumi.ComponentResource<ImmichArgs> {
    public readonly chart?: HelmChart;
    private readonly namespace: pulumi.Output<string>;

    private readonly libraryPVC: kx.PersistentVolumeClaim;
    private readonly dbname: string;
    private readonly database: crds.postgresql.v1.Cluster;

    constructor(name: string, args: ImmichArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Immich', name, args, opts);

        this.namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        this.libraryPVC = args.serving.base.createLocalStoragePVC(`${name}`, {
            storageClassName: args.serving.base.jfsStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "50Ti"
                }
            }
        }, { parent: this, retainOnDelete: true });

        this.dbname = 'app';
        this.database = this.setupDatabase(name, this.dbname, args.serving, args.dbStorageClass);
        const dbhost = pulumi.interpolate`${this.database.metadata.name}-rw`;
        const dbpassSecret = pulumi.interpolate`${this.database.metadata.name}-${this.dbname}`

        const secret = new SealedSecret(`${name}`, {
            spec: {
                encryptedData: {
                    typesense_api_key: 'AgCr1G0BarxDF/B9DzdQdUcTIeoTbgZ3/pz276W+hG0FqoimSSTT772uIPy4CLHdA4Bx/K7CtXaRTCBijzK7N+rgGFULdDJiLT1Rz/j3cUBgeYFUoJ4NQ5N+xB1rVLoCGtYkdT1je5nz4SgoEI0OW3B6b6jHQaz+411PZ3kAXDJdEO9l94PB928QOO/W8RA12kRYeK8NgvNg/T5Kh6tkfKAmJv74fKiMTgWvkY3QAvH6IoXFkv6KDY+XhSl6TvaJxnfIsDN4IkF21kR6lhIqwzxqWrK9wOVCQvyuiqVu/jJ1LgKGhifAFlBALW6lOrN3bVtDaxeOWp3d6hoeJle3VLa5NGSWznHHNn4zdtgpnFpdIyJq7gTuHZLpvx+UUAK6x7ngKs64YTQjE+k45EOKJASP1CT7ghURN7a8xC6Z6aqx2mvQB2OlV2RgNvFVBHddTEgnyt47/L2Ctf3Oz00RULHoh5supzE8iwOyj60MPre5qaBJ1ENlgM0I28ij9vHD1mh3/ETH/gy5wu+g7Bo4fIJgIOXFypBLotvHWBWCTXn+Kh6MC/390mKT/NgReUqaqeWiVyA1dcpmKC8PNYmEgDnAOvK9NAZpW7ZnW4wvg4ZLCJ/EoVFuscpL/G0QuuYkWgejJXbzTUaLYiN64IhDeryKoV7HzwAGDse0x3RTAaLW/oMEeKDv7YqNw853q6r1iDiMQCeJ1IpbYp+BYpXvAf2hIUKz/L4nM03F7Q6SB9iOgw==',
                    redis_pass: "AgAqC5v0EFkO2vHj9Xjhv7d8klOhDC1M9UXNrHhROeVRJQPWYlkHCvnwgRo3zblMajBtk4rvR8fC5nKpfg9kSSW1KEmov0t5av9lhli1H4YnfWgkxHBzb8Vk1EVQ462bmoQX0j3hat7j4PY3BCOsdJsoFcHbbfEHeHJr7TFBwQ+qZMJ2QYtwHhE0b/R8Dl/FVwnY2+SzrxirIh+FrejscDAzxg+LGXea0G/31edJQFk8AwxbU7n84RWHSHlbtqX/UTHEFiXIkISuN0ePumWiUKDLb5xW4KVE92YJf1fPKkK1NVwkXrxCHXIHv88hX+eXleu3Lnm3Qt23Z7tW/hDvrSJ4P3sxZ/99e9JmBeh3yddyAZgcyBGng6W0fzu7BffrIiKw6m1f1aVHiw1dQsKAoatGKvY2TXG/ORMpQzMs5Y/BlPxFWV2tovR/OPDOmV/6NzgtdJkuoTXWDcR4eT2IsolR5e4lpub3tye7M1E4hfcsEN67quS64HoqCsPzCEa0tC/t+ILjfKhlk4kgTaSEmwRtbCvjlqe9TJYoyh9axYUxbNZvwSlSoIB4NJZBPkPmSoUjIiBJpme5GLb1z8+dWk+IkaYOiih/THlPOU1mHndxMJyn4m3T/hQ9RK6oZMlcPapG1PWheU3DIMPPzwvjTGLxvINAf2UpSLgSF8Pj3EdlxiHntjYFdmhKmcMS7PS948vj5Wg2TaXdeC6VAFBjyN8m2kWrxc24epJq+edpUfjKcQ=="
                }
            }
        }, {
            parent: this
        });
        const redis = this.setupRedis(name, args.cacheStorageClass, secret);
        const cmNginxConf = new ConfigMap(`${name}-nginx-conf`, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
        }, { parent: this });
        const proxyCert = args.serving.base.createBackendCertificate('immich-proxy', {
            namespace: this.namespace,
        }, { parent: this });

        // Now the real immich chart
        this.chart = new HelmChart(name, {
            namespace: this.namespace,
            chart: "immich",
            version: "0.1.2",
            fetchOpts: {
                repo: "https://immich-app.github.io/immich-charts",
            },
            values: {
                immich: {
                    persistence: {
                        library: {
                            existingClaim: this.libraryPVC.metadata.name,
                        }
                    }
                },
                env: {
                    'REDIS_HOSTNAME': redis.serviceHost,
                    'REDIS_PORT': redis.servicePort,
                    'REDIS_PASSWORD': {
                        valueFrom: secret.asEnvValue('redis_pass'),
                    },
                    // 'REDIS_PASSWORD_FILE': '/secrets/redis_pass',
                    'DB_HOSTNAME': dbhost,
                    'DB_PORT': '5432',
                    'DB_USERNAME': {
                        valueFrom: {
                            secretKeyRef: {
                                name: dbpassSecret,
                                key: 'username',
                            }
                        }
                    },
                    // 'DB_USERNAME_FILE': '/db-secret/username',
                    'DB_PASSWORD': {
                        valueFrom: {
                            secretKeyRef: {
                                name: dbpassSecret,
                                key: 'password',
                            }
                        }
                    },
                    //'DB_PASSWORD_FILE': '/db-secret/password',
                    'DB_DATABASE_NAME': this.dbname,
                    'TYPESENSE_API_KEY':  {
                        valueFrom: secret.asEnvValue('typesense_api_key'),
                    },
                },
                typesense: {
                    enabled: true,
                    env: {
                        'TYPESENSE_API_KEY': {
                            valueFrom: secret.asEnvValue('typesense_api_key'),
                        },
                    },
                    persistence: {
                        tsdata: {
                            enabled: true,
                            storageClass: args.cacheStorageClass,
                        },
                    },
                },
                server: {
                    persistence: {
                        secrets: {
                            enabled: true,
                            type: 'secret',
                            name: secret.metadata.name,
                        },
                        'db-secret': {
                            enabled: true,
                            type: 'secret',
                            name: dbpassSecret,
                        },
                    },
                },
                microservices: {
                    persistence: {
                        'geodata-cache': {
                            type: '', // empty defaults to PVC
                            accessMode: 'ReadWriteOnce',
                            storageClass: args.cacheStorageClass,
                        },
                        secrets: {
                            enabled: true,
                            type: 'secret',
                            name: secret.metadata.name,
                        },
                        'db-secret': {
                            enabled: true,
                            type: 'secret',
                            name: dbpassSecret,
                        },
                    },
                },
                'machine-learning': {
                    persistence: {
                        cache: {
                            type: '', // empty defaults to PVC
                            accessMode: 'ReadWriteOnce',
                            storageClass: args.cacheStorageClass,
                        }
                    }
                },
                // Make sure the immich-proxy uses HTTPS
                proxy: {
                    service: {
                        main: {
                            ports: {
                                http: {
                                    enabled: false
                                },
                                https: {
                                    enabled: true,
                                    primary: true,
                                    port: 8443,
                                    protocol: 'HTTPS',
                                },
                            }
                        }
                    },
                    persistence: {
                        'nginx-conf': {
                            enabled: true,
                            type: 'configMap',
                            name: cmNginxConf.metadata.name,
                            mountPath: '/etc/nginx/conf.d/nginx-tls.conf',
                            subPath: 'nginx-tls.conf',
                        },
                        'force-tls': {
                            enabled: true,
                            type: 'configMap',
                            name: cmNginxConf.metadata.name,
                            defaultMode: '0755',
                            mountPath: '/docker-entrypoint.d/99-force-tls.sh',
                            subPath: '99-force-tls.sh',
                        },
                        'tls': {
                            enabled: true,
                            type: 'secret',
                            name: proxyCert.secretName,
                        },
                    },
                    probes: {
                        liveness: {
                            spec: {
                                httpGet: {
                                    port: 'https',
                                }
                            }
                        }
                    }
                }
            }
        }, { parent: this });

        this.setupFrontendService(name, args.serving, args.host);
    }

    private setupDatabase(name: string, dbname: string, serving: Serving, storageClass: pulumi.Input<string>): crds.postgresql.v1.Cluster {
        const gcsSecret = new SealedSecret(`${name}-db`, {
            spec: {
                encryptedData: {
                    gcs_credentials: "AgBSkdtGJWP4758qg/bVugS2l0YUxrPcGtGkOFbWBS6qB/0LPS6yaxzvvq4OIWR8+9f527aWS0hIpO/wbaXJa3FxIEoVHzZ7JUCKKHrr3YUWHLk/kNiG6SelbXfMPv4rrs3yGzKGUtqnjV+EMncY6QPs9HqW/FUYcoZgO4J36ZiDfYme69NX+9nITf11NgvZ/QG7voZsMLK6f3mXzl9+mZrTnyf0uDNhODzXKxhux6Yz1SDoGIcao9dyXLs/05NtAKz0I3JcVQ6uH9qa29myCdUibja0CVZjkM7NQ85u9T/tKbDh4i93xcNPegpb9sphoqXUkGPIYlistNybSeUHb46mgfIG0vfv0t88/chb8o3zHWdVk19n1U4xIYEHQ2PgmHd8W6SENmGyCP0C17tufEjnplEUVtN9fLw/9M/KacWFMbP4KvjyFJxQRMpkkV6Rgu2241TzfkWGOSEdeLq0R+b7drhwm6LKOkGjgGvylxyedYNJ597AJJnO3EdQvCOPu1LMM1cJJv22inFixFR/7xe+IqW1FGiz+JtzE5rKGzBmMnGfITml1EHOe/rR6yuD8kCnmzXWhKXk31TlkzrU1oR1eAAinJ/M7UBb76W+IQyp4Zdf6as2Y60KtywCLQGA5EhC+85OQUsql0XXSSmfYC52jKY0CyPf8OgwNE7qCnZD82tQHMbMcajAGpIb5PykIOL9tQ3kgApQjLD2nxrCwCjAQVynGAgzQ2DNuurgqqg7aYu1jlrut02B8Mpuqbdj91a6ff4lnbqpnr0xLhuhX1wbBps/5q53nDvEYli1Hvo3vXcrBR3dgJdfu9WL6E7EN+jChE/yFdnUiiqsadHu9SCUz2ipqpgteJGj9lJ2bdo44HSmn3BvWkEygNOZ1CtRQrGqqOMUoMNcibtEl45F7depX1tvV3ETYSyAB38XnV1qSmd/zwCZb5LOdIi5L3rZ3TOwHUuhT9tTum35wU2LG6auqzVD2si0JODMrL6v5uImRC+b8JmgtGaMh1GTvc6BM9/4zLIb2poMAmdd2lBQKIjmMyDH7WVMpt44PZ5imZ5lp9zgjTS8Cf8WuBYeP1IX3AJ/GKup685aCwENEJctuz8N9qFeYoLt+296t9HxE+a+fVuvkVQA4tg/dajpdxgIpZlmQ59nr9UQDqa//IDxi0wvKwE7POlrKrxn58hpXPa0xFTTkX5rupV8hREUahX0jP/v0lLGLg7hF9s239ZGySgT8kKaodAd3JUU8wMcCqVNxOWc8/gmUCISp7NOqiSIkKj7DQYZeDODnF0fSNRYFKCce/7f/8d0sWdp/Yrbf4SMi7f5SECCTgs0X4Ag2VhHjfFe6kVD/D6tf0ysSMg32I3NYq1CkKrgwMy/mP2GWPBj5mWDf46yEOnGpfBRC3iju/F28KW9FATpoSWBNcouqDaoUDTWgEwm866r94UKvevVEPjQXTCW4j7kqqk7fq2nSLPwAyIauBG3XoBjxGTW+hNEHpC8W5lQH9QPAt/vwKs07z3bToXIJlm6PJQiMhouatlyefycbf5WovDYmxWP+bwNEsNuMAIs7PDA5duJFvxPcAAnjzX5mZKwy2tkuMsQNwzjfUi0miJPeL2updi3dO+cthGUhfA/REYCa7N3fJU3uZZOdf2wGzCZsZresIje9/arJYXKM5scLqijQBxMf1v0mC0VRY6MGyHtahS7OtVAyk1Y1bre72QlzK4PrGmfnETid4frtbPNEC0Sq5LQMuEKrvKaS5EW/MnHBZ2rO0SXOra5FXXuXDYsRqQCsvpbsLMAVMUqZEdu2/L4gQX1NWoJOKz2Gbc/GgmExG2fJ8F5lX9IETrABlq3IoUuZbkefCLAwFyVpIaZzwIyLEA7gbImQWe1pm16HtmB6pGdJAcuYvhiCcl/IIh5nrSn5TPNSAvaMTcgAVgN7KmKluhpzI3Id2Ht0GBToLwDRnBMlOCnBLO6Uq96FYiyPgP6qvgr00ApczFYPxL06i4lpvZJSqTW6I5Oe6cnHhAeRxXMPp6HFb7X78GlmpMyX/ZZDkkqzuBL+eztqbvdMG6OJWQzsNziw4Lb1Kb1awzBCKtqS8m1VidoQwnGfAxKObVH1qIoVGScPdLJ+Hz53u3cHS2/MZ7bYUd3JNjfqdT489PppwqiIjYNWAU/nSnRs0VklTmRzR93Uw5r2S8Zu2GKgxakO3aIAcv1kF+/jSaFUCD0LglvFhvpx04UtjSFXXsb8LzKN0vbtjGc7pB9Tu09BVb57sSOvKZ4J8lBNyy2b2+ZTscmGkm/dTVuuAVp9nkLHQaTkQO0e0XjX/kA4RmextcS48O5yac7GUhS4gLdLHBeiSNVVhQth9blN3eyI1HsguP38Nu29B0laAWr1VfTCZ6y5KnM6n0poNn0WzgCuxFDB8gSsyNFt90NRESWZbbliW/B1v4xfSSsgi92qeeER6Kb9KwpyWUZtgl129D8yGKIur2yjDSu43acQb4yJPMCSKoHh1JtEQAx8LXDXzqLWW5h+2ueIYMQ+OGkiW+WkIS/qOO/M41oPSDAAF22bF87d+e8HpLQCtAL7MSLruO1TMHlWZ9BA8aq0VAsSugYjEXhiIjCkXFdkPxABTYozIYl3LGAQ3hrJNsjS8+qkmplplFbNwOsqwYtkD1buK2nKszmHXjk2tU0+WI1esvcBNdoX1Nkn8u/YYhcWxErSiaWytEiShw1ldFt1XJ3IKdaiGvMP6OII75UAVyiLCDeDEN6zBtZbOUKlVRcBqlXJE2NxXzEVQE/cb0y517z6ZSDMyKt4BwiuAzAkbKBThFHCeUmr8m+sfyDpJKaMbJYQMm9Hudxfr/gNgesN3Mli5F/1lfswoGj//GgZP0ZZTmLI78m2SySjxUiVA/YN0mqgqm7UDgKgm2zWFzL9bQfVJDGj1Y1zPaLcd+QVgyUR6peZ9BJxsiR3hY4dtezmBYQGbVwSqBauPTvYaAdE9A3ilxFw1oJ/yglfG5WnePLP4JOq0wgWHEZ76gTUX28pYuCmj96at8mV91GUbZ0q1kgewnY+/bO4RLjvSD793VX+Ia5VajouPfstPquVwxToXNRU4Iw6zq65U2JMlR4WGcA3/2WvRPCQB+PxvIW6J5sbovs0iMZVRRSrXQGx1CqGVZIRLn+ss0tYb4D1tw5DHv9E0yklkhdYaGFDR6GXpJoIyBbumQBJThdJZlR0rVbSyoVvdZnyba0qO9bPh2oSnnnqET9vx/8XkEZS2brbiiAu9l5XbPfdJheVIyLyC5NFVrwUWxBDJL/gedBhZlJ1qGO2muovsCbodZO7PaNqEyQjmDDq+/65aWL0OZOSoRTkrUucuCMOLhVtfZxlFC/AVgzZuaiT9cUIVU6JxXskF1Umf74SJE9px4sFEnp14LZhOTIR+OVq6jyTTZe/Q/+e2L+vIkYxLVtafqr+3riLBlOvXOSP3V6PR5/Udj6U8mzzyTnbA3/JdoEcT7JRXjvXaR9mNV/6oRwZR3Y/dYL/Di7BvsjM/ik1eckn0Qb74nXm/RrfpFmp2GSjPMw4VFNE4YgJabDCSGusrAd7jiLwHIcCymqoBrMsHrrPnJDKzQ6CB8KkZWSrkveXKoiUoXf/lHb3+O5e+qsi11xK5pByW+R2lHvWYWjafJ/BnGOA3vTf2cl8oohnh3s2DhrlgPpV0OoFlFLcgzdO52pgAKjL0vswNHF953VZHtluoMrYkDvOjqEvmF76OY9stD/rWxnxWuRupuff5LeKwJinEJvrDpVNjr5iPF1QzgntK3VjKZ2j9WVxWPeSk6Pv5/EPWhl/nzXrSeL2XV9T1hc0mC9HqwW9WBgy75VguSNvnmaJ4W14NARzxxVPYNEK597Kx7zeoIVRcK8zE9MueL0poypJg=="
                }
            }
        }, { parent: this });

        const dbCert = serving.base.createBackendCertificate(`${name}-db`, {
            namespace: this.namespace,
            secretLabels: {
                'cnpg.io/reload': 'true',
            },
        }, { parent: this });

        const db = new crds.postgresql.v1.Cluster(`${name}-db`, {
            spec: {
                description: "Database for Immich",
                instances: 2,
                storage: {
                    storageClass: storageClass,
                    size: '5Gi',
                },
                bootstrap: {
                    initdb: {
                        database: dbname,
                        owner: dbname,
                    },
                },
                backup: {
                    barmanObjectStore: {
                        destinationPath: "gs://immich-postgresql-backup",
                        googleCredentials: {
                            applicationCredentials: gcsSecret.asSecretKeyRef('gcs_credentials'),
                        },
                        wal: {
                            compression: 'snappy',
                            encryption: 'AES256',
                        }
                    },
                    retentionPolicy: "90d",
                },
                certificates: {
                    serverCASecret: dbCert.secretName,
                    serverTLSSecret: dbCert.secretName,
                },
                monitoring: { enablePodMonitor: true },
            },
        }, { parent: this });

        const dbbackup = new crds.postgresql.v1.ScheduledBackup('db-backup', {
            spec: {
                schedule: '@weekly',
                backupOwnerReference: 'self',
                cluster: {
                    name: pulumi.all([db.metadata.name]).apply(([dbcluster_name]) => dbcluster_name!),
                },
            }
        });
        return db;
    }

    // create a redis instance, and then create an ExternalName service, so it has a stable url to refer to in the
    // secret
    private setupRedis(name: string, metadataStorageClass: pulumi.Input<string>, secret: SealedSecret): Redis {
        return new Redis(`${name}-redis`, {
            namespace: this.namespace,
            persistentStorageClass: metadataStorageClass,
            password: secret.asSecretKeyRef('redis_pass'),
            size: "8Gi",
        }, { parent: this });
    }

    private setupFrontendService(name: string, serving: Serving, host: pulumi.Input<string>) {
        serving.createFrontendService(name, {
            host: host,
            targetService: this.chart!.service(/proxy/),
            // Immich will itself connect to Authelia using OpenID Connect
            enableAuth: false,
        });
    }
}

