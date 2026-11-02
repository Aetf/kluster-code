import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { ConfigMap, SealedSecret } from "#src/utils";
import { Redis } from '#src/redis';
import { versions } from "#src/config";

/**
 * Workaround for porsager/postgres#1195, which leaks immich job slots.
 *
 * kysely-postgres-js reserves a pool connection for every query. When a
 * connection closes while a reservation is queued behind it, postgres.js 3.x
 * drops that reservation and its promise never settles: the job awaiting it
 * holds its queue slot forever, and BullMQ keeps renewing the job's lock, so
 * its stalled check never reclaims it either. Slots leak one at a time until a
 * queue stops, while the web UI and API stay healthy. Only a restart releases
 * them. immich-app/immich#32502 was closed as this upstream bug.
 *
 * This layer has two parts, and both go once immich ships postgres.js >= 4,
 * the first release with the fix:
 *  - `serverEnv`, merged into the server's environment, removes the
 *    client-side trigger: postgres.js reads `PG<OPTION>` from the environment
 *    for every option immich does not set itself, and a `max_lifetime` of 0
 *    turns off recycling connections (immich already leaves `idle_timeout`
 *    off). Server-side closes -- a cnpg restart or switchover, the WireGuard
 *    link between the server and the database dropping -- still trigger it.
 *  - The watchdog CronJob restarts the server when an active job has held its
 *    lock for longer than any legitimate job runs, and tells Alertmanager it
 *    did so.
 *
 * The watchdog is also the tripwire for its own removal: once the image it
 * runs -- the server's own -- ships postgres.js >= 4, it stops restarting
 * anything and fails, which KubeJobFailed reports, with removal instructions
 * in its log. From then on ImmichJobQueueStuck in index.ts is what shows
 * whether the upstream fix holds. Removing this layer means deleting this
 * file, static/job-slot-watchdog/, and every use of `jobSlotWatchdog` in
 * index.ts.
 */
export const serverEnv = {
    PGMAX_LIFETIME: '0',
};

interface ImmichJobSlotWatchdogArgs {
    // the immich chart's release name
    release: string,
    redis: Redis,
    // holds the redis password under `redis_pass`
    secret: SealedSecret,
}

export class ImmichJobSlotWatchdog extends pulumi.ComponentResource {
    constructor(name: string, args: ImmichJobSlotWatchdogArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:ImmichJobSlotWatchdog', name, {}, opts);

        // The labels the chart puts on the server pod.
        const serverLabels = {
            'app.kubernetes.io/instance': args.release,
            'app.kubernetes.io/name': 'server',
        };

        const cm = new ConfigMap(name, {
            ref_file: __filename,
            data: 'static/job-slot-watchdog/*',
            stripComponents: 2,
        }, { parent: this });

        const sa = new k8s.core.v1.ServiceAccount(name, {}, { parent: this });
        const role = new k8s.rbac.v1.Role(name, {
            rules: [{
                apiGroups: [""],
                resources: ["pods"],
                verbs: ["list", "delete"],
            }],
        }, { parent: this });
        new k8s.rbac.v1.RoleBinding(name, {
            roleRef: {
                apiGroup: "rbac.authorization.k8s.io",
                kind: "Role",
                name: role.metadata.name,
            },
            subjects: [{
                kind: "ServiceAccount",
                name: sa.metadata.name,
                namespace: sa.metadata.namespace,
            }],
        }, { parent: this });

        const pb = new kx.PodBuilder({
            serviceAccountName: sa.metadata.name,
            restartPolicy: 'Never',
            // The server image is large; run where it is already pulled.
            affinity: {
                podAffinity: {
                    requiredDuringSchedulingIgnoredDuringExecution: [{
                        labelSelector: { matchLabels: serverLabels },
                        topologyKey: 'kubernetes.io/hostname',
                    }],
                },
            },
            containers: [{
                name: 'watchdog',
                image: versions.image.immich,
                command: ['node', '/watchdog/watchdog.mjs'],
                env: {
                    NAMESPACE: {
                        fieldRef: { fieldPath: "metadata.namespace" },
                    },
                    SERVER_SELECTOR: Object.entries(serverLabels).map(([k, v]) => `${k}=${v}`).join(','),
                    REDIS_HOSTNAME: pulumi.output(args.redis.masterService).apply(s => s.internalEndpoint()),
                    REDIS_PORT: pulumi.output(args.redis.masterService).apply(s => s.port()).apply(p => `${p}`),
                    REDIS_PASSWORD: args.secret.asEnvValue('redis_pass'),
                    QUEUE_PREFIX: 'immich_bull',
                    // 12h: the longest any queue stayed continuously busy over
                    // the 90 days before 2026-11-01, leaks aside, was 4.2h, and
                    // several never stayed busy for 15 minutes. A leaked
                    // slot otherwise lasts days, so the margin costs nothing.
                    MAX_JOB_AGE_SECONDS: `${12 * 3600}`,
                    FIXED_POSTGRES_MAJOR: '4',
                    ALERTMANAGER_URL: 'http://prometheus-alertmanager.mon:9093',
                },
                resources: {
                    requests: { cpu: '50m', memory: '128Mi' },
                    limits: { memory: '256Mi' },
                },
                volumeMounts: [cm.mount('/watchdog')],
            }],
        });
        new k8s.batch.v1.CronJob(name, {
            spec: {
                schedule: '*/10 * * * *',
                concurrencyPolicy: 'Forbid',
                failedJobsHistoryLimit: 1,
                successfulJobsHistoryLimit: 1,
                jobTemplate: {
                    spec: pb.asJobSpec({
                        backoffLimit: 0,
                        activeDeadlineSeconds: 300,
                    }),
                },
            },
        }, { parent: this });
    }
}
