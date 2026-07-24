# CNPG backup restore drill (immich database)

## Why this exists

The immich Postgres cluster (`immich-db-*`, namespace `immich`) backs up weekly to
`gs://immich-postgresql-backup` via CNPG's `barmanObjectStore` + continuous WAL
archiving. A green `ScheduledBackup` and `Working WAL archiving: OK` only prove that
backups are being *written* — they do **not** prove the backups are *restorable*
(corruption, a lost encryption key, or a missing extension would all pass the
"backup ran" check but fail an actual recovery).

CNPG ships no "verify backup" command; the only trustworthy verification is a real
recovery. This drill periodically recovers the database from the object store into a
throwaway cluster, verifies the data, and tears it down.

## What runs automatically

Defined in `src/immich/index.ts` → `setupRestoreDrill()`:

- **CronJob** `immich-db-restore-drill` — monthly (`0 4 1 * *`, 1st @ 04:00). Runs
  `src/immich/static/restore-drill/drill.sh` in an `alpine/k8s` (kubectl) container.
- **ConfigMap** `immich-restore-drill` — holds the rendered recovery `Cluster`
  manifest (`cluster.yaml`) and `drill.sh`.
- **ServiceAccount/Role/RoleBinding** `immich-restore-drill` — lets the Job
  create/delete `clusters.postgresql.cnpg.io` + PVCs and `exec` psql into the pod.
- **PrometheusRule** `immich-restore-drill` — alerts `ImmichDbRestoreDrillFailed`
  (a drill Job failed) and `ImmichDbRestoreDrillStale` (no success in 45d), via the
  existing Alertmanager.

The drill script: pre-cleans any leftover → `kubectl apply` the recovery cluster
`immich-db-restore` (1 instance, `bootstrap.recovery` from `externalClusters`
pointing at the source's barman `serverName`, **no `.spec.backup`**) → waits up to
20m for `condition=Ready` → verifies via `psql` on the recovered primary:
`pg_is_in_recovery()=f`, `select count(*) from asset > 0`, and the `vchord`/`vector`
extensions present → always tears down the cluster + PVCs via an `EXIT` trap.

## Run it manually

```sh
# trigger one drill immediately from the CronJob
kubectl create job -n immich --from=cronjob/immich-db-restore-drill \
  restore-drill-manual-$(date +%s)

# follow it
kubectl logs -n immich -f job/restore-drill-manual-<ts>
```

A passing run ends with `>>> RESTORE DRILL PASSED (recovered N assets)` and Job
`Complete`. A failing run prints a `FAIL:` line and exits non-zero (Job `Failed`).

## Interpreting / troubleshooting

- **Watch progress:** `kubectl get cluster immich-db-restore -n immich -w` (phase
  goes through recovery → "Cluster in healthy state").
- **`vchord`/`vector` extension missing or pod won't start:** the recovery image
  must match the source (`imageCatalogRef` → `ghcr.io/aetf/vchord-cnpg`) and preload
  `shared_preload_libraries: [vectors, vchord.so]` (the `vectors` here is the
  pgvecto.rs runtime library; the installed DB extensions are `vchord` + `vector`).
  A mismatch is an environment problem, not a bad backup.
- **Stuck not-Ready / WAL fetch errors:** check GCS credentials
  (`immich-db` secret, key `gcs_credentials`) and that the barman `serverName`
  in `cluster.yaml` matches the live source cluster name (`kubectl get cluster -n
  immich`). The name is Pulumi auto-suffixed and injected via `tplVariables`.
- **Leftover cluster/PVCs after a crash:** the next run's pre-clean handles it, or
  manually: `kubectl delete cluster immich-db-restore -n immich` then
  `kubectl delete pvc -n immich -l cnpg.io/cluster=immich-db-restore`.
- **Never** give the recovery cluster a `.spec.backup` — it would archive WAL under
  the same `serverName` and corrupt the real backups.

## When to run beyond the monthly schedule

Run an extra manual drill before and after any major change to the DB image
(Postgres major version, vchord/vector version bump) or backup configuration.
