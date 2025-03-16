docker:
  buildah bud -f docker/pgvecto-rs-cnpg.Containerfile --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code -t ghcr.io/aetf/pgvecto-rs-cnpg:15.12-5-0.3.0
  buildah push ghcr.io/aetf/pgvecto-rs-cnpg:15.12-5-0.3.0
