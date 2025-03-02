import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from '#src/base-cluster';
import { SealedSecret, ConfigMap, HelmChart } from "#src/utils";

interface McArgs {
    base: BaseCluster,
}

export class Mc extends pulumi.ComponentResource<McArgs> {
    public readonly chart?: HelmChart;
    private readonly namespace: pulumi.Output<string>;

    constructor(name: string, args: McArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Mc', name, args, opts);

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    "rcon-password": "AgB5NxhtrEgDg2gziGt9yEhhrA0ZyLceztTQjV5LPpwIy9ldkjMABVIQ4vvx4i9kqhwWC0+ujG6JN2ChqQqWhAacP2G6Q/tybEWIsjrp0/rH/IXZNpNgMQNQTn22I2ApiXPRsPoDORfHqLxUnjHaIK+v0W0+cfJcc8GEH+owVuEwn9QvGvwZFSRtqCJXnBJHPsVbdDQRHT3qWpN4aIogmWTg8+DHyInezJ7e6eWM586b91np20sb1PjuuQp2mDIvoNWAY3ZxEbBCgGzt7rMvqUWhAwGxpShxTqMN7I8jfjIxLxcznbQTDjMzvjrE9Rd1FJh99slD9I0P4hM9XHTz/eo2U4X/zPuNHgVxQ+Z1T/J7sBsrbQy09ZoMkLPVhwFzzGHMZS1kHglZshDd1pSn3rwrZscm/8NB1hESgkwLUumIrfPo/bo+rmOuMdZA22v8PKBXORq6yRgTCcA1UUaTTqKfLpgVQ4cTvKPKOZuEzytEJax/eNmpybDjtGtfi2vEG0f/jTx5CB+PkOYW4JnCmhW15+GbJSh8a1Nj9xeoAKOI0wQ5zHWCdDeeMkftcUOfa1fWRvwdkmd6gxaIuS6pWXEWM0/yP7jqch4/BZYkM9SQZec4taA2FtB3ZU3fjpzFuPEjwmNmsPMoKVvYFVMcSOHc9Ji3NF4Y/JWmsZuPS9IItapxrc9txyrbCFcjX5BddfQFI5sSYIDvK8KI",
                    "discord-bot-token": "AgAaMKhN8zZ/YNjcycduJWXDW3bebF7djm+Puc7cYNfHRvcvDE+/g3hnEQrfyYo4gjYIJID1LYH5EeNKtthX8u7KSxlBtuJ4hbOnQjyr/R+gwjkpMs6HwrikzjxCAp/A0WeovLeTI1ONByqzVlsQqHxMur+9gzwZSwxcFLyyeAzMt/JZdDPBU5haXGJRuYdn+b+bLQaXP3j6/2PgO/pR0WUjmsP2ioN0Cggd2lza9o9rAPwbK4Cavi+tl6m/2t8z3111uhTNIr0COmX0//NydlD6nIP6xeFxD+icGDlWg7KwYVes2Boe42RzEouKyyUZ4tvQeNS8qIEJpZw+MxSO7BmGEFat3dtqJGUU1JS4ZrTANMxX5qSocxzjdbGkv6y513O57jk3f5dIPaXcVZHJSl73kNN1gvuzZlSeoMSpTWwKO7iG5HgBPfPxrXt97WyFxo7HNQXWXcfnvLex+3FfXSTO5INk10wGCZRuTxX4SXjDcSBz/rOJ6QkHza+vjGWbE251yN7UBIVhmDoGOieFItcLrulhiAyw2ug3PGI0SeyRciNl8690WY8fIVZ0YD0TyJxXl1HzY+ouK9mryV4x2g79i6KziNrnjTshRZ9UeekjpWglkXXnIl5HR5DhaW9fya1OSR2KuaBKsOHIyCOJOxHfzaLmSh0i8BjdY6klXiPLBtJWmhEYd3fGL4wky1l198o6wiFNiGgudFxn5mbbv7QfZaLQx5lDMcadrWQ4M/twjNieF8Y0PsImjSrSDyS0w5kLI81alJhxJA1UC1w1ixaAL1JKQCXhwQo=",
                }
            }
        }, { parent: this });
        const rcloneSecret = new SealedSecret(`${name}-rclone`, {
            spec: {
                encryptedData: {
                    "rclone.conf": "AgCFc+18AaMXgJF0ghbqKO9nR0JOknFdyZz23lzMYdb/TOoPJrfq4FJgkoMah9+KmtjeeJraQ5jRJv5f75vIw+lPMqEbCgUSE8jadxE5TsjxSV6rFdIYD+8/zHeAfn7nGMtuyeFJizglJmVT8DJq+XcP9N8avN1o+y6T4OFBRAQixsbyGxBlMhGDmKgmQcjT87aMQJayAaboy1JbUzDybPtjan2l04kyUztp2v6wdqi3qQkcETNq04R591epzM6RXzhL2Nw/Zj2jrOJJp9zTbCh5kUxEQT5afG747yA9pAZ2QSQjwYCuTrNCUtxBohfbm/sKMVgE+mcEu+dEqCTWdXtZjr5sLcuG6RketepFMz9o6rYt5imUBYRjZHpPpumDvUjgpm+sqD8z0eZ7ppL3tCP/zOZnr1WDDC/ZySC3fuvJiu3ziQcsgqJUF7l7t5ZPNZWDhnqlOKM7FlScB0k8Y2M/Icn0hr6OMQQxzskiNNI/pTc41uLOmGJ1dbdpclBhFAQyy6bQC1WyKNvHlMSntv9iD9JP/qpWxvJTvkl9E7jFlnh04ZDl7NCixe26r0d6DKrZaDWnYiNXm7w2cx8mguIyL0js4CX26qo2NakeKyk411BPKblkgpQJCs0ZIRQbfgmucfjUP/GxJgkWKmWqk3u0iwK9oPDPb+aC9r+tXix3hNlR9L8sFT8OoOSn0ZkuYTZMmtY1oVHWh3uBim3JQ8g3taqfejejQlAO7Bq5ehKr/5nPzfchJ+CnVdcKc9Z9RCg/0P540T8s01zoCd3gzFZIFLpxezODPXQwRib+8/YjeYhuMLbGeupGW+n40j8bv6cVRByA5S8/9AFcQYvnjPoYAwKZgVjkUkM/nJbZ/5XFEo599uGztUTtupm8IHVjb5B57QjA7y3ZZlX2lpM/mVIEYjbOjQN/9MZf8Zm42bdbzrvKx4Ax+DBsmdzhjggsRE9yWV5LoGZG6MdyEBdK9TJV2CM0wFzIW/G9xwbX4M6rBsq7jkpiZVhMaGqS4VDcUfdrEsAnu7moBA==",
                }
            }
        }, { parent: this });

        const configCm = new ConfigMap(name, {
            ref_file: __filename,
            data: 'static/config/*',
            stripComponents: 2,
        }, { parent: this });

        const pvc = args.base.createLocalStoragePVC(name, {
            storageClassName: args.base.localStableStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "12Gi"
                }
            }
        }, { parent: this, retainOnDelete: true, protect: true });

        const backupPvc = args.base.createLocalStoragePVC(`${name}-backup`, {
            storageClassName: args.base.jfsStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "50Gi"
                }
            }
        }, { parent: this, retainOnDelete: false, protect: false });

        this.namespace = pvc.metadata.namespace;
        this.chart = new HelmChart(name, {
            namespace: this.namespace,
            chart: "minecraft",
            fetchOpts: {
                repo: "https://itzg.github.io/minecraft-server-charts/",
            },
            values: {
                resources: {
                    limits: {
                        memory: "12Gi",
                        cpu: "2",
                    },
                    requests: {
                        memory: "8Gi",
                        cpu: "2",
                    }
                },
                nodeSelector: {
                    "kubernetes.io/hostname": "aetf-arch-homelab"
                },
                podAnnotations: {
                    'kubectl.kubernetes.io/default-container': `${name}-minecraft`
                },
                serviceLabels: {
                    // Note select a pool, so all nodes will host the service
                    // 'svccontroller.k3s.cattle.io/lbpool': 'internet',
                },
                rconServiceLabels: {
                    // Only lan has this service
                    'svccontroller.k3s.cattle.io/lbpool': 'homelan',
                },
                minecraftServer: {
                    eula: "TRUE",
                    version: "1.20.1",
                    type: "FABRIC",
                    // Let JVM calculate heap size from the container declared
                    // memory limit
                    memory: "",
                    jvmXXOpts: "-XX:MaxRAMPercentage=75",
                    difficulty: 'hard',
                    whitelist: [
                        // ChenGao
                        '41cd7633-510b-4771-9434-bc4260390a59',
                        // Aetf
                        'b3c4aeb8-083a-434e-b89a-b6794431dfe1',
                    ].join(','),
                    ops: [
                        // ChenGao
                        '41cd7633-510b-4771-9434-bc4260390a59',
                        // Aetf
                        'b3c4aeb8-083a-434e-b89a-b6794431dfe1',
                    ].join(','),
                    rcon: {
                        enabled: true,
                        existingSecret: secrets.metadata.name,
                        serviceType: "LoadBalancer",
                    },
                    serviceType: "LoadBalancer",
                    extraPorts: [
                        {
                            name: "dynmap",
                            containerPort: "8123",
                            protocol: "TCP",
                            service: {
                                enabled: false,
                            },
                            ingress: {
                                enabled: false,
                            },
                        }
                    ],
                },
                extraVolumes: [
                    {
                        volumes: [
                            {
                                name: 'config',
                                configMap: {
                                    name: configCm.metadata.name,
                                }
                            },
                            {
                                name: 'discord-bot-token',
                                secret: {
                                    secretName: secrets.metadata.name,
                                    items: [
                                        {
                                            key: 'discord-bot-token',
                                            path: 'discord-bot-token',
                                        }
                                    ]
                                }
                            }
                        ],
                        volumeMounts: [
                            {
                                name: 'config',
                                mountPath: '/config',
                                readOnly: true,
                            },
                            {
                                name: 'discord-bot-token',
                                mountPath: '/secrets',
                                readOnly: true,
                            }
                        ]
                    }
                ],
                extraEnv: {
                    'PACKWIZ_URL': 'https://aetf.github.io/fabric-science/pack.toml',
                    'ENABLE_WHITELIST': 'TRUE',
                    'ENFORCE_WHITELIST': 'TRUE',
                    'OVERRIDE_WHITELIST': 'TRUE',
                    'SYNC_SKIP_NEWER_IN_DESTINATION': 'false',
                    'CFG_DISCORD_BOT_TOKEN_FILE': '/secrets/discord-bot-token',
                    // 'DEBUG': 'true'
                },
                persistence: {
                    "dataDir": {
                        "enabled": true,
                        "existingClaim": pvc.metadata.name,
                    }
                },
                mcbackup: {
                    enabled: true,
                    pauseIfNoPlayers: "true",
                    compressMethod: "zstd",
                    rcloneRemote: "fabric-science-mc-backup:rclone-fabric-science-mc",
                    rcloneDestDir: "/",
                    rcloneCompressMethod: "zstd",
                    rcloneConfigExistingSecret: rcloneSecret.metadata.name,
                }
            }
        }, { parent: this });
    }
}
