# The self-hosted GitHub Actions runner, with podman for workflows that need a
# container runtime.
#
# The runner runs as uid 0 inside a pod that has its own user namespace
# (`hostUsers: false`), so container root maps to an unprivileged host uid and
# podman runs rootful. That combination is what makes podman work here without
# a privileged pod: rootless podman would need CAP_SYS_ADMIN for setuid-root
# newuidmap to write a uid_map, and slirp4netns would need /dev/net/tun, which
# cannot be handed to a user-namespaced pod at all (devtmpfs does not support
# idmapped mounts). Rootful podman needs neither -- CNI's bridge plugin builds
# the veth itself.
#
# The pod spec that goes with this image lives in gha-runner-values.yaml; the
# mount at /var/lib/containers and the `procMount: Unmasked` there are both
# load-bearing, see the comments in that file.

ARG GHA_RUNNER_VERSION
FROM ghcr.io/actions/actions-runner:${GHA_RUNNER_VERSION}

USER root

RUN <<EOF
set -eux
apt-get update -y
apt-get install -y --no-install-recommends build-essential podman
rm -rf /var/lib/apt/lists/*
EOF

# Kubernetes mounts /sys/fs/cgroup read-only and delegates no cgroup to the
# pod, so podman's attempt to create one for each container dies on
# `cgroup.subtree_control`. Disabling cgroup creation leaves workload
# containers in the runner pod's own cgroup, which is where we want them: the
# pod's cpu/memory limits then apply to everything the job starts.
#
# The base image ships no /etc/containers/containers.conf, so this file is not
# shadowing distro defaults.
RUN <<EOF
set -eux
cat > /etc/containers/containers.conf <<'CONF'
[containers]
cgroups = "disabled"
CONF
EOF
