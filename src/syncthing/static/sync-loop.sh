#!/bin/sh
# Event-driven rclone bisync loop between {{ filePrefix }}/Stuff and gdrive:Stuff.
#
# Replaces the old every-minute CronJob:
#  - long-polls syncthing's events API, so any change on the syncthing side
#    (local scan or item synced from another device) triggers a run within
#    seconds (debounced);
#  - the long-poll timeout doubles as the fallback cadence, so gdrive-side
#    changes still land without any event;
#  - a single long-lived loop can never overlap itself, and stale/corrupt
#    lock files from crashed runs (0-byte locks defeat --max-lock recovery,
#    see the 2026-05..07 stuck-lock incident) are cleaned before each run.
#
# Requires: STGUIAPIKEY in the environment (shared with the syncthing
# container), rclone config at /config/rclone.conf.
set -u

ST_URL="https://127.0.0.1:{{ ports.gui }}"
LOCAL="{{ filePrefix }}/Stuff"
REMOTE="gdrive:Stuff"
WORKDIR="$LOCAL/.rclone-bisync-workdir"
EVENTS="ItemFinished,LocalIndexUpdated"
DEBOUNCE_SECS=5
FALLBACK_SECS=90

api() {
    wget -q --no-check-certificate -T $((FALLBACK_SECS + 30)) -O- \
        --header "X-API-Key: $STGUIAPIKEY" "$ST_URL$1" 2>/dev/null
}

latest_event_id() {
    grep -o '"id"[[:space:]]*:[[:space:]]*[0-9][0-9]*' | grep -o '[0-9]*$' | sort -n | tail -n1
}

clean_stale_locks() {
    # rclone --max-lock cannot recover from truncated lock files left behind
    # by crashed runs: a 0-byte lock parses as zero-value session info and
    # fails hard instead of expiring
    find "$WORKDIR" -maxdepth 1 -name '*.lck' -size -1c -delete 2>/dev/null
    find "$WORKDIR" -maxdepth 1 -name '*.lck' -mmin +5 -delete 2>/dev/null
}

run_bisync() {
    clean_stale_locks
    rclone bisync "$LOCAL" "$REMOTE" \
        --config /config/rclone.conf \
        --check-access \
        --check-filename stignore.txt \
        --create-empty-src-dirs \
        --compare size,modtime,checksum \
        --slow-hash-sync-only \
        -Mv \
        --fix-case \
        --resilient \
        --recover \
        --max-lock 2m \
        --conflict-resolve newer \
        --workdir "$WORKDIR" \
        --filters-file "$WORKDIR/rclone-filters.txt"
}

echo "sync-loop: waiting for syncthing API..."
until api /rest/noauth/health | grep -q '"OK"'; do sleep 2; done
echo "sync-loop: syncthing is up, starting"

last_id=0
run_bisync || echo "sync-loop: initial bisync failed (rc=$?)"
while :; do
    # blocks until an event arrives or FALLBACK_SECS elapse
    new_id=$(api "/rest/events?since=$last_id&timeout=$FALLBACK_SECS&events=$EVENTS" | latest_event_id)
    [ -n "${new_id:-}" ] && last_id=$new_id
    # let bursts settle, then drain whatever queued meanwhile
    sleep $DEBOUNCE_SECS
    new_id=$(api "/rest/events?since=$last_id&timeout=1&events=$EVENTS" | latest_event_id)
    [ -n "${new_id:-}" ] && last_id=$new_id
    run_bisync || echo "sync-loop: bisync failed (rc=$?), retrying next cycle"
done
