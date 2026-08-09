# Custom CNPG postgres images. Each has a sibling `.conf` holding its build args,
# which doubles as the source of the image tag, so a version bump is a one-line
# edit in the `.conf`.

# pgvecto.rs + VectorChord, for immich
docker-vchord:
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; source docker/pgvecto-rs-cnpg.conf; set +a
    tag="ghcr.io/aetf/vchord-cnpg:${PG_MAJOR}.${PG_MINOR}-${PG_REV}-${VECTORCHORD_SEMVER}"
    buildah bud -f docker/pgvecto-rs-cnpg.Containerfile \
      --build-arg-file docker/pgvecto-rs-cnpg.conf \
      --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code \
      -t "$tag"
    buildah push "$tag"

# pg_cron, for splitpro's recurring expenses
docker-pgcron:
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; source docker/pgcron-cnpg.conf; set +a
    tag="ghcr.io/aetf/pgcron-cnpg:${PG_MAJOR}.${PG_MINOR}-${PG_FLAVOR}-${PG_DISTRO}-${PGCRON_REV}"
    buildah bud -f docker/pgcron-cnpg.Containerfile \
      --build-arg-file docker/pgcron-cnpg.conf \
      --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code \
      -t "$tag"
    buildah push "$tag"

updatecrd:
    npm run crds
