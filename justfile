docker:
  buildah bud -f docker/pgvecto-rs-cnpg.Containerfile --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code -t ghcr.io/aetf/pgvecto-rs-cnpg:15.3-10
