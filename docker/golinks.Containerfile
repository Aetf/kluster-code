# kellegous/go: go/<name> shortlink service with a web UI (go/edit/<name>) and
# a leveldb data directory. Upstream publishes no releases and its Docker Hub
# image is stale, so we build from a pinned commit. The Vue UI is built first,
# then embedded into the Go binary (go:embed), so the final image is a single
# static binary on scratch.
FROM docker.io/library/alpine:3.22 AS src
ARG GOLINKS_COMMIT
ADD https://github.com/kellegous/go/archive/${GOLINKS_COMMIT}.tar.gz /tmp/src.tar.gz
RUN mkdir /src && tar -xzf /tmp/src.tar.gz -C /src --strip-components=1

FROM docker.io/library/node:24-alpine AS ui
COPY --from=src /src /src
WORKDIR /src
RUN npm ci && npm run build

FROM docker.io/library/golang:1.26-alpine AS build
COPY --from=ui /src /src
WORKDIR /src
RUN CGO_ENABLED=0 go build -o bin/go ./cmd/go

FROM scratch
COPY --from=build /src/bin/go /go
EXPOSE 8067
ENTRYPOINT ["/go"]
CMD ["--data=/data"]
