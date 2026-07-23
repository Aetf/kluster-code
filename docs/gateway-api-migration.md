# Gateway API Migration — Complete

This document records the (now finished) migration of cluster services from
legacy Ingress to the Kubernetes Gateway API (`HTTPRoute` / `TLSRoute` /
`BackendTLSPolicy`), implemented with Traefik v3.7.

The blocker that stalled this migration in early 2026 — Traefik pre-3.7 only
accepting `BackendTLSPolicy` root CAs from a `ConfigMap` while `cert-manager`
writes them to a `Secret` — was resolved by
[Traefik #12927](https://github.com/traefik/traefik/pull/12927), shipped in
Traefik 3.7. The migration was then completed in full; the
`kubernetesIngress` provider is disabled and the legacy code path is removed.

---

## Final State

| Service                | Ingress Type | Notes                                                           |
| :--------------------- | :----------- | :------------------------------------------------------------- |
| **Authelia**           | Gateway API  | HTTPRoute + BackendTLSPolicy (mTLS).                            |
| **Jellyfin**           | Gateway API  | HTTPRoute + BackendTLSPolicy (mTLS).                            |
| **K8s Dashboard**      | Gateway API  | HTTPRoute + BackendTLSPolicy (mTLS). Not currently deployed.   |
| **Dufs (dav)**         | Gateway API  | HTTPRoute + BackendTLSPolicy (mTLS), basic auth.               |
| **Transmission (bt)**  | Gateway API  | HTTPRoute + BackendTLSPolicy (mTLS). Not currently deployed.   |
| **Nginx Static**       | Gateway API  | One HTTPRoute + BackendTLSPolicy per static site.              |
| **Syncthing GUI**      | Gateway API  | HTTPRoute + BackendTLSPolicy (mTLS).                           |
| **Immich**             | Gateway API  | HTTPRoute, no mTLS.                                            |
| **Home Assistant**     | Gateway API  | HTTPRoute; selector-less service + manual endpoints; access-log suppression on `/api/webhook/` via IngressRoute. |
| **Spoolman**           | Gateway API  | HTTPRoute, auth.                                               |
| **Grafana (mon)**      | Gateway API  | HTTPRoute.                                                     |
| **Minecraft dynmap**   | Gateway API  | HTTPRoute.                                                     |
| **Syncthing Discosrv** | Gateway API  | **TLSRoute passthrough** — backend terminates TLS itself.     |

---

## Architecture

### Traefik (`src/serving/traefik.ts`)

- Helm chart `41.0.2` (Traefik v3.7).
- Providers: `kubernetesGateway` (with `experimentalChannel: true` for
  `TLSRoute`) and `kubernetesCRD` (for `IngressRoute` / `Middleware` /
  `TLSOption`). **`kubernetesIngress` is disabled.**
- HTTP→HTTPS redirect at the entrypoint (`ports.web.http.redirections`).
- A default `TLSOption` with `sniStrict: true` is kept; the
  `kubernetesGateway` provider honors it and it enforces that clients send
  SNI (a no-SNI connection to `:443` is rejected).
- Global backend CA is still mounted at `/tls` and passed as
  `--serversTransport.rootCAs=/tls/ca.crt` (used as a fallback / for any
  non-Gateway transport).

### Gateway (`src/serving/index.ts`)

- One `Gateway` in `serving-system`, `gatewayClassName: traefik`.
- **HTTPS listeners**: for each TLD certificate, a root + wildcard
  `HTTPS`/`Terminate` listener on port 8443, referencing the wildcard
  `Certificate` Secret. SNI demultiplexes to the matching listener.
- **Passthrough listeners**: for each host in `passthroughHosts`, a
  `TLS`/`Passthrough` listener with no `certificateRefs`. Currently
  `syncapi.unlimited-code.works` (stdiscosrv).
- Gateway API CRDs are installed from the **experimental** channel and must
  match the `sigs.k8s.io/gateway-api` version linked into the deployed
  Traefik (currently **v1.5.1** for Traefik 3.7.x) — a mismatch breaks the
  provider (e.g. it fails to watch `v1` `TLSRoute` and serves no routes).

### FrontendService (`src/serving/service.ts`)

Single emission path (no more dual-emit). Depending on args it emits:

- `<name>`: an `HTTPRoute` targeting the backend Service directly, or a
  `TLSRoute` when `tlsPassthrough` is set.
- `<name>-tls`: a `BackendTLSPolicy` when `enableMTls`, with
  `caCertificateRefs` pointing at the backend certificate **Secret**
  (`kind: Secret`) — the thing Traefik 3.7 unblocked. Its
  `validation.hostname` matches the backend certificate SAN, i.e.
  `<service>.<namespace>` (see `src/base-cluster/certs.ts`), **not** the
  fully-qualified `...svc.cluster.local`.
- `<name>-nolog`: for `suppressAccessLogPaths`, a traefik `IngressRoute`
  (not a second HTTPRoute) at high priority with
  `route.observability.accessLogs: false`. The `kubernetesGateway` provider
  ignores per-route observability annotations on HTTPRoute, so an
  IngressRoute is required to actually disable access logging for a path.

### stdiscosrv TLS passthrough

`SyncthingDiscosrv` needs client device certificates. It terminates TLS
itself using a dedicated Let's Encrypt `FrontendCertificate` and is exposed
via a `TLSRoute` on the Gateway's Passthrough listener — the Gateway routes
by SNI without terminating TLS, so client device certs reach stdiscosrv
directly (no `passTLSClientCert` header forwarding).

---

## mTLS backend trust

- Private CA bootstrapped in `src/base-cluster/base.ts` (`setupPrivateCA`),
  exposed as `base.rootIssuer`.
- Each mTLS backend gets a `cert-svc-<name>` Certificate
  (`src/base-cluster/certs.ts`, DNS name `<service>.<namespace>`), whose
  Secret carries `tls.crt` / `tls.key` / `ca.crt`.
- The backend serves HTTPS with its `cert-svc-*` Secret; the Gateway
  verifies it via the `BackendTLSPolicy` `caCertificateRefs` Secret.

---

## Troubleshooting

- Gateway status: `kubectl get gateway -n serving-system -o yaml`
- Routes: `kubectl get httproute,tlsroute -A`
- Backend policies: `kubectl get backendtlspolicy -A` (all should be
  `Accepted`; identical policies over a shared Service may report
  `Conflicted` on the extras — harmless, one wins).
- Access logs: interleaved on the Traefik pod stdout; the router name in
  each line ends with `@kubernetesgateway` (Gateway) or `@kubernetescrd`
  (IngressRoute / Middleware).

_Last Updated: July 22, 2026_
