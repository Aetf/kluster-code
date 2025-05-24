# vim: set ft=Dockerfile
ARG PG_MAJOR
ARG PG_MINOR
ARG PG_REV
ARG PGVECTO_RS_SEMVER
ARG VECTORCHORD_SEMVER
ARG TARGETARCH

FROM docker.io/tensorchord/pgvecto-rs-binary:pg${PG_MAJOR}-v${PGVECTO_RS_SEMVER}-${TARGETARCH} as pgvecto-binary

FROM ghcr.io/cloudnative-pg/postgresql:${PG_MAJOR}.${PG_MINOR}-${PG_REV}-bookworm
LABEL org.opencontainers.image.source=https://github.com/Aetf/kluster-code

ARG PG_MAJOR
ARG PG_MINOR
ARG PG_REV
ARG PGVECTO_RS_SEMVER
ARG VECTORCHORD_SEMVER
ARG TARGETARCH

USER root

COPY --from=pgvecto-binary /pgvecto-rs-binary-release.deb /tmp/vectors.deb
RUN apt-get install -y /tmp/vectors.deb && rm -f /tmp/vectors.deb

RUN <<EOF
set -eux
apt-get update && apt-get install -y wget
apt-get autoremove -y
apt-get clean -y
rm -rf /var/lib/apt/lists/*
EOF

RUN <<EOF
wget https://github.com/tensorchord/VectorChord/releases/download/${VECTORCHORD_SEMVER}/postgresql-${PG_MAJOR}-vchord_${VECTORCHORD_SEMVER}-1_${TARGETARCH}.deb \
    -O /tmp/vchord.deb
dpkg -i /tmp/vchord.deb
rm /tmp/vchord.deb
EOF

RUN usermod -u 26 postgres
USER 26

