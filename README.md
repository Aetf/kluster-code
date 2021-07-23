# Installing Kubernetes

## Use k3s to provision the cluster

k3s uses a config file `k3s-kluster.yml`, this file needs to be copied to `/etc/rancher/k3s/config.yaml`.

## Use pulumi to deploy the configurations

`pulumi up`

## Per Pod Cert for mTLS
This is done by bootstraping a self-signed CA in the cluster using cert-manager,
then manually create a certificate (`BackendCertificate`) for each service.
This is implemented in `base-cluster/certs.ts`.

## Outdated images

The [`outdated`](https://github.com/replicatedhq/outdated) kubectl plugin can list all outdated
images in the cluster.

## TODO

- - [x] install cert-manager
    * - [x] create issuer: cluster root CA
        + - [ ] find a way to notify and reload internal services when cert reneal
            + nginx
            + dashboard
            + authelia
            + nextcloud nginx frontend
        + they read in cert on start up and will not monitor cert change in file system
    * - [x] create issuer: let's encrypt
    * - [x] manage cluster CA signed cert for dashboard
        + - [x] use this cert for dashboard
        + - [x] enable cert verify in traefik
- - [x] always redirect http to https
- - [x] investigate the usage of traefik IngressRoute CRD
    * no of too much improvement to worth it
- - [x] static file serving
    * - [x] mount host path pvc
- - [x] install authelia
    * config traefik to use auth
    * protect dashboard with auth
- - [x] why service name does not resolve even when under the same namespace? Have to use full name always
    * can not reproduce
- - [x] Consider flux? (example: https://github.com/fluxcd/flux2-kustomize-helm-example)
    * need to disable k3s packaged helm-controller
    * no too much benefit than directly managing
- - [x] nextcloud
- - [x] use glob to build config map for all files in a directory
    * - [x] rewrite resource to use initialize, which is async
- - [ ] use exim to consolidate email sending
- - [ ] properly retain authelia user database. Currently it gets reset whenever it is redeployed
    * move mariadb in nextcloud to a shared service using statefulset
        + how does statefulset's pvc template works?
    * make authelia connect to mariadb instead of sqlite

## Futures

- - [ ] tcp forwarding for btsync
    * maybe not possible? maybe just deploy syncthing and etc as NodeIP Service
- - [ ] traefik websocket for jupyter
    * should be supported out of box
    * need testing
- - [ ] CRD and shell-operator: https://github.com/flant/shell-operator
    * could be used to monitor and implement cert reloading
