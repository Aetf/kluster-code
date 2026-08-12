#!/bin/sh
# WireGuard endpoint for the egress gateway.
#
# Everything arriving over the tunnel is NATed out of this pod's uplink. It
# is pinned to the gateway node, and flannel already masquerades pod traffic to
# that node's default-route source address, so packets surface on the internet
# with the node's public IP. That second SNAT is the whole trick: it is why
# neither this pod nor either host needs root or a host-level rule.
set -eu

# Re-runnable: a restarted container comes back to a namespace it has already
# configured, and every step below would otherwise fail on its own leftovers.
ip link del wg0 2>/dev/null || true
ensure() {
    table=$1 chain=$2
    shift 2
    iptables -t "$table" -C "$chain" "$@" 2>/dev/null \
        || iptables -t "$table" -A "$chain" "$@"
}

uplink=$(ip -4 route show default | awk '{ print $5; exit }')
[ -n "$uplink" ] || { echo "no default route to NAT out of" >&2; exit 1; }

ip link add wg0 type wireguard

umask 077
conf=$(mktemp)
cat > "$conf" <<EOF
[Interface]
PrivateKey = $(cat {{{gatewayKeyPath}}})
ListenPort = {{{port}}}

[Peer]
PublicKey = {{{clientPublicKey}}}
AllowedIPs = {{{clientAddress}}}/32
EOF
wg setconf wg0 "$conf"
rm -f "$conf"

ip address add {{{gatewayAddress}}}/{{{prefixLength}}} dev wg0
ip link set wg0 mtu {{{mtu}}} up

ensure nat POSTROUTING -s {{{tunnelSubnet}}} -o "$uplink" -j MASQUERADE
# The tunnel MTU is well under the uplink's, but the leg past this pod is a
# plain 1500 internet path. Clamp forwarded SYNs so we don't depend on PMTUD
# surviving a peer that blackholes ICMP.
ensure mangle FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

exec sleep infinity
