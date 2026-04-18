# Gateway API Migration Status

This document tracks the progress, architecture, and current blockers for migrating cluster services from legacy Ingress to Kubernetes Gateway API (`HTTPRoute` + `BackendTLSPolicy`).

## Overview
The goal is to move all web-facing services to the Traefik Gateway API provider to leverage modern Kubernetes routing standards and improve internal TLS management.

## Current Migration Status

| Service | Status | Ingress Type | Notes |
| :--- | :--- | :--- | :--- |
| **Authelia** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Nextcloud** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Jellyfin** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **K8s Dashboard** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Dufs (dav)** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Transmission** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Nginx Static** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Syncthing GUI** | Reverted | Legacy Ingress | Regressed due to mTLS blocker. |
| **Immich** | Migrated | Gateway API | No mTLS required. |
| **Syncthing Discosrv**| Migrated | Gateway API | Uses custom TLS options. |
| **Home Assistant** | In Progress | Mixed | See `haos` component. |

## Technical Blockers (The "mTLS Problem")
As of April 2026, a full migration is blocked by a discrepancy in how Traefik v3 and `cert-manager` handle root CA certificates for backend TLS verification.

1. **Traefik v3 (pre-3.7)**: Requires root CA certificates for `BackendTLSPolicy` to be provided via a `ConfigMap`. It does not yet support mounting from a `Secret`.
2. **Cert-Manager**: Only supports writing CA certificates to `Secret` resources. There is no native support for writing to a `ConfigMap`.
3. **Internal TLS Regressions**: Services using mTLS (backend verification) fail with 500 Internal Server Errors because Traefik cannot verify the backend certificate without the root CA.

**Tracking Issues**:
- [Traefik PR #12927](https://github.com/traefik/traefik/pull/12927) (Support Secrets in BackendTLSPolicy)
- [Cert-Manager Issue #7003](https://github.com/cert-manager/cert-manager/issues/7003) (Write to ConfigMap)
- [Local Tracking Issue #134](https://github.com/Aetf/kluster-code/issues/134)

## Architecture

### FrontendService Implementation
The `FrontendService` component (`src/serving/service.ts`) has been updated to handle the migration gracefully.

**Key Flags**:
- `useLegacyIngress`: When `true`, emits a standard Kubernetes `Ingress` resource.
- `enableGatewayAPI`: When `true`, emits `HTTPRoute` and `BackendTLSPolicy` resources.
- `backendCert`: An optional `BackendCertificate` object. If provided, the infrastructure prepares the `BackendTLSPolicy` with the correct CA references.

### Implementation Pattern
```typescript
args.serving.createFrontendService(name, {
    host: args.host,
    targetService: service,
    backendCert: this.certificate,
    enableGatewayAPI: false, // Set to false for mTLS services until Traefik 3.7
    useLegacyIngress: true,
});
```

## Next Steps
1. **Upgrade Traefik**: Monitor for Traefik 3.7+ release and upgrade the cluster.
2. **Infrastructure Update**: Once on 3.7+, update `FrontendService` to use the new `Secret` reference type in `BackendTLSPolicy`.
3. **Re-Migration**: Flip `enableGatewayAPI: true` and `useLegacyIngress: false` for all reverted services.
4. **Verification**: Confirm mTLS handshake and Authelia authentication flows.

---
*Last Updated: April 18, 2026*
