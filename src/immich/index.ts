import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as crds from "#src/crds";
import * as kx from "@pulumi/kubernetesx";

import { NamespaceProbe, HelmChart, SealedSecret, ConfigMap } from "#src/utils";
import { BaseCluster } from '#src/base-cluster';
import { Redis } from '#src/redis';
import { Serving } from '#src/serving';
import { versions } from "#src/config";

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
            storageClassName: args.storageClass,
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
                    redis_pass: "AgAqC5v0EFkO2vHj9Xjhv7d8klOhDC1M9UXNrHhROeVRJQPWYlkHCvnwgRo3zblMajBtk4rvR8fC5nKpfg9kSSW1KEmov0t5av9lhli1H4YnfWgkxHBzb8Vk1EVQ462bmoQX0j3hat7j4PY3BCOsdJsoFcHbbfEHeHJr7TFBwQ+qZMJ2QYtwHhE0b/R8Dl/FVwnY2+SzrxirIh+FrejscDAzxg+LGXea0G/31edJQFk8AwxbU7n84RWHSHlbtqX/UTHEFiXIkISuN0ePumWiUKDLb5xW4KVE92YJf1fPKkK1NVwkXrxCHXIHv88hX+eXleu3Lnm3Qt23Z7tW/hDvrSJ4P3sxZ/99e9JmBeh3yddyAZgcyBGng6W0fzu7BffrIiKw6m1f1aVHiw1dQsKAoatGKvY2TXG/ORMpQzMs5Y/BlPxFWV2tovR/OPDOmV/6NzgtdJkuoTXWDcR4eT2IsolR5e4lpub3tye7M1E4hfcsEN67quS64HoqCsPzCEa0tC/t+ILjfKhlk4kgTaSEmwRtbCvjlqe9TJYoyh9axYUxbNZvwSlSoIB4NJZBPkPmSoUjIiBJpme5GLb1z8+dWk+IkaYOiih/THlPOU1mHndxMJyn4m3T/hQ9RK6oZMlcPapG1PWheU3DIMPPzwvjTGLxvINAf2UpSLgSF8Pj3EdlxiHntjYFdmhKmcMS7PS948vj5Wg2TaXdeC6VAFBjyN8m2kWrxc24epJq+edpUfjKcQ=="
                }
            }
        }, {
            parent: this
        });
        const redis = this.setupRedis(name, args.cacheStorageClass, secret);

        // Now the real immich chart
        this.chart = new HelmChart(name, {
            namespace: this.namespace,
            chart: "immich",
            values: {
                image: {
                    tag: versions.image.immich.split(':', 2)[1],
                },
                immich: {
                    persistence: {
                        library: {
                            existingClaim: this.libraryPVC.metadata.name,
                        }
                    }
                },
                env: {
                    'REDIS_HOSTNAME': pulumi.output(redis.masterService).apply(s => s.internalEndpoint()),
                    'REDIS_PORT': pulumi.output(redis.masterService).apply(s => s.port()),
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
                },
                server: {
                    resources: {
                        requests: { cpu: "1", memory: "480Mi" },
                        limits: { cpu: "1", memory: "640Mi" },
                    },
                    probes: {
                        liveness: {
                            spec: {
                                initialDelaySeconds: 120,
                            },
                        },
                        readiness: {
                            spec: {
                                initialDelaySeconds: 120,
                            },
                        },
                    },
                    affinity: {
                        podAffinity: {
                            // This is a hack to run the pod on the same node as juicefs
                            // redis master, because otherwise the metadata server
                            // performance is very bad.
                            requiredDuringSchedulingIgnoredDuringExecution: [
                                {
                                    topologyKey: 'kubernetes.io/hostname',
                                    labelSelector: {
                                        matchLabels: {
                                            'app.kubernetes.io/instance': 'juicefs-redis',
                                            'app.kubernetes.io/component': 'master',
                                        }
                                    },
                                    namespaces: ['kube-system']
                                }
                            ]
                        },
                    },
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
                        library: {
                            mountPropagation: "HostToContainer",
                        }
                    },
                },
                // this section is no used since microservices is merged in
                // server
                microservices: {
                    resources: {
                        requests: { cpu: "1", memory: "1Gi", 'gpu.intel.com/i915': '1' },
                        limits: { cpu: "2", memory: "2Gi", 'gpu.intel.com/i915': '1' },
                    },
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
                        library: {
                            mountPropagation: "HostToContainer",
                        }
                    },
                },
                'machine-learning': {
                    // To make all running on vps for minimum juicefs access latency and stability
                    resources: {
                        requests: { cpu: "10m", memory: "384Mi" },
                        limits: { cpu: "1", memory: "384Mi"  },
                    },
                    // Not working yet since the pod has local path storage
                    /*
                    affinity: {
                        podAffinity: {
                            // This is a hack to run the pod on the same node as juicefs
                            // redis master, because otherwise the metadata server
                            // performance is very bad.
                            requiredDuringSchedulingIgnoredDuringExecution: [
                                {
                                    topologyKey: 'kubernetes.io/hostname',
                                    labelSelector: {
                                        matchLabels: {
                                            'app.kubernetes.io/instance': 'juicefs-redis',
                                            'app.kubernetes.io/component': 'master',
                                        }
                                    },
                                    namespaces: ['kube-system']
                                }
                            ]
                        },
                    },
                    */
                    /*
                    // Large requirements for running on homelab
                    resources: {
                        requests: { cpu: "1", memory: "1Gi", 'gpu.intel.com/i915': '1' },
                        limits: { cpu: "2", memory: "2Gi", 'gpu.intel.com/i915': '1' },
                    },
                    */
                    persistence: {
                        library: {
                            enable: false,
                        },
                        cache: {
                            type: '', // empty defaults to PVC
                            accessMode: 'ReadWriteOnce',
                            storageClass: args.cacheStorageClass,
                        }
                    }
                },
            }
        }, { parent: this });

        this.setupFrontendService(name, args.serving, args.host);
    }

    private setupDatabase(name: string, dbname: string, serving: Serving, storageClass: pulumi.Input<string>): crds.postgresql.v1.Cluster {
        const gcsSecret = new SealedSecret(`${name}-db`, {
            spec: {
                encryptedData: {
                    gcs_credentials: "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"
                },
                template: {
                    metadata: {
                        labels: {
                            "cnpg.io/reload": "true",
                        },
                    },
                }
            }
        }, { parent: this });
        const superuserSecret = new SealedSecret(`${name}-db-superuser`, {
            spec: {
                encryptedData: {
                    username: "AgCFaps4K3zp+vjAtbdedRalojRgddhiu6tlX4oaCzRibKjXwxU6z6h6kzK2IZUGnAH7dZ1i8Y2UM5yBF8xwCN1w1Y6qTVvZhG9k7n7L0ln/0qU1CKcO2N5Cds4t112JyfNukJr8n4Je2qT/cchlzQLEq7BwSlVSbYtloQ0hh9nJcaGbqCqYTW5Nky/UjO0qKbYXr7iM2HijvOd/NZ2zhV9xkMiC2csseIaV7wOTRrVzhO2M+STWh9ndFFW0qWsVifxpXY1yUfGx0MVsXjIQ8bFOqmKMTcl0gc/MkKMXzLsJcYaScjOUqdW27fqmGtnrUEEMKVw7551RVY78F/df2QOFAmQisBfm4wfoKCKgCPxAvufPJpHw0s+fro1bO3foEljOUcrxtnsqCMLUaY2P9BOhnfEERfN9hI1Uo7uOQuV26N/vTkyuizF9dg1zd9HvZ+4YD9B22pf34iaEq/isz1PfsjI0YTLIhOxcqR7ewQi6PAaZTPe+eNNg2HXoNMoZTYVwi92W++fLHxO07Kh31nvR6Y62mKCs95zehEDXCnB11XKhZO47gDTAFFuzSQMCzb/GIAuNT9YjAVOuXfvpz7iGsXS+yL9ydlyRHRc/pq1oQAnc41CYreoHsVY5cBvyQfESw2uKuQYp2buD9IXtk3D+LFSMAEqYhxugMPEPm9w2T6Ge8RNvfmOxOaceIoMDfboFiDTNn16sKQ==",
                    password: "AgBF4EJEuaRNeaUWSpDP5fxp9b/Wol5z5LS+1Cyh0qYQ1333Zy4VdIlSxy94RiVumHq4Bw1qXrnLx3KDry+ip83gkqE5ErIZzFOjM/rCoiGESLvm4r8J6ZtEx8xp6jCuzFcSAPgkxBxvNXRBsuE9Op1PJXwgRnLrG7SwVxbVyu48zYlmjzbC2Rqhj59CGzvNO4HvA8lKVrlzUtwNjRGu4mYkd1WW0qi6tEq/MnxshUu54QXh3xMzzyZze8/oLWLHHZLE60eYVOim0V4J1q6ivG+7PU5tmBsmGk5gRW2yclRoTKpIrzUHWNRU7ls6NOBtVVQkilEQAQ7wozIH7e+keOvAn2HnKGc/OP8UglO8p6IAwZ0VaqBGzyZqb93jI+Crdx79exrNdiQn/pgkSIveTPoZJxOquMqDgKNsrBdwrRO75P6BoMupVcf5pYKLhtg3bEoJPszrlZjv6ppWB0VUhtDWFAAB6GCvVu07G2cYAV5fW1L8473p/j9EemRE5YCxL0F6Gw+vzit09bsVO1fO3CPXhbZZcqL046oLZnqt46kgTiYmoG33Rs/0OxlLjxsamkh5wmbgsWiW4aColXEVH4xHWh1/RWyAMH65Y+4AME3V3ZG8HzAPcXBM+GFl0/h37QRCgGLc75WG9XiQ1eGnDxGvs92RGqmHb2S/rfsQUNPkyZZrD3WwvNYh/GU/pNhlk7T0NsErsoLYa4CRrL8H91cpM1DDkLR+E6KL/L1rskzicaJrZsn1FRJh"
                },
                template: {
                    metadata: {
                        labels: {
                            "cnpg.io/reload": "true",
                        },
                    },
                    type: 'kubernetes.io/basic-auth',
                }
            }
        }, {
            parent: this
        });

        const dbCert = serving.base.createBackendCertificate(`${name}-db`, {
            namespace: this.namespace,
            secretLabels: {
                'cnpg.io/reload': 'true',
            },
        }, { parent: this });

        const catalog = new crds.postgresql.v1.ImageCatalog(`${name}-db-images`, {
            spec: {
                images: [
                    {
                        major: 15,
                        image: "ghcr.io/aetf/vchord-cnpg:15.13-1-0.3.0",
                    },
                ]
            }
        }, { parent: this })

        const db = new crds.postgresql.v1.Cluster(`${name}-db`, {
            spec: {
                description: "Database for Immich",
                instances: 2,
                resources: {
                    requests: {
                        memory: "1Gi",
                        cpu: "500m",
                    },
                    limits: {
                        memory: "1Gi",
                        cpu: "800m",
                    },
                },
                storage: {
                    storageClass: storageClass,
                    size: '5Gi',
                },
                imageCatalogRef: {
                    apiGroup: "postgresql.cnpg.io",
                    kind: "ImageCatalog",
                    name: catalog.metadata.name,
                    major: 15,
                },
                // Install pgvecto.rs extension. The extension is built as a
                // custom image.
                postgresql: {
                    shared_preload_libraries: ["vectors", "vchord.so"],
                },
                enableSuperuserAccess: true,
                superuserSecret: superuserSecret.asSecretRef(),
                bootstrap: {
                    initdb: {
                        database: dbname,
                        owner: dbname,
                        postInitTemplateSQL: [
                            "CREATE EXTENSION vectors;",
                            "CREATE EXTENSION vchord;",
                            "CREATE EXTENSION cube;",
                            "CREATE EXTENSION earthdistance;",
                            `GRANT USAGE ON SCHEMA vectors TO ${dbname};`,
                            "GRANT SELECT ON TABLE pg_vector_index_stat TO PUBLIC;",
                        ],
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
                monitoring: { enablePodMonitor: false },
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
        }, { parent: this });
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
            resources: {
                requests: { cpu: "50m", memory: "48Mi" },
                limits: { cpu: "50m", memory: "64Mi" },
            },
        }, { parent: this });
    }

    private setupFrontendService(name: string, serving: Serving, host: pulumi.Input<string>) {
        serving.createFrontendService(name, {
            host,
            targetService: this.chart!.service(/server/),
            // Immich doesn't support TLS on its own.
            enableTls: false,
            // Immich will itself connect to Authelia using OpenID Connect
            enableAuth: false,
        });
    }
}

