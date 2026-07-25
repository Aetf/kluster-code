#!/usr/bin/env bash
# Idempotent bootstrap for the Pulumi state backend Postgres container.
# Generates (only if missing):
#   - deploy/state-backend/.env         POSTGRES_* with a strong random password
#   - deploy/state-backend/certs/*      self-signed TLS server cert/key
#   - <repo>/.pulumi.backend            the postgres:// URL mise feeds to PULUMI_BACKEND_URL
# All three are git-ignored. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="docker.io/library/postgres:17-alpine"
# ZeroTier IP: reachable from the homelab host itself AND from other hosts/CI.
BACKEND_HOST="10.144.180.10"

# 1. .env with a URL-safe random password (A-Za-z0-9 only, no %-encoding needed).
if [[ ! -f .env ]]; then
    pw="$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)"
    ( umask 177; cat > .env <<EOF
POSTGRES_DB=pulumi_state
POSTGRES_USER=pulumi
POSTGRES_PASSWORD=${pw}
EOF
    )
    echo "init: generated .env"
fi
# shellcheck disable=SC1091
source .env

# 2. Self-signed server cert. Ownership must match the container's postgres
#    user so PG can read the key under rootless podman (userns mapping).
mkdir -p certs
if [[ ! -f certs/server.key ]]; then
    openssl req -new -x509 -days 3650 -nodes \
        -out certs/server.crt -keyout certs/server.key \
        -subj "/CN=kluster-state-backend" \
        -addext "subjectAltName=IP:${BACKEND_HOST},IP:192.168.80.238,DNS:localhost"
    pg_uid="$(podman run --rm "$IMAGE" id -u postgres)"
    podman unshare bash -c \
        "chown ${pg_uid}:${pg_uid} certs/server.key certs/server.crt \
         && chmod 600 certs/server.key && chmod 644 certs/server.crt"
    echo "init: generated certs (owned by container postgres uid ${pg_uid})"
fi

# 3. .pulumi.backend at the repo root (consumed by mise -> PULUMI_BACKEND_URL).
repo_root="$(git rev-parse --show-toplevel)"
backend_file="${repo_root}/.pulumi.backend"
if [[ ! -f "$backend_file" ]]; then
    ( umask 177; printf 'postgres://%s:%s@%s:5432/%s?sslmode=require' \
        "$POSTGRES_USER" "$POSTGRES_PASSWORD" "$BACKEND_HOST" "$POSTGRES_DB" \
        > "$backend_file" )
    echo "init: wrote ${backend_file}"
fi
