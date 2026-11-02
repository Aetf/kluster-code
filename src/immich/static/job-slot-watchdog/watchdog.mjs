// Restarts the immich server when its microservices worker holds a job slot
// it will never release. Runs inside the immich-server image so it can read
// the server's own dependency versions and reuse its redis client. See
// src/immich/job-slot-watchdog.ts for why this exists and when to delete it.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import https from 'node:https';

const require = createRequire('/usr/src/app/server/package.json');
const Redis = require('ioredis');

const env = (key) => {
    const value = process.env[key];
    if (!value) {
        throw new Error(`${key} is not set`);
    }
    return value;
};

const NAMESPACE = env('NAMESPACE');
const SERVER_SELECTOR = env('SERVER_SELECTOR');
const ALERTMANAGER_URL = env('ALERTMANAGER_URL');
const MAX_JOB_AGE_SECONDS = Number(env('MAX_JOB_AGE_SECONDS'));
const FIXED_POSTGRES_MAJOR = Number(env('FIXED_POSTGRES_MAJOR'));
const PREFIX = env('QUEUE_PREFIX');

function checkStillNeeded() {
    // read directly: the package's `exports` map hides its package.json
    const { version } = JSON.parse(readFileSync('/usr/src/app/server/node_modules/postgres/package.json', 'utf-8'));
    console.log(`immich ships postgres.js ${version}`);
    if (Number(version.split('.')[0]) >= FIXED_POSTGRES_MAJOR) {
        console.error(
            `postgres.js ${version} carries the fix for porsager/postgres#1195, so this ` +
            'watchdog is obsolete. It no longer restarts anything: a slot that still leaks ' +
            'now has a different cause, and ImmichJobQueueStuck is what reports it. Delete ' +
            'src/immich/job-slot-watchdog.ts, its static files and every use of ' +
            'jobSlotWatchdog in src/immich/index.ts.');
        process.exit(1);
    }
}

/**
 * Active jobs that started more than MAX_JOB_AGE_SECONDS ago and whose BullMQ
 * lock is still held. The live lock is what tells a leaked slot apart from a
 * job orphaned by a worker that already died: BullMQ's stalled check returns
 * the latter to `wait` once its lock expires, so it needs no restart.
 */
async function findStuckJobs(redis) {
    const now = Date.now();
    const stuck = [];
    let checked = 0;
    for await (const keys of redis.scanStream({ match: `${PREFIX}:*:active`, type: 'list' })) {
        for (const key of keys) {
            const queue = key.slice(PREFIX.length + 1, -':active'.length);
            for (const id of await redis.lrange(key, 0, -1)) {
                checked++;
                const [name, processedOn] = await redis.hmget(`${PREFIX}:${queue}:${id}`, 'name', 'processedOn');
                const ageSeconds = (now - Number(processedOn)) / 1000;
                if (!processedOn || ageSeconds <= MAX_JOB_AGE_SECONDS) {
                    continue;
                }
                if (await redis.exists(`${PREFIX}:${queue}:${id}:lock`)) {
                    stuck.push({ queue, id, name, since: new Date(Number(processedOn)).toISOString() });
                }
            }
        }
    }
    console.log(`checked ${checked} active job(s), ${stuck.length} stuck past ${MAX_JOB_AGE_SECONDS}s`);
    return stuck;
}

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';

function kube(method, path) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            host: env('KUBERNETES_SERVICE_HOST'),
            port: env('KUBERNETES_SERVICE_PORT'),
            path,
            method,
            ca: readFileSync(`${SA}/ca.crt`),
            headers: { Authorization: `Bearer ${readFileSync(`${SA}/token`, 'utf-8')}` },
        }, res => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => res.statusCode < 300
                ? resolve(JSON.parse(body))
                : reject(new Error(`${method} ${path}: ${res.statusCode} ${body}`)));
        });
        req.on('error', reject);
        req.end();
    });
}

async function restartServer() {
    const pods = await kube('GET',
        `/api/v1/namespaces/${NAMESPACE}/pods?labelSelector=${encodeURIComponent(SERVER_SELECTOR)}`);
    const names = pods.items.map(p => p.metadata.name);
    for (const name of names) {
        console.log(`deleting pod ${name}; its ReplicaSet recreates it`);
        await kube('DELETE', `/api/v1/namespaces/${NAMESPACE}/pods/${name}`);
    }
    return names;
}

async function notify(stuck, pods) {
    const jobs = stuck.map(j => `${j.queue}/${j.name} (job ${j.id}, running since ${j.since})`).join('; ');
    console.log(`notifying alertmanager about ${jobs}`);
    const res = await fetch(`${ALERTMANAGER_URL}/api/v2/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([{
            labels: { alertname: 'ImmichJobSlotLeakRestarted', namespace: NAMESPACE, severity: 'warning' },
            annotations: {
                summary: 'Restarted immich-server to release leaked job slots',
                description: `The worker held job slots it will never release (porsager/postgres#1195): ${jobs}. ` +
                    `Deleted ${pods.join(', ')}; the queues resume once the new pod is up.`,
            },
            endsAt: new Date(Date.now() + 3600_000).toISOString(),
        }]),
    });
    if (!res.ok) {
        throw new Error(`alertmanager: ${res.status} ${await res.text()}`);
    }
}

checkStillNeeded();
const redis = new Redis({
    host: env('REDIS_HOSTNAME'),
    port: Number(env('REDIS_PORT')),
    password: env('REDIS_PASSWORD'),
});
try {
    console.log('scanning immich job queues for leaked slots');
    const stuck = await findStuckJobs(redis);
    if (stuck.length > 0) {
        const pods = await restartServer();
        await notify(stuck, pods);
    }
} finally {
    redis.disconnect();
}
