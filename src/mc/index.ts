import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from '#src/base-cluster';
import { SealedSecret, ConfigMap, HelmChart } from "#src/utils";

interface McArgs {
    base: BaseCluster,
    externalIPs: string[],
}

export class Mc extends pulumi.ComponentResource<McArgs> {
    public readonly chart: HelmChart;
    private readonly namespace: pulumi.Output<string>;

    constructor(name: string, args: McArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Mc', name, args, opts);

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    "rcon-password": "AgB5NxhtrEgDg2gziGt9yEhhrA0ZyLceztTQjV5LPpwIy9ldkjMABVIQ4vvx4i9kqhwWC0+ujG6JN2ChqQqWhAacP2G6Q/tybEWIsjrp0/rH/IXZNpNgMQNQTn22I2ApiXPRsPoDORfHqLxUnjHaIK+v0W0+cfJcc8GEH+owVuEwn9QvGvwZFSRtqCJXnBJHPsVbdDQRHT3qWpN4aIogmWTg8+DHyInezJ7e6eWM586b91np20sb1PjuuQp2mDIvoNWAY3ZxEbBCgGzt7rMvqUWhAwGxpShxTqMN7I8jfjIxLxcznbQTDjMzvjrE9Rd1FJh99slD9I0P4hM9XHTz/eo2U4X/zPuNHgVxQ+Z1T/J7sBsrbQy09ZoMkLPVhwFzzGHMZS1kHglZshDd1pSn3rwrZscm/8NB1hESgkwLUumIrfPo/bo+rmOuMdZA22v8PKBXORq6yRgTCcA1UUaTTqKfLpgVQ4cTvKPKOZuEzytEJax/eNmpybDjtGtfi2vEG0f/jTx5CB+PkOYW4JnCmhW15+GbJSh8a1Nj9xeoAKOI0wQ5zHWCdDeeMkftcUOfa1fWRvwdkmd6gxaIuS6pWXEWM0/yP7jqch4/BZYkM9SQZec4taA2FtB3ZU3fjpzFuPEjwmNmsPMoKVvYFVMcSOHc9Ji3NF4Y/JWmsZuPS9IItapxrc9txyrbCFcjX5BddfQFI5sSYIDvK8KI",
                    "discord-bot-token": "AgBRxkXMuHvJUPHtOBP4lOzHhWsvvMDi5+cCiG/Id2WMHQv5YZDV7qjjZUK2idgvOiuf0U16qvtfPx3cbw+b56zRwfoY6HIfOkr9GfC+bfDENH9XriMY3hsmWA1ymvylJoCpNMTbUUWioVd5Z84hRmXY/IQFJqRuaPY8FUW8fR3GRfojU9vMZ3kMr/J9/klKDF5Rc7HpzccqrP8HwVUsAhHW+P92ya2FOzVIsmmW7oox+5wCRi64/OScqCDoUzDOjBfYopjOAyHqFQI/kw11BT5YoEz2hRp92oQd8YOGVtjHj+XS/W4uDDfbei8QdcPQjCs88NVqiOnKTUsCLlfqp4f17q0cRspYNy/TKX9xjgYETl7VgeHJYxREdyb8T1z57Mc1tDsF68+PHXtHRSkt1oC6lDsbjEWa97aM1KTySDjkc+dnSc+qUPss6Iys5mn3V/mS4yM9p6EA8DLCKP/KXAf6O1aYqxgRWWzWSSnYT9lEj1yNFwg3e4OMQRExtbyeAtGGQ47uESISdEOJXVr+FLE2MDsl9RgloGr1kiBPOYris3G4QawlPnI+fAFkFRG0Ak+OeeCPG69dEH//xyrz3Nvs1ZKAGnCUvMl/sVsDDxLiOCanf7gJXnx/Hv2JfbAUXP2LjEg1bZz67JlomUr48xqkp1MdBi4nE1Bwmq2cRCSKwmf5qfbpdTXx3IBL6F37XQzKU3O57hZkoQEajfiyChtYp4JAN/zusl8GZUxBBxWK+xh0c/9bubpQe6ajf9TnUASAWihKInfsklYVco7OKnes5E7Kp+3cDy8=",
                }
            }
        }, { parent: this });

        const configCm = new ConfigMap(name, {
            base: __dirname,
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
        }, { parent: this, });

        const backupPvc = args.base.createLocalStoragePVC(`${name}-backup`, {
            storageClassName: args.base.jfsStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "50Gi"
                }
            }
        }, { parent: this });

        this.namespace = pvc.metadata.namespace;
        this.chart = new HelmChart(name, {
            namespace: this.namespace,
            chart: "minecraft",
            version: "4.2.0",
            fetchOpts: {
                repo: "https://itzg.github.io/minecraft-server-charts/",
            },
            values: {
                resources: {
                    requests: {
                        memory: "8Gi",
                        cpu: "2",
                    }
                },
                nodeSelector: {
                    "kubernetes.io/hostname": "aetf-arch-homelab"
                },
                minecraftServer: {
                    eula: "TRUE",
                    version: "1.19.2",
                    type: "FABRIC",
                    // Let JVM calculate heap size from the container declared
                    // memory limit
                    memory: "",
                    jvmXXOpts: "-XX:MaxRAMPercentage=75",
                    ops: [
                        // ChenGao
                        '41cd7633-510b-4771-9434-bc4260390a59',
                        // Aetf
                        'b3c4aeb8-083a-434e-b89a-b6794431dfe1',
                        // for the Discord integration bot
                        '8d8982a5-8cf9-4604-8feb-3dd5ee1f83a3',
                    ],
                    rcon: {
                        "enabled": true,
                        "existingSecret": secrets.metadata.name,
                    },
                    externalIPs: args.externalIPs,
                    extraPorts: [
                        {
                            "name": "dynmap",
                            "containerPort": "8123",
                            "protocol": "TCP",
                            "service": {
                                "enabled": false,
                            },
                            "ingress": {
                                "enabled": false,
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
                            },
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
                    'CFG_DISCORD_BOT_TOKEN_FILE': '/secrets/discord-bot-token',
                    // 'CFG_DISCORD_BOT_TOKEN': 'false',
                    'ENABLE_WHITELIST': 'FALSE',
                    'ENFORCE_WHITELIST': 'FALSE',
                    'SYNC_SKIP_NEWER_IN_DESTINATION': 'false',
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
                    persistence: {
                        backupDir: {
                            enabled: true,
                            "existingClaim": backupPvc.metadata.name,
                        }
                    }
                }
            }
        }, { parent: this });
    }
}
