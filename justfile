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

# kellegous/go, the go/<name> shortlink service
docker-golinks:
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; source docker/golinks.conf; set +a
    tag="ghcr.io/aetf/golinks:${GOLINKS_VERSION}"
    buildah bud -f docker/golinks.Containerfile \
      --build-arg-file docker/golinks.conf \
      --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code \
      -t "$tag"
    buildah push "$tag"

# email-oauth2-proxy, the Gmail XOAUTH2 bridge for Home Assistant's imap integration
docker-emailproxy:
    #!/usr/bin/env bash
    set -euo pipefail
    set -a; source docker/emailproxy.conf; set +a
    tag="ghcr.io/aetf/emailproxy:${EMAILPROXY_VERSION}"
    buildah bud -f docker/emailproxy.Containerfile \
      --build-arg-file docker/emailproxy.conf \
      --annotation org.opencontainers.image.source=https://github.com/Aetf/kluster-code \
      -t "$tag"
    buildah push "$tag"
