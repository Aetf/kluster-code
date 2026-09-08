ARG GHA_RUNNER_VERSION
FROM ghcr.io/actions/actions-runner:${GHA_RUNNER_VERSION}

USER root

RUN <<EOF
set -eux
apt-get update -y
apt-get install -y --no-install-recommends build-essential
rm -rf /var/lib/apt/lists/*
EOF

USER runner
