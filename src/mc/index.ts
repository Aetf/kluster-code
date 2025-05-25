import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from '#src/base-cluster';
import { Serving } from '#src/serving';
import { SealedSecret, ConfigMap, HelmChart } from "#src/utils";

interface McArgs {
    base: BaseCluster,
    serving: Serving,
    mapHost: pulumi.Input<string>,
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
                    "discord-bot-token": "AgCU10xQyVkH9FzOZbyELFt98D1PvG5c3aTFInKrTlErHo4c4kBdUf0mSv+VrapKEjcIPFYdjBhDgk340YntNVTwOxHf44GqjadDuKoVEcWaijUe3DlI4bMq+Af35TkD6z0TbRI76+utEoNz+h/wl/mBkiH9T7Ki9xOPIUVe0MuEX61JdAlRYfFEdQ++ZjGDY1EPEqD798ez/4v4NCG3g40PYkxrLFaEfa+51L09cG0AubhPfPP2YXU9WVHK01xt89S7rXvOwdH8fMtAhpESmLxO6Va0iKnJ32mOXTauaXGiYlvs2rOk8NeW4KPycERLi+WKbkwHP2X5EfDhKgjjzsU3i+pHgIv7d8Pr6t98wfVXG6nwBXnonfsXiHMlWF7b5duPYocJUI8prihKfNGNTbrvwfngIe0m+bgGKRaCHbJRlPdP1K1Kh1t3PYiIPY2s063SkjRn9iFaSXYSXrR7+iUjDrYaUS4lr5itvpK1rWBW9s9Ko8Jw3gfPJOwbqq1KUgjztEK35ztzoYPBUOU4kt2GhQKNyCxOBT38jhk7hpgVnXjJEd0FVfiZDvfccT0EKJOEmawwfMDHuLfEEAgCtigAJzaJIkCeCHePDC6pVZOmb9OOp7ABegM2eM77H3oW0tDnQo8bSxRBwg06ItUUq7q1md/Nm0SEcIfGB02hB+FQb2qsi/IENxBu2CAjiyC1N81IkNYyK+avXeiZCMVundqiTihN0Ova1KyprfD1tp1Q6U2GSQ4CatH6rKla7cDLz4m9iwTUZJii3A1Nd0rRjuwc3zPFI3n3Gw4=",
                    "discord-webhook": "AgBGZzB5z5NmhgqqpStgbl8dROCkMp2zgMqn/PkWrJqo8Si9Yh1ooUiBDBMAeHHnY/cEveJAHnwYWjmk13luAAdcbMwiCKZsdBaaad0UvGA34F1lX67cJ7zGgdEgesdzIX2HOn6rzDlHglLsksRxVlb2wEnpVkIstjeLgn9Fc7Lhr5OhAMcAvcDPqOZTuTwtnzzBM2Pn1CzgsNQajjnT/mw+CwroNP0JLlx8Y/4xc2Ez7Gyw3dlKMiwEcnAHsUX41gTUbmbG84YWeFQnb/aSW2bLfx5JjqWm6Q4OjdivW8g7sNLlghxbVS9M30TifefIK6KSycemLP6SyVMtzYP00WlsTJmYlaC+W07Or92xUfrE2U7SHrm371+gO8FCtOjuObvk3nNIgWG4pNkVEdrR7u8Zlng4+TRuTjNn3OHp83lpLjckIhlLW80jthe7Hs9wffWGAR6jB6IkjhLgByRQugLj85pfzA+y4bj6kBVCa7fFWoPuhQvfJBtdn9lcUK5LqOUTOKTd8OV++L1EqLLiohEAl3PBAAOn9+nnYH7hgp6zoP4JJvBRGARgYKw5lm3v5xtH2UICA41g+G02tNRSUBhgnMTMj/2B2qgrFz04wMzfdkHu7KfPwQxdZxgR76UJ8alA4y2iObQYU4UXra4pVAtWEI9Ay7JUbmS2lr/zuBiOugl/kRI8Y5jewtMh/kkvZjwhXCKfLLU1HYC6dZNZGGI16VO4VW/4/AFi1SXTTztaE63i7jQWnXRaJTp9tjXbRMK/r1mOcOuV+CwoBIWVCrIEi3a8C1XLLogVH9pYhAmNug29HV6iui2smnIGU6CMCIM+v95aTEhk+Es+20tYqxiEgHZ9aSx0FlAR",
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

        this.namespace = pvc.metadata.namespace;
        this.chart = new HelmChart(name, {
            namespace: this.namespace,
            chart: "minecraft",
            fetchOpts: {
                repo: "https://itzg.github.io/minecraft-server-charts/",
            },
            values: {
                resources: {
                    requests: { cpu: "8", memory: "20Gi" },
                    limits: { cpu: "9", memory: "21Gi" },
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
                    version: "1.21.1",
                    type: "NEOFORGE",
                    memory: "15G", // also need to change limit
                    jvmXXOpts: "-XX:MaxRAMPercentage=75",
                    difficulty: 'hard',
                    whitelist: [
                        // Aetf
                        '41cd7633-510b-4771-9434-bc4260390a59',
                        // ChenGao
                        'b3c4aeb8-083a-434e-b89a-b6794431dfe1',
                        // gaochen315
                        'd9e4a5aa-5e47-4829-b3cb-a7e11f6eabd0',
                    ].join(','),
                    ops: [
                        // Aetf
                        '41cd7633-510b-4771-9434-bc4260390a59',
                        // ChenGao
                        'b3c4aeb8-083a-434e-b89a-b6794431dfe1',
                        // gaochen315
                        'd9e4a5aa-5e47-4829-b3cb-a7e11f6eabd0',
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
                            containerPort: 8123,
                            protocol: "TCP",
                            service: {
                                enabled: true,
                                // This is a http web only, so put it behind ingress controller
                                type: "ClusterIP",
                                port: 8123
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
                                name: 'discord-bot',
                                secret: {
                                    secretName: secrets.metadata.name,
                                    items: [
                                        {
                                            key: 'discord-bot-token',
                                            path: 'discord-bot-token',
                                        },
                                        {
                                            key: 'discord-webhook',
                                            path: 'discord-webhook',
                                        }
                                    ]
                                }
                            }
                        ],
                        volumeMounts: [
                            {
                                name: 'config',
                                // ConfigMap doesnt allow nested folder
                                mountPath: '/config/simple-discord-link',
                                readOnly: true,
                            },
                            {
                                name: 'discord-bot',
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
                    'CFG_DISCORD_WEBHOOK_FILE': '/secrets/discord-webhook',
                    'USE_AIKAR_FLAGS': 'true',
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

        const dynmapSvc = this.chart.service(/dynmap/);
        args.serving.createFrontendService(name, {
            host: args.mapHost,
            targetService: dynmapSvc,
            targetPort: 'dynmap',
            // Dynmap doesn't support TLS
            enableTls: false,
            // Dynmap is readonly data
            enableAuth: false,
        });
    }
}
