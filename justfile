set dotenv-path := "docker/pgvecto-rs-cnpg.conf"
set dotenv-required := true

docker:
  buildah bud -f docker/pgvecto-rs-cnpg.Containerfile \
    --build-arg-file docker/pgvecto-rs-cnpg.conf \
    --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code \
    -t ghcr.io/aetf/pgvecto-rs-cnpg:${PG_MAJOR}.${PG_MINOR}-${PG_REV}-${PGVECTO_RS_SEMVER}
  buildah push ghcr.io/aetf/pgvecto-rs-cnpg:${PG_MAJOR}.${PG_MINOR}-${PG_REV}-${PGVECTO_RS_SEMVER}
