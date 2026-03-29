# Pulumi Project Analysis: kluster-code

This project manages a k3s cluster configuration using Pulumi with the Node.js runtime. It's structured as a set of modular components for infrastructure and applications.

## Core Structure

- **`src/index.ts`**: The main entry point. It orchestrates the deployment of the base cluster, infrastructure services, and various user applications.
- **`src/base-cluster/`**: Contains the core infrastructure setup.
  - **`BaseCluster`**: Installs essential services: `cert-manager` (with Let's Encrypt and private CA), `sealed-secrets`, `local-path-provisioner`, `JuiceFS`, `reloader`, and `node-feature-discovery`.
  - **`Nodes`**: Manages cluster node information and provides selectors.
  - **`Certs`**: Handles frontend and backend certificate generation.
## Serving & Ingress

This area manages external access, SSL/TLS termination, and authentication.

- **Traefik Ingress Controller**:
  - Deployed via Helm as the primary ingress controller.
  - Configured with two main entrypoints: `web` (port 80) and `websecure` (port 443).
  - Implements automatic HTTP to HTTPS redirection.
  - Integrated with `reloader` to automatically restart on configuration changes.
  - Supports `ExternalName` services, allowing routing to services outside the cluster or in different namespaces.
  - Uses `BackendCertificate` for internal TLS and SNI strictness.

- **Authelia Authentication**:
  - Provides a centralized identity and access management (IDAM) system.
  - Supports **OIDC** (OpenID Connect) for modern applications and **ForwardAuth** for legacy or simple proxy-based authentication.
  - Integrated with Traefik via dedicated `Middleware` (one for standard OIDC/ForwardAuth, one for Basic Auth).
  - Backed by **Redis** for high-performance session management.
  - Configuration is highly modular, using `FileSecret` for sensitive credentials and environment-based templating for dynamic configuration.
  - Configured with clients for services like **Immich**, **Jellyfin**, and **Grafana**.

- **Certificate Management**:
  - Uses `cert-manager` to automate the issuance and renewal of SSL certificates.
  - **Let's Encrypt**: Configured with DNS-01 challenge via Cloudflare for public-facing domains.
  - **Private CA**: A self-signed root CA for internal service-to-service communication.
  - `FrontendCertificate` and `BackendCertificate` abstractions simplify certificate requests for different use cases.

- **FrontendService Abstraction**:
  - A custom `ComponentResource` that streamlines the deployment of web-facing services.
  - Automatically creates:
    - An `ExternalName` service pointing to the backend deployment.
    - A Kubernetes `Ingress` resource with necessary Traefik annotations.
    - Integration with Authelia middleware for optional authentication.
    - TLS configuration using the correct certificates based on the hostname.
- **`src/utils.ts`**: Contains critical helper classes and extensions:
  - `HelmChart`: Simplified Helm chart management with versioning from config.
  - `ConfigMap`: Enhanced ConfigMap with file globbing and Handlebars templating.
  - `SealedSecret`: Integration with Bitnami Sealed Secrets.
  - Monkey-patches for `Service` and `Node` to add convenience methods like `asUrl` and `hostnameSelector`.
- **`src/crds/`**: Local copies or generated types for Custom Resource Definitions used in the project (cert-manager, sealed-secrets, etc.).

## Infrastructure Services

## Monitoring & Observability

The cluster uses the industry-standard Prometheus stack for metrics collection and visualization.

- **Kube-Prometheus-Stack**:
  - A comprehensive monitoring solution including Prometheus, Grafana, Alertmanager, and various exporters.
  - **Prometheus**: Configured with persistent storage on `local-path-stable` and automated scraping via `ServiceMonitor` and `PodMonitor` CRDs.
  - **Grafana**:
    - **Authentication**: Fully integrated with **Authelia** via Generic OAuth. Users are automatically logged in based on their Authelia session, with role mapping from Authelia groups (`admins` -> `GrafanaAdmin`, `grafana-users` -> `Editor`).
    - **Security**: Configured with `admin` credentials from a `SealedSecret` and `cookie_secure` for HTTPS.
    - **Notifications**: Integrated with the internal **Exim** mail relay for sending alerts.
  - **Alertmanager**: Provides alert deduplication, grouping, and routing to various receivers.
  - **Node Exporter**: Deployed on all nodes to collect host-level metrics, with relabeling to include node names in metrics.
  - **Admission Webhooks**: Secured using `cert-manager` with the cluster's internal private CA.
## Database & State Management

The cluster leverages operators and standardized Helm charts to manage stateful workloads.

- **PostgreSQL (CloudNativePG)**:
  - Managed by the **CloudNativePG** operator, which provides high availability, automated failover, and point-in-time recovery for PostgreSQL databases.
  - Used for critical applications like **Immich** and **Authelia** (likely for its internal user database).
  - Deployed in a standalone or clustered configuration depending on the application's requirements.

- **Redis (Key-Value Store)**:
  - A custom `Redis` component that wraps the Bitnami Redis Helm chart.
  - Deployed in **standalone architecture** to minimize overhead while providing persistent storage.
  - Features:
    - Dedicated `masterService` abstraction for easy internal connectivity.
    - Integration with `SealedSecret` for password management.
    - Used by **Authelia** for session caching and **JuiceFS** for metadata storage.
## Storage Infrastructure

The cluster employs a tiered storage strategy to balance performance, persistence, and scalability.

- **Local Path Provisioner**:
  - Provides dynamic provisioning of host-path based volumes.
  - **Reclaim Policies**:
    - `local-path`: Uses `Delete` policy for transient data.
    - `local-path-stable`: Uses `Retain` policy for important persistent data.
  - Configured with `WaitForFirstConsumer` binding mode to ensure volumes are created on the correct node where the pod is scheduled.

- **JuiceFS (Shared Storage)**:
  - A POSIX-compliant shared file system built on top of object storage.
  - **Architecture**:
    - **Metadata**: Stored in a dedicated **Redis** instance (managed via `Redis` component) for low-latency operations.
    - **Data**: Stored in an **S3 bucket** (AWS US-East-1) for massive scalability and durability.
  - **Performance Optimizations**:
    - Uses `writeback_cache` to speed up write operations.
    - `upload-delay=10s`: Buffers small writes locally before uploading to S3, reducing API calls and improving responsiveness.
    - Configured with `cache-dir` on local node storage for read caching.
  - Deployed via Helm with custom patches to enable `format-in-pod` for data encryption support.

- **Static Node PVs (`NodePV`)**:
  - A custom abstraction for manually binding a specific host path on a specific node to a PVC.
  - Used for large-scale data that pre-exists on nodes, such as a NAS mount for media files.
  - Ensures pod affinity to the node where the physical data resides.

## Application Services

The cluster hosts a variety of user-facing applications, each with tailored infrastructure requirements.

### Photo & Media Management
- **Immich (Photos)**:
  - **Database**: Uses a dedicated **CloudNativePG** cluster with a custom image containing `pgvecto.rs` for AI-powered features. Backups are stored in **Google Cloud Storage (GCS)**.
  - **Cache**: Employs a dedicated **Redis** instance for high-performance task queuing.
  - **Storage**: Large-scale storage (50Ti) provided via **JuiceFS** for the library, with local SSDs for database and cache.
  - **Scheduling**: Uses pod affinity to run on nodes with low latency to the JuiceFS metadata server.
  - **Authentication**: Integrated with **Authelia** via OIDC.

- **Jellyfin (Media Server)**:
  - **Hardware Acceleration**: Configured for **Intel GPU** passthrough (`gpu.intel.com/i915`) to enable efficient transcoding.
  - **Networking**:
    - **External**: Accessible via Traefik for remote access.
    - **Internal (LAN)**: Exposed via a dedicated `LoadBalancer` service on the `homelan` pool for high-bandwidth local streaming.
  - **Storage**: Mounts a large-scale media library via `NodePV`.
  - **Certificate**: Uses `BackendCertificate` with **PKCS12** support for native TLS.

### Synchronization & File Sharing
- **Syncthing**:
  - Provides peer-to-peer file synchronization.
  - Uses a dedicated discovery server (`stdiscosrv`) for efficient peer finding.
  - Backed by **JuiceFS** for cross-node file consistency.
- **Dufs (WebDAV)**:
  - A lightweight file server for quick WebDAV access.
  - Integrated with **Authelia** for secure file browsing.

### Utility & Specialized Apps
- **Spoolman**: Manages 3D printing filament inventory, integrated with the cluster's database and ingress.
- **Hath (Hentai@Home)**: A specialized client for a distributed image hosting network, utilizing cluster storage and networking.
- **Genshin Everyday**: An automation service for daily tasks in Genshin Impact.
## Internal Mail Services

To ensure reliable alert delivery and system notifications, the cluster maintains a centralized mail relay.

- **Exim SMTP Relay**:
  - Acts as a "smarthost" relay for all internal cluster services (e.g., Authelia, Grafana, Nextcloud).
  - **Upstream Relay**: Configured to use **Gmail** (smtp.gmail.com:587) for final delivery, authenticated via `SealedSecret`.
  - **Security**:
    - **TLS**: Uses `BackendCertificate` for encrypted communication within the cluster.
    - **DKIM**: Signed with a cluster-internal DKIM key (`ClusterCertificate`) to improve deliverability and authenticity.
  - **Access Control**: Configured to only allow relaying from internal cluster IP ranges (`10.0.0.0/8`).
  - **Configuration**: Uses a custom `exim.conf` managed via `ConfigMap` and integrated with `reloader` for automatic updates.
- **Games**: Minecraft (Mc).

## Configuration Management

- Uses `Pulumi.yaml` and `Pulumi.<stack>.yaml` for configuration.
- `src/config.ts` uses Proxies to provide typed access to `image:*`, `chart:*`, and boolean flags.
- Heavily relies on **Sealed Secrets** for sensitive data, ensuring they can be safely committed to version control.

## Key Patterns

1. **Namespacing**: Most services are deployed into dedicated namespaces using the `namespaced` helper in `index.ts`.
2. **Component Resources**: High-level abstractions are built using `pulumi.ComponentResource` (e.g., `BaseCluster`, `Serving`, `Jellyfin`).
3. **Template-based Config**: ConfigMaps are often generated from local files with template interpolation.
4. **Physical Name Management**: Uses `deleteBeforeReplace: true` and explicit names for resources that require stable naming or have Helm naming quirks.
