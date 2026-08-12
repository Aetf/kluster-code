#!/bin/sh
# Point this pod's default route at the egress gateway, so its outbound traffic
# leaves from the gateway node's public IP instead of its own node's.
#
# Runs as an init container: kernel WireGuard needs no daemon, so once the link
# is configured it lives as long as the pod's network namespace does.
#
# Only the default route moves. These three keep going out eth0, and getting
# them wrong is how this breaks:
#   - pod CIDR:     inbound replies. klipper-lb masquerades, so the peer we
#                   answer is the svclb pod, not the real client -- those
#                   replies must not enter the tunnel or they'd never get back.
#   - service CIDR: cluster DNS and every ClusterIP. The CNI installs only the
#                   pod CIDR plus a default route, so without this line the
#                   tunnel swallows DNS.
#   - underlay:     carries the WireGuard endpoint itself. Circular otherwise.
set -eu

gw=$(ip -4 route show default | awk '{ print $3; exit }')
uplink=$(ip -4 route show default | awk '{ print $5; exit }')
[ -n "$gw" ] && [ -n "$uplink" ] || {
    echo "no default route to anchor the cluster prefixes on" >&2
    exit 1
}

for cidr in {{{podCidr}}} {{{serviceCidr}}} {{{underlayCidr}}}; do
    ip route replace "$cidr" via "$gw" dev "$uplink"
done

ip link add wg0 type wireguard

umask 077
conf=$(mktemp)
cat > "$conf" <<EOF
[Interface]
PrivateKey = $(cat {{{clientKeyPath}}})

[Peer]
PublicKey = {{{gatewayPublicKey}}}
Endpoint = {{{endpoint}}}
AllowedIPs = 0.0.0.0/0
# Keeps the conntrack entry for our outbound handshake alive, so the gateway
# can still reach us after it has been restarted or rescheduled.
PersistentKeepalive = 25
EOF
wg setconf wg0 "$conf"
rm -f "$conf"

ip address add {{{clientAddress}}}/{{{prefixLength}}} dev wg0
ip link set wg0 mtu {{{mtu}}} up

# Fail closed, in two senses. With `set -e` a pod that cannot get this far never
# starts; and dropping the node-local default leaves nothing to silently fall
# back to should wg0 ever disappear. Going out of the local node's address is
# the exact bug being fixed here, so no route at all beats the wrong source
# address -- and a stalled hath is much easier to notice than a quietly
# mis-addressed one.
ip route replace default dev wg0
ip route del default via "$gw" dev "$uplink"
