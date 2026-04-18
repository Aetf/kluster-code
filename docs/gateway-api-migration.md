# Gateway API Migration Status and Reference

This document tracks the progress, architecture, and current blockers for migrating cluster services from legacy Ingress to Kubernetes Gateway API (`HTTPRoute` + `BackendTLSPolicy`), using Traefik v3 as the implementation.

---

## Current Migration Status (As of April 18, 2026)

Most mTLS-enabled services have been **reverted** to legacy Ingress due to a technical blocker in Traefik v3's handling of backend CA certificates.

| Service                | Status      | Ingress Type   | Notes                                                                                                  |
| :--------------------- | :---------- | :------------- | :----------------------------------------------------------------------------------------------------- |
| **Authelia**           | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Nextcloud**          | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Jellyfin**           | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **K8s Dashboard**      | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Dufs (dav)**         | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Transmission**       | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Nginx Static**       | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Syncthing GUI**      | Reverted    | Legacy Ingress | Regressed due to mTLS blocker.                                                                         |
| **Immich**             | Migrated    | Gateway API    | No mTLS required.                                                                                      |
| **Syncthing Discosrv** | Migrated    | Gateway API    | Uses custom TLS passthrough.                                                                           |
| **Home Assistant**     | In Progress | Mixed          | Blocked due to no ExternalName support in Gateway API. https://github.com/traefik/traefik/issues/12950 |

### Technical Blockers (The "mTLS Problem")

A full migration is currently blocked by a discrepancy in how Traefik v3 and `cert-manager` handle root CA certificates for backend TLS verification:

1. **Traefik v3 (pre-3.7)**: Requires root CA certificates for `BackendTLSPolicy` to be provided via a `ConfigMap`. It does not yet support mounting from a `Secret`.
2. **Cert-Manager**: Only supports writing CA certificates to `Secret` resources.
3. **Internal TLS Regressions**: Services using mTLS (backend verification) fail with 500 Internal Server Errors because Traefik cannot verify the backend certificate without the root CA.

**Tracking Issues**:

- [Traefik PR #12927](https://github.com/traefik/traefik/pull/12927) (Support Secrets in BackendTLSPolicy) - **Required for 3.7 upgrade**
- [Local Tracking Issue #134](https://github.com/Aetf/kluster-code/issues/134)

---

## Resolved Design Decisions

| Decision                    | Resolution                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------- |
| **HTTPRoute placement**     | **App namespace** — App owns its route, no ExternalName proxy needed.               |
| **Single vs multi-Gateway** | **Single Gateway** with one HTTPS listener per TLD.                                 |
| **Gateway permissions**     | Allows all namespaces — acceptable since all are managed by this stack.             |
| **Migration strategy**      | **Phased**: keep Ingress + HTTPRoute co-existing; migrate one app at a time.        |
| **Cert-manager approach**   | **Certificate CRD** (explicit) — required for wildcard listener support.            |
| **Log format**              | **Text (CLF)** — human-readable, interleaved general and access logs.               |
| **HTTP Redirects**          | Handled at the **Entrypoint level** (Traefik static config), not Gateway listeners. |

---

## Architecture

### Gateway Resource

The `Gateway` resource (owned by `Serving` in `src/serving/index.ts`) is the central entry point.

- **Listeners**: One HTTPS (Terminate) listener per TLD certificate (e.g., `*.unlimited-code.works`).
- **SNI Demultiplexing**: Traefik maps listeners to entrypoints by port (443) and demultiplexes via SNI hostnames.
- **Certificate Refs**: Explicitly references `Secret` resources created by the wildcard `Certificate` CRDs.

### FrontendService Implementation

The `FrontendService` component (`src/serving/service.ts`) handles resource emission based on service needs.

**Key Parameters**:

- `useLegacyIngress`: Emits a standard `Ingress` + `ExternalName` service.
- `enableGatewayAPI`: Emits `HTTPRoute` and (if `backendCert` is present) `BackendTLSPolicy`.
- `suppressAccessLogPaths`: Creates a split `HTTPRoute` with `traefik.io/router.observability.accesslogs: "false"`.

### stdiscosrv: TLSRoute Passthrough

`SyncthingDiscosrv` requires specialized mTLS (client device certs). It is migrated using **TLS Passthrough via `TLSRoute`** (experimental channel).

- **Architecture**: Gateway routes by SNI but does NOT terminate TLS. The stream is passed unchanged to `stdiscosrv`.
- **Infrastructure**: Requires `experimentalChannel: true` in Traefik and a `Passthrough` listener on the Gateway.

---

## Phased Migration Roadmap

### Phase 0: Foundation

- Enable `kubernetesGateway` and `experimentalChannel` in Traefik.
- Create the shared `Gateway` resource in `serving-system`.

### Phase 1: Parallel Emission

- Refactor `FrontendService` to emit both `Ingress` and `HTTPRoute` for non-mTLS services.
- Verify `Accepted` status on all routes.

### Phase 2: Pilot Migration (spoolman)

- Disable legacy ingress for the pilot app.
- Verify HTTPS access, auth redirects, and access logs.

### Phase 3: mTLS Blocked Services (Current Status)

- These services (Authelia, Nextcloud, etc.) remain on **Legacy Ingress** until Traefik 3.7.
- `enableGatewayAPI` is set to `false` to avoid TLS handshake failures.

### Phase 4: Full Cutover (Post-Traefik 3.7)

1. **Upgrade Traefik** to 3.7+.
2. **Update Infrastructure**: Modify `service.ts` to use `Secret` references in `BackendTLSPolicy`.
3. **Toggle Flags**: Switch all services to `enableGatewayAPI: true` and `useLegacyIngress: false`.
4. **Cleanup**: Remove `useLegacyIngress` logic and disable `kubernetesIngress` provider in Traefik.

---

## Troubleshooting Reference

- **Check Gateway Status**: `kubectl get gateway traefik -n serving-system -o yaml`
- **Check HTTPRoutes**: `kubectl get httproute -A`
- **Check BackendTLSPolicy**: `kubectl get backendtlspolicy -A`
- **Access Logs**: View interleaved logs in the Traefik pod stdout. Filter by app hostname.

---

_Last Updated: April 18, 2026_
