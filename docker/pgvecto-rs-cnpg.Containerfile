# vim: set ft=Dockerfile

FROM docker.io/tensorchord/pgvecto-rs-binary:pg15-v0.2.0-amd64 as binary

FROM ghcr.io/cloudnative-pg/postgresql:15.8-10
LABEL org.opencontainers.image.source=https://github.com/Aetf/kluster-code

USER root

COPY --from=binary /pgvecto-rs-binary-release.deb /tmp/vectors.deb
RUN apt-get install -y /tmp/vectors.deb && rm -f /tmp/vectors.deb

RUN usermod -u 26 postgres
USER 26

