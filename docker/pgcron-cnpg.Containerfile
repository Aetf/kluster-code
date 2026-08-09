# vim: set ft=Dockerfile
ARG PG_MAJOR
ARG PG_MINOR
ARG PG_FLAVOR
ARG PG_DISTRO

# The `standard` flavor no longer ships barman-cloud; backups go through the
# barman-cloud CNPG-I plugin instead (installed in src/postgresql.ts).
FROM ghcr.io/cloudnative-pg/postgresql:${PG_MAJOR}.${PG_MINOR}-${PG_FLAVOR}-${PG_DISTRO}
LABEL org.opencontainers.image.source=https://github.com/Aetf/kluster-code

ARG PG_MAJOR

USER root

# pg_cron comes from the PGDG apt repo, which the base image already configures.
RUN <<EOF
set -eux
apt-get update
apt-get install -y --no-install-recommends postgresql-${PG_MAJOR}-cron
apt-get clean -y
rm -rf /var/lib/apt/lists/*
EOF

USER 26
