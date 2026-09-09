# The self-hosted GitHub Actions runner, with rootless podman for workflows
# that build images.
#
# The runner pod must mount a volume (emptyDir is enough) at
# /home/runner/.local/share/containers: podman's native rootless overlay driver
# refuses to stack on the container's own overlayfs rootfs, and a volume lands
# on the node filesystem instead. No privileged sidecar, extra capabilities or
# /dev/fuse are needed. Do not set allowPrivilegeEscalation: false on the
# container -- newuidmap is setuid, and no-new-privs breaks it.

ARG GHA_RUNNER_VERSION
FROM ghcr.io/actions/actions-runner:${GHA_RUNNER_VERSION}

USER root

RUN <<EOF
set -eux
apt-get update -y
apt-get install -y --no-install-recommends build-essential podman uidmap slirp4netns
rm -rf /var/lib/apt/lists/*
EOF

# Rootless podman maps container ids into this range; without it `podman run`
# fails outright. The base image's runner user is uid 1001.
RUN <<EOF
set -eux
echo 'runner:100000:65536' > /etc/subuid
echo 'runner:100000:65536' > /etc/subgid
EOF

USER runner
