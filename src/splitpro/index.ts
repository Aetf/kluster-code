import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { NamespaceProbe, Node, SealedSecret, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";
import * as crds from "#src/crds";
import { versions } from "#src/config";

/** nodeSelector pinning a pod to one specific node. */
function nodeHostname(node: Node): Record<string, pulumi.Output<string>> {
    return { 'kubernetes.io/hostname': pulumi.output(node.metadata).apply(md => md.name!) };
}

/**
 * Opt-in: S3-compatible object storage is *not* used -- SplitPro keeps receipts
 * on a local volume -- so the only optional integrations are these.
 */
export interface SplitproWebPushArgs {
    /** VAPID keypair, from `npx web-push generate-vapid-keys`. */
    secret: SealedSecret,
    /** Contact address embedded in the VAPID claim. */
    contactEmail: pulumi.Input<string>,
}

export interface SplitproPlaidArgs {
    /** Keys `client_id` and `secret`. */
    secret: SealedSecret,
    environment: 'sandbox' | 'development' | 'production',
    /** Comma separated ISO country codes, e.g. `US`. */
    countryCodes: pulumi.Input<string>,
}

export interface SplitproGoCardlessArgs {
    /** Keys `secret_id` and `secret_key`. */
    secret: SealedSecret,
    country: pulumi.Input<string>,
}

interface SplitproArgs {
    serving: Serving,
    host: pulumi.Input<string>,

    domain: pulumi.Input<string>,
    authSubdomain: pulumi.Input<string>,

    dbStorageClass: pulumi.Input<string>,
    uploadStorageClass: pulumi.Input<string>,
    /**
     * NextAuth session secret plus the plaintext side of the Authelia OIDC
     * client. Keys `nextauth_secret`, `oidc_client_id`, `oidc_client_secret`;
     * the client id and secret must match what Authelia is given in
     * serving/authelia-static/01-oidc.yaml.
     */
    authSecret: SealedSecret,
    /** Opt-in: browser push notifications for recurring expenses. */
    webPush?: SplitproWebPushArgs,
    /** Opt-in: bank transaction import. Plaid and GoCardless are alternatives. */
    plaid?: SplitproPlaidArgs,
    goCardless?: SplitproGoCardlessArgs,
    /**
     * Opt-in: paid FX rate provider. Without it the keyless `frankfurter`
     * provider is used, which is enough for occasional multi-currency expenses.
     */
    openExchangeRates?: SealedSecret,
}

/**
 * SplitPro, a self-hosted Splitwise alternative.
 *
 * Unlike most apps here it is not behind the Authelia forward-auth middleware:
 * it has real accounts and group membership of its own, and talks to Authelia
 * over OIDC, the same way immich and jellyfin do.
 */
export class Splitpro extends pulumi.ComponentResource<SplitproArgs> {
    public readonly port: pulumi.Output<number>;
    public readonly address: pulumi.Output<string>;

    private readonly namespace: pulumi.Output<string>;

    constructor(name: string, args: SplitproArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Splitpro', name, args, opts);

        this.port = pulumi.output(3000);
        this.namespace = new NamespaceProbe(`${name}-probe`, { parent: this }).namespace;

        const dbname = 'app';
        const db = this.setupDatabase(name, dbname, args.serving, args.dbStorageClass);
        // CNPG generates this alongside the cluster; its `uri` key is a ready
        // made connection string, which beats assembling one out of the
        // individual keys and having to worry about escaping the password.
        const dbSecret = pulumi.interpolate`${db.metadata.name}-${dbname}`;

        const uploadsPv = args.serving.base.createLocalStoragePVC(`${name}-uploads`, {
            storageClassName: args.uploadStorageClass,
            resources: {
                requests: {
                    storage: "5Gi"
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            // Don't leak every service in the namespace into the env; SplitPro
            // validates its whole env with zod at boot.
            enableServiceLinks: false,
            containers: [{
                name,
                image: versions.image.splitpro,
                resources: {
                    requests: { cpu: "50m", memory: "384Mi" },
                    limits: { memory: "768Mi" },
                },
                ports: {
                    http: this.port,
                },
                env: {
                    // Next's standalone server binds loopback unless told otherwise,
                    // which would make the Service unreachable.
                    'HOSTNAME': '0.0.0.0',
                    'PORT': pulumi.interpolate`${this.port}`,

                    'DATABASE_URL': { secretKeyRef: { name: dbSecret, key: 'uri' } },

                    'NEXTAUTH_URL': pulumi.interpolate`https://${args.host}`,
                    'NEXTAUTH_SECRET': args.authSecret.asEnvValue('nextauth_secret'),

                    // The callback path is derived from the lowercased OIDC_NAME,
                    // so this has to match the redirect_uri registered in
                    // serving/authelia-static/01-oidc.yaml.
                    'OIDC_NAME': 'authelia',
                    'OIDC_CLIENT_ID': args.authSecret.asEnvValue('oidc_client_id'),
                    'OIDC_CLIENT_SECRET': args.authSecret.asEnvValue('oidc_client_secret'),
                    'OIDC_WELL_KNOWN_URL': pulumi.interpolate`https://${args.authSubdomain}.${args.domain}/.well-known/openid-configuration`,

                    // Authelia is the only way in, and deliberately the *only*
                    // way: no EMAIL_SERVER_HOST means NextAuth never registers
                    // the magic-link provider, so it neither appears on the
                    // sign-in page nor exists as a second, weaker path. That
                    // matters because DISABLE_EMAIL_SIGNUP only blocks *new*
                    // accounts -- an existing user could otherwise sign in by
                    // email and skip Authelia's policy and group checks
                    // entirely.
                    //
                    // Invites go off with it: they email a signup link, which
                    // is useless here since the recipient still cannot get past
                    // Authelia until they are added to a group there. Leaving
                    // them enabled would just put a button in the UI whose
                    // backend has no mail server to talk to.
                    //
                    // DISABLE_EMAIL_SIGNUP is kept as a backstop in case SMTP
                    // is ever wired back up for invites.
                    //
                    // INVITE_ONLY is deliberately NOT set. Upstream's adapter
                    // throws unconditionally on createUser when it is on, with
                    // no exception for the first account -- so on an empty
                    // database nobody can ever log in, and a restore into a
                    // fresh database would come back up locked out.
                    'DISABLE_EMAIL_SIGNUP': 'true',
                    'ENABLE_SENDING_INVITES': 'false',

                    // The default `/home` is a marketing blog page.
                    'DEFAULT_HOMEPAGE': '/balances',
                    'CURRENCY_RATE_PROVIDER': 'frankfurter',
                    // pg_cron cleans up cached FX rates and bank data.
                    'CLEAR_CACHE_CRON_RULE': '0 2 * * 0',
                    'CACHE_RETENTION_INTERVAL': '2 days',

                    ...this.optionalEnv(args),
                },
                volumeMounts: [
                    {
                        name: uploadsPv.metadata.name,
                        // Receipts are written to `$PWD/uploads`, and the image's
                        // workdir is /app.
                        mountPath: "/app/uploads",
                    },
                ],
                // Migrations run in-process on boot (src/instrumentation.ts), so
                // the first start after an upgrade can take a while.
                startupProbe: {
                    httpGet: { path: "/", port: "http" },
                    periodSeconds: 2,
                    failureThreshold: 60,
                },
                readinessProbe: {
                    httpGet: { path: "/", port: "http" },
                },
            }],
            volumes: [
                {
                    name: uploadsPv.metadata.name,
                    persistentVolumeClaim: {
                        claimName: uploadsPv.metadata.name,
                    },
                },
            ],
            // Both PVCs are node-local with a Retain policy, so wherever the pod
            // first lands is where the data lives for good. Pin it to the
            // homelab: the VPS is the tight node (57% cpu / 53% memory
            // requested, against 7% / 15% here) and it has nothing this app
            // needs.
            nodeSelector: nodeHostname(args.serving.base.nodes.AetfArchHomelab),
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/search": "true"
                }
            },
            spec: {
                ...pb.asDeploymentSpec(),
                replicas: 1,
                // Both the in-process migration runner and the RWO uploads volume
                // break if a second pod overlaps with the old one.
                strategy: { type: 'Recreate' },
            },
        }, { parent: this });

        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            },
        });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            // Next.js does not serve TLS itself.
            enableMTls: false,
            // SplitPro authenticates against Authelia over OIDC on its own, so it
            // must NOT sit behind the forward-auth middleware -- that would put a
            // second login in front of its own and break the OIDC callback.
            enableAuth: false,
        });

        this.address = pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`;
    }

    /**
     * Env for the opt-in integrations. Everything here is `optional()` in
     * SplitPro's zod schema with no cross-field validation, so leaving a group
     * out is how it stays switched off.
     */
    private optionalEnv(args: SplitproArgs): Record<string, any> {
        return {
            ...args.webPush ? {
                'WEB_PUSH_EMAIL': args.webPush.contactEmail,
                'WEB_PUSH_PUBLIC_KEY': args.webPush.secret.asEnvValue('public_key'),
                'WEB_PUSH_PRIVATE_KEY': args.webPush.secret.asEnvValue('private_key'),
            } : {},
            ...args.plaid ? {
                'PLAID_CLIENT_ID': args.plaid.secret.asEnvValue('client_id'),
                'PLAID_SECRET': args.plaid.secret.asEnvValue('secret'),
                'PLAID_ENVIRONMENT': args.plaid.environment,
                'PLAID_COUNTRY_CODES': args.plaid.countryCodes,
            } : {},
            ...args.goCardless ? {
                'GOCARDLESS_SECRET_ID': args.goCardless.secret.asEnvValue('secret_id'),
                'GOCARDLESS_SECRET_KEY': args.goCardless.secret.asEnvValue('secret_key'),
                'GOCARDLESS_COUNTRY': args.goCardless.country,
            } : {},
            ...args.openExchangeRates ? {
                'CURRENCY_RATE_PROVIDER': 'openexchangerates',
                'OPEN_EXCHANGE_RATES_APP_ID': args.openExchangeRates.asEnvValue('app_id'),
            } : {},
        };
    }

    private setupDatabase(
        name: string,
        dbname: string,
        serving: Serving,
        storageClass: pulumi.Input<string>,
    ): crds.postgresql.v1.Cluster {
        const gcsSecret = new SealedSecret(`${name}-db`, {
            spec: {
                encryptedData: {
                    gcs_credentials: "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",
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

        const dbCert = serving.base.createBackendCertificate(`${name}-db`, {
            namespace: this.namespace,
            secretLabels: {
                'cnpg.io/reload': 'true',
            },
        }, { parent: this });

        const objectStore = new crds.barmancloud.v1.ObjectStore(`${name}-db-backup`, {
            spec: {
                configuration: {
                    destinationPath: "gs://splitpro-postgresql-backup",
                    googleCredentials: {
                        applicationCredentials: gcsSecret.asSecretKeyRef('gcs_credentials'),
                    },
                    wal: {
                        compression: 'snappy',
                        encryption: 'AES256',
                    },
                },
                retentionPolicy: "90d",
            }
        }, { parent: this });

        const db = new crds.postgresql.v1.Cluster(`${name}-db`, {
            spec: {
                description: "Database for SplitPro",
                instances: 1,
                resources: {
                    requests: {
                        memory: "256Mi",
                        cpu: "100m",
                    },
                    limits: {
                        memory: "512Mi",
                    },
                },
                storage: {
                    storageClass: storageClass,
                    size: '2Gi',
                },
                // Same reasoning as the app pod: node-local storage with a
                // Retain policy, so it has to be pinned, and the homelab is the
                // node with room.
                affinity: {
                    nodeSelector: nodeHostname(serving.base.nodes.AetfArchHomelab),
                },
                imageName: versions.image.splitproDb,
                postgresql: {
                    shared_preload_libraries: ["pg_cron"],
                    parameters: {
                        // pg_cron installs into exactly one database, and it has
                        // to be the app's: SplitPro puts a foreign key from
                        // ExpenseRecurrence onto cron.job.
                        'cron.database_name': dbname,
                        'cron.timezone': 'UTC',
                    },
                },
                bootstrap: {
                    initdb: {
                        database: dbname,
                        owner: dbname,
                        // Runs as superuser in the application database. Creating
                        // the extension here means SplitPro's own migration, which
                        // runs as the unprivileged owner, finds it already there
                        // and its `CREATE EXTENSION IF NOT EXISTS` is a no-op --
                        // so the app never needs superuser.
                        //
                        // USAGE on the schema alone is not enough: the migration's
                        // foreign key onto cron.job needs REFERENCES on the table.
                        postInitApplicationSQL: [
                            "CREATE EXTENSION IF NOT EXISTS pg_cron;",
                            `GRANT USAGE ON SCHEMA cron TO ${dbname};`,
                            `GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON cron.job TO ${dbname};`,
                            `GRANT SELECT, DELETE ON cron.job_run_details TO ${dbname};`,
                        ],
                    },
                },
                plugins: [{
                    name: "barman-cloud.cloudnative-pg.io",
                    isWALArchiver: true,
                    parameters: {
                        barmanObjectName: pulumi.all([objectStore.metadata]).apply(([md]) => md.name!),
                    },
                }],
                certificates: {
                    serverCASecret: dbCert.secretName,
                    serverTLSSecret: dbCert.secretName,
                },
                monitoring: { enablePodMonitor: false },
            },
        }, { parent: this });

        new crds.postgresql.v1.ScheduledBackup(`${name}-db-backup`, {
            spec: {
                schedule: '@weekly',
                backupOwnerReference: 'self',
                method: 'plugin',
                pluginConfiguration: {
                    name: "barman-cloud.cloudnative-pg.io",
                },
                cluster: {
                    name: pulumi.all([db.metadata]).apply(([md]) => md.name!),
                },
            }
        }, { parent: this });

        return db;
    }
}
