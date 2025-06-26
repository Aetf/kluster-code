import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";
import * as dedent from "dedent";

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
                    "access_key_id": "AgCF8+9702obt++E49dNlQNCz4tfmZQo9sJdYs2TuQ3tZNrxdZBYlJqAUduPw58J8B3e9ddvDLj9W+JP7s89vHIyMjRPmnqf8VCDkB4o75h6Io5AloUI6/5zVJsZr2ijrVDSY1L6PowxGFuqzQfpozGvRJ4h038/JU3tZbM4M4jaHIsMSB7+0vhD+Dh9/k3An6qaFxyckdrZfOEdH1sHnraa/AkLTGhbWsNCYlZ49XCypbT0QKe9fNn8vZiabwyxSTiohQFmVaIz20CaZWGzuUuwQ6QQbSla5RyuLi3+6PI4anMWkcQw7LnlC0lBuDuFaOr5XTCv8FJv+xPhSwfZSy6VN+XNZWM+7zM5ZDX1q5CFTA1OnCLqFi94wFjhgL59y6imbuFyG9tgCARFGfQ9YVWFk9XikC/YMVRxCyTibVMiyXNndI075DvY5o84YG8h7tqK7Fl0ODrLXvxY0krSQqXXW+NMkPMqpcQbCYIPdgTsulYvK87tMSJV+t8GVzRyCJ4oJutcWxvmE8Sl46l/hs4bHa3m0oAiv01h878k/fOVUQ7Hj4t2hXFnnNuTsIocP8Jmv3oLseOguJm4F1miaEW2S7OSLflBYW+YpOEqUyrqHAXCpUIUIB93WScG/S8Rb3HCz7uV/VqARqCOJ3EG40EIhkTnLsh5hPtVPYZVdmUvJ6+KNZVsZ73VcK5iRSab3b6u8y/N6It2/8oWHIeQK87okdR9OIoooyAN+GTHWZySRQEvKaEtAim/BXc/0Qf+5Gq02g3PfPvTmIEnDqkg",
                    "secret_access_key": "AgCxNIJ/85uvJpm6P/AQXrqFLV513EEbOaFCFWCiPR4Je3CCWdnHpN/qloYX2X65VlwPyEfRKbChbcWdwjv0V54CyGcnp0BMwMZ4nLnuPiHyPphOII/T1ZMDrsBJUZZEvisJTwKkYCIDmf16Otyt0ijqDbCvDwNM/jArALVrwmerGVYtcb2VzvGxmxKJts4GQX5OEBpage4a8miHbxdkZJ94G08b9qXNSXUcrInU2GRlZfb9/atGDwT1zLOydJvqd8O05aZ0+45SL+PA+Tv2ioETFZVQPNgL5ozPeWg+LVdyTbrZgmu+V7HdROWhLv/OLyTQb+fsiAvtzQPwJAJ/yNwrOlhgiAXD0xxqChXABvzBgb8u4x3ZPNCj75fAFVBn0cqiCjr7UYeG9SFM1kXIqhB2SmY7b71PV/y/NAoz+1QxHyhNQAs1xVt2D16bmOiGw7NX7JAKPW9QCLYyg4rLdZFj84/BReKTEJqS+9nQkTU4bFacuO+PLrRBb395bJ6uP8LMvPBRdgPMNp0rjYrz/82z75AxOs/kHHiSeXWZcqe1Vd/7Lr1K1sDI+If2TJ14cYOUY7dcw0eFyaTdo60e2/k9cYVW71dImeKx/q7143d+g9tX8EmsFF+xUUSBe0YZBCzsz8MYS5uwM/iyXm3sQOVFcZ+MUXEmq+7BAmohF1NtWwhcJLg8QxI0VauQKdh1paJdSfjqEkQF4fEkUaDrEcW0JcVwCqExtNS/sBkspQg0HzBRL+8zRmiy",
                },
                template: {
                    data: {
                        "rclone.conf": dedent`
                        [fabric-science-mc-backups]
                        type = s3
                        provider = GCS
                        access_key_id = {{ .access_key_id }}
                        secret_access_key = {{ .secret_access_key }}
                        endpoint = https://storage.googleapis.com
                        storage_class = COLDLINE
                        no_check_bucket = true
                        `,
                    },
                },
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
                    backupMethod: "rclone",
                    compressMethod: "zstd",
                    rcloneRemote: "fabric-science-mc-backups",
                    // <bucket-name>/<path>
                    rcloneDestDir: "fabric-science-mc-backups/",
                    rcloneCompressMethod: "zstd",
                    rcloneConfigExistingSecret: rcloneSecret.metadata.name,
                    extraEnv: {
                        RCLONE_PROGRESS: "true",
                    },
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
