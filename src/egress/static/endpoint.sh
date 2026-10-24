#!/bin/sh
# Keep this pod's WireGuard peer pointed at the egress gateway.
#
#   endpoint.sh --wait   return once the tunnel has a handshake (init container)
#   endpoint.sh          keep it that way for the life of the pod (sidecar)
#
# The peer is addressed by the gateway Service's DNS name, and WireGuard
# resolves a name only at the moment it is set. So whenever there is no recent
# handshake the endpoint is set again: before the first one, when cluster DNS
# may not answer yet (it starts with the pod after a node reboot), and after the
# tunnel has gone quiet, whatever the cause. Every failure mode then converges
# the same way, by retrying, instead of needing someone to restart the pod.
set -u

peer={{{gatewayPublicKey}}}
endpoint={{{endpoint}}}
# With a 25 s keepalive there is always traffic, so a live session re-handshakes
# within a keepalive of every 2 minutes; past REJECT_AFTER_TIME (180 s) the
# session can no longer carry data at all.
stale=180

last_handshake() {
    wg show wg0 latest-handshakes | awk -v p="$peer" '$1 == p { print $2 }'
}

state=
while :; do
    last=$(last_handshake)
    if [ "${last:-0}" -gt 0 ] && [ $(( $(date +%s) - last )) -le "$stale" ]; then
        [ "$state" = up ] || echo "tunnel up, last handshake $(( $(date +%s) - last ))s ago"
        state=up
        [ "${1:-}" = --wait ] && exit 0
        sleep 30
        continue
    fi
    [ "$state" = down ] || echo "no recent handshake, (re)setting endpoint $endpoint"
    state=down
    # Setting the keepalive in the same call makes the kernel send one at once,
    # which starts the handshake without waiting for traffic. It also keeps the
    # conntrack entries for this flow alive, so the gateway can still reach us.
    wg set wg0 peer "$peer" endpoint "$endpoint" persistent-keepalive 25 \
        || echo "cannot set endpoint $endpoint yet, retrying"
    sleep 5
done
