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

## Traefik Dashboard

The internal dashboard can be accessed by forward the internal traefik port

```
kubectl port-forward -n serving-system service/traefik-internal 9000:80
```

The dashboard is available at `http://localhost:9000/dashboard/`.
Note that the trailing slash is important.

## TODO

- - [x] install cert-manager
    * - [x] create issuer: cluster root CA
        + they read in cert on start up and will not monitor cert change in file system
            + nginx
            + dashboard
            + authelia
            + nextcloud nginx frontend
            + exim
            + syncthing-discosrv
        + - [x] use [Reloader](https://github.com/stakater/Reloader) to notify and reload internal services when cert reneal
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
- - [x] use exim to consolidate email sending
    * - [x] change authelia and nextcloud to use exim
    * - [x] config exim to use TLS on 587
- - [ ] properly retain authelia user database. Currently it gets reset whenever it is redeployed
    * move mariadb in nextcloud to a shared service using statefulset
        + how does statefulset's pvc template works?
    * make authelia connect to mariadb instead of sqlite
- - [ ] run syncthing inside k8s
    * setup nodepv
    * - [ ] tcp forwarding for btsync
    * syncthing needs the follow certs
        + permanent cert for device ID (this seems can be self generated, needs testing)
            + how to import existing ones
        + regular svc cert for GUI https
    * manage the certs using cert-manager?
    * use the syncthing/syncthing docker image
    * - [x] syncthing-discorv needs cert-unlimited-code.works
        + - [x] there's also syncthing/discorv image
    * maybe not possible? maybe just deploy syncthing and etc as NodeIP Service
- - [ ] run hath inside k8s
    * note the open port
- - [ ] check nofile: `sudo lsof | awk '{print $1 $2}' | sort | uniq -c | sort -n | tee ~/lsof.txt`
- - [ ] load sealed secret from yaml file
- - [ ] consolidate all image/version into main index.ts for easier updating
- - [ ] add jellyfin
    * should run on aetf-laptop only
- - [ ] add [navidrome](https://www.navidrome.org/docs/installation/docker/)
    * keep music library on aetf-laptop
    * expose webservice
    * this supports Authelia forward header auth: https://github.com/navidrome/navidrome/pull/1152
    * the subsonic API has its own auth and must not be protected by authelia: https://github.com/navidrome/navidrome/issues/1189
    * use [substreamer](https://substreamerapp.com) on android

## Futures
- - [ ] traefik websocket for jupyter
    * should be supported out of box
    * need testing
- - [ ] use Ed25519 for dkim key
- - [ ] replace nextcloud with [dave](https://github.com/micromata/dave)
    * dave also supports config hot reload
    * the reload only works for a few section, and noteably doesn't include TLS certificates
    * protect this with http basic auth, using authelia, see https://github.com/authelia/authelia/pull/1563
- - [ ] renew leaf certificates when the ca cert is renewed
    * currently this has be done manually: `k cert-manager renew -A -l 'unlimited-code.works/cert-type=backend'`
    * Maybe trigger a script after renew: https://github.com/Werkspot/k8s-event-listener
    * See https://github.com/jetstack/cert-manager/issues/2478
    * See https://github.com/jetstack/cert-manager/issues/4344
- - [ ] Explore using linkerd2 service mesh to implement frontend <-> backend mTLS communication
    * The trust anchor can be set to never expire for our simple setup (not recommended through), then cert-manager can be completely removed if
      + frontend certs (let's encrypt certs) managed by traefik directly
      + or disable most cert-manager components just use it for misc certs
    * certificate rotation and ca distribution is handled by linkerd2 and there will be no issue of rotation
- - [ ] manage custom images on AWS ECR (it has a free tier)
    * See use pulumi to build, publish and consume the image: https://www.pulumi.com/blog/build-publish-containers-iac/
