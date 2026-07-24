#!/bin/sh
# CNPG backup restore drill.
#
# Recover the immich database from the GCS barman object store into a
# throwaway cluster, verify the recovered data, then tear everything down.
# Any failure exits non-zero so the Job fails and the PrometheusRule fires.
set -eu

NS="${NAMESPACE:-immich}"
CLUSTER=immich-db-restore
MANIFEST=/manifests/cluster.yaml
DB=app

cleanup() {
    echo ">>> cleanup: deleting ${CLUSTER} and its PVCs"
    kubectl delete cluster "${CLUSTER}" -n "${NS}" --ignore-not-found --wait=false || true
    # CNPG intentionally does NOT garbage-collect PVCs on cluster deletion,
    # so remove them explicitly or the local-path disk fills up over time.
    kubectl delete pvc -n "${NS}" -l "cnpg.io/cluster=${CLUSTER}" --ignore-not-found || true
}
trap cleanup EXIT

echo ">>> pre-clean any leftover from a previous run"
cleanup

echo ">>> creating recovery cluster"
kubectl apply -f "${MANIFEST}"

echo ">>> waiting up to 20m for recovery to complete"
if ! kubectl wait --for=condition=Ready "cluster/${CLUSTER}" -n "${NS}" --timeout=1200s; then
    echo "FAIL: recovery cluster did not become Ready in time"
    kubectl get cluster "${CLUSTER}" -n "${NS}" -o yaml || true
    exit 1
fi

POD=$(kubectl get pods -n "${NS}" -l "cnpg.io/cluster=${CLUSTER},cnpg.io/instanceRole=primary" -o name | head -n1)
if [ -z "${POD}" ]; then
    POD=$(kubectl get pods -n "${NS}" -l "cnpg.io/cluster=${CLUSTER}" -o name | head -n1)
fi
echo ">>> verifying recovered data via ${POD}"

psql_q() {
    kubectl exec -n "${NS}" "${POD}" -c postgres -- \
        psql -U postgres -d "${DB}" -tAc "$1"
}

inrec=$(psql_q "select pg_is_in_recovery()" | tr -d '[:space:]')
count=$(psql_q "select count(*) from asset" | tr -d '[:space:]')
# immich uses VectorChord (vchord) + pgvector (extension name is `vector`).
exts=$(psql_q "select coalesce(string_agg(extname, ','), '') from pg_extension where extname in ('vchord','vector')" | tr -d '[:space:]')

echo ">>> pg_is_in_recovery=${inrec}  asset_count=${count}  extensions=${exts}"

fail=0
[ "${inrec}" = "f" ] || { echo "FAIL: database still in recovery"; fail=1; }
case "${count}" in
    ''|*[!0-9]*) echo "FAIL: asset count not numeric (${count})"; fail=1 ;;
    0)           echo "FAIL: asset table is empty"; fail=1 ;;
esac
echo "${exts}" | grep -qw vchord || { echo "FAIL: vchord extension missing"; fail=1; }
echo "${exts}" | grep -qw vector || { echo "FAIL: vector extension missing"; fail=1; }

if [ "${fail}" -ne 0 ]; then
    echo ">>> RESTORE DRILL FAILED"
    exit 1
fi
echo ">>> RESTORE DRILL PASSED (recovered ${count} assets)"
