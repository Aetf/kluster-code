# kluster-code Pulumi state backend

A lightweight PostgreSQL container that holds this project's Pulumi state (DIY
`postgres://` backend). It replaces the old local file backend so the stack can
be driven from any host on the LAN / ZeroTier and from GitHub CI (the
`.github/workflows/` jobs reach this backend over ZeroTier — see the
"Continuous deployment" section of the top-level `README.md`).

It is a **bootstrap dependency**: Pulumi needs it running to do anything, so it
is *not* managed by Pulumi. It runs directly on the homelab host via Podman,
defined here so `kluster-code` stays self-contained and reproducible.

## Bootstrap (fresh host)

```sh
mise run state-db:up      # runs state-db:init (generates .env, certs,
                          # ../../.pulumi.backend) then `podman compose up -d`
```

Then use Pulumi as usual — `mise x -- pulumi ...`. The backend URL is supplied
automatically by mise from `.pulumi.backend`.

Tasks: `state-db:init` (idempotent secrets/certs), `state-db:up`, `state-db:down`.

## What lives where

| Path | Committed? | Purpose |
|------|-----------|---------|
| `compose.yaml` | yes | container definition (source of truth) |
| `init.sh` | yes | idempotent generator for the secrets below |
| `.env` | no (git-ignored) | `POSTGRES_*` incl. random password |
| `certs/` | no (git-ignored) | self-signed TLS server cert/key |
| `../../.pulumi.backend` | no (git-ignored) | `postgres://…?sslmode=require` URL for mise |

## Network exposure

The container binds `5432` **only** to the LAN (`192.168.80.238`) and ZeroTier
(`10.144.180.10`) addresses — never `0.0.0.0` — so it is unreachable from any
other interface. The homelab currently runs **no host packet filter**
(nftables/firewalld/ufw inactive); network segmentation is enforced upstream at
the UDM-SE / VLAN level.

If you want to restrict *which* LAN VLANs can reach `5432` (defense-in-depth),
add a rule at the UDM-SE, or introduce a host nftables rule via **aconfmgr**
allowing tcp/5432 only from `192.168.80.0/24` and `10.144.0.0/16`. This is host
system state, managed out-of-band, not from this repo.

## TLS

Self-signed cert; clients connect with `sslmode=require` (encrypt, don't verify).
The cert/key are owned by the container's `postgres` uid so PG can read the key
under rootless podman. To rotate: `rm certs/server.*` and re-run `state-db:init`.

## Backup

State is durable in the `pulumi_state_data` volume. Back it up with
`pg_dump pulumi_state` on the homelab backup rotation. Losing it means
re-importing state from a `pulumi stack export`.
