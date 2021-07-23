import * as _ from "lodash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { SealedSecret } from "#src/crds/bitnami/v1alpha1";

import { BaseCluster, BackendCertificate } from '#src/base-cluster';
import { setAndRegisterOutputs, urlFromService, serviceFromDeployment, ConfigMap } from "#src/utils";
import { Middleware } from './traefik';
import { FrontendService } from "./service";

interface AutheliaArgs {
    base: BaseCluster,

    domain: string,
    subdomain: string,
}

export class Authelia extends pulumi.ComponentResource<AutheliaArgs> {
    public readonly service: kx.Service;
    public readonly certificate: BackendCertificate;
    public readonly middlewareAuth: Middleware;

    constructor(name: string, args: AutheliaArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:Authelia', name, args, opts);

        const service_account = new k8s.core.v1.ServiceAccount(name, {}, { parent: this });
        const namespace = service_account.metadata.namespace;

        this.certificate = args.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        // deployment and service
        this.service = this.setupDeploymentService(name, args, service_account);

        // frontend service for the login page
        const middlewareAuthelia = new Middleware('authelia', {
            headers: {
                browserXssFilter: true,
                customFrameOptionsValue: "SAMEORIGIN",
                customResponseHeaders: {
                    "Cache-Control": "no-store",
                    "Pragma": "no-cache",
                }
            }
        }, { parent: this });
        const front = new FrontendService(name, {
            host: `${args.subdomain}.${args.domain}`,
            targetService: this.service,
            middlewares: [middlewareAuthelia],
        }, { parent: this });

        // auth middleware
        const url = pulumi.all([urlFromService(this.service, 'https'), front.url]).apply(([url, loginUrl]) => {
            const fullUrl = new URL(url);
            fullUrl.pathname = '/api/verify';
            fullUrl.searchParams.append('rd', loginUrl);
            return fullUrl.href;
        });
        this.middlewareAuth = new Middleware('auth', {
            // TODO: authelia currently can't see client real IP
            forwardAuth: {
                address: url,
                trustForwardHeader: true,
                authResponseHeaders: [
                    "Remote-User",
                    "Remote-Name",
                    "Remote-Email",
                    "Remote-Groups",
                ],
                tls: {
                    // remove this and use caSecret once
                    // PR#7789 hits release in traefik
                    //caSecret: cert-svc-authelia
                    insecureSkipVerify: true
                }
            }
        }, { parent: this });

        setAndRegisterOutputs(this, {});
    }

    private setupDeploymentService(name: string, args: AutheliaArgs, service_account: k8s.core.v1.ServiceAccount): kx.Service {
        // persistent storage
        const storagePath = "/storage";
        const pvc = new kx.PersistentVolumeClaim(name, {
            metadata: {
                annotations: {
                    // the pvc will be pending because of WaitForFirstConsumer
                    // so don't wait for it in pulumi
                    // see https://github.com/pulumi/pulumi-kubernetes/issues/895
                    "pulumi.com/skipAwait": "true"
                }
            },
            spec: {
                storageClassName: args.base.localStorageClass.metadata.name,
                accessModes: [
                    'ReadWriteOnce',
                ],
                resources: {
                    requests: {
                        storage: "100Mi"
                    }
                }
            }
        }, { parent: this });

        // config file
        const configPath = "/config";
        const cm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
            tplVariables: {
                domain: args.domain,
                subdomain: args.subdomain,
                storagePath,
            },
        }, { parent: this });

        // setup the secrets
        const secret = new AutheliaSecret(name, {
            JWT_SECRET: "AgCYT9tnsHJ+P1k7vFUXHc9kDweaIezXQueesrJXOpba76gRBYIFkZpAySuHLPtS9B6on+8104Yp0cfu58qbZMtQouSs9woZhDjKbe/WStjx3Znr2S7pMn9oE/0mYk3uO91Q3Cdo98l+gQYSXeqiCl1TYnVG+u+/xuxey+R6U278RK7Q7uuqop3IQq2QfpyIeFI4EJcZfKkr5+9hPe53UjuaZG0AFQt+WBXiR2a8O1y7acL9MJAOJ0rlG9WJ2CNLKJ+XNQt9Vq/QAWlPenRc5PqH7X8+5ZcxB02WXKsU0gU2cyUmbYoK8eL5PwTKGWoZNoJdUb7tgBEfkGASGnQl3OEu+KKvPRhLYAoOmfTN65oeCZCBl/xuW3WnYSmzImYLLqRLkMU4UDbVIXn/w6kaiU+/O6GiE3d4gjVXOeBN5pT+I9NuFAzNqirBH/TFJoyFYuz8eDcz7GVbpHZ/c5NqVh/tu1V9mwTPaSxSeHc2RKBsYo4y7q+WauJXZZk0AZ/81jBDDct3WE3ROhhwWwokaTtelGGxacaug5Ij+92bt9C3ZNOw7VA/vdnoh/62Fr42gDfg9/fIdkorE2ep0eHSMeACUm49tyUXozYaVggTpbQJxTkU0Al8/2QNCIuNQTRg/I2jceqw7beTtPBnR6fJ7BNFhPWhSXH9MKzCP/3VUDKakwdUl9v2u/bOuuxLeGTBAJAJuE6tSUrEcMwgahC/YbKbMo0fHjcBD7IdRxnrwARrh+5tF7Y3WlQ+/pT+k1J+1bXdwWgjq88GVPmY+uQQjwuZplfCAbe4GONDgtECUE/1NZQWgyIz04Q/J3NaN6fTuDXqwfviD952Lck73/Jc82vL3Qz9cABVatnmQMtKS91JTA==",
            NOTIFIER_SMTP_PASSWORD: "AgAE76D9ZnYsUSG/o2m72R0KN8UPXGRI9OrWHqE3Khq2ynatwueWstycQgz6QqVAv7HKvWkhNW/juTXsFjGrI24a4X8wY6Gc0dS5g5IbAujbqAqm4lX34zOOtyQTK1PEf9txvVTV3AUqCHIXYdDhC05M2QsAf8PL6L7Hh9FBadXEt1Vhn6SCFWVOEyrqYFwn6RddYB/ge4zWm5qCz/2MiZKyc3cF52h9BJ5Of0bz7FFu8CaP+fBq+K3aoYf0b6G2+a154KlKIftdfpgslDcr2Y3s+bUorxyPzmHAlzEJe8X6+BpNSKO74knTA8CeYrrRyzCZo8IutqadCXO5uSVrCK/DzbWUlFLobv8uvJfOO2E6H3aSsporEa2f+0CTlfP1Beyj9jIoVOXBXKe4gkgqbZpJp+CwBZ42+qsCqW4AYr6FAUbFyzMUSkkVoRsw7CJognny5hWT0ywiK3dt1g+9iOL3KB2dlr7sw9gnTlhult6bVuml2COQUFMMZ5n9pVbDLOdT9iO3EGl95BEpRUceIxZCi7QApPZtjfr2bHgaQz2tNbjcapTPNpf7CQOcs7FuibbEKbS6fmGL3eHrUNnj1loSry2cKZyr5+571nBRZUViRvt5j6oo0FMVg1DGWNgm8iPwnz6mlM8/LGaknhI6iMwXxvXJe4jTC/LcDqkrejiPkNRLKpUnqB/eXrFZDn3mh1CQdRGSzsqrZ4IVH/w8+hYL",
            SESSION_SECRET: "AgBHzPFXYd3WJezPRBsfa9iiQ4FFsq1XOpQRisPXF/DEtIivrHltMmrrt5XyU4LP2jjRBUIvk3dVdadpNoceDnVGld6JJOEjYk0GSSi5HVXcfg0cxwUhGm6tU8oFysFXAG0q2Y3dnElq35+gAWXdU7LheZLan36KUIrf767eDaZWgxPfyDAW1qB2gaGq2sWW2JH+UAD6DS/vL5ywdoMyLGFUdF/s73y/6qx06Oh0BwzrsCOzxB1+Rl0BKV7I4yVAuWhy2m7Iv/6+DoStL3QlQeM590KXLzgcEclvRfM0SxO3bzJ5f/BSPohdap5pB1jxD4qu4PWc7lDE1/ik0yDsfftyfdUAuXdlyihgQRq0O7UvQPpT/gqSY3waT3QsE89uWVd3EvN+noMPC4FugS4AeqAQOWX7cj6qFUkX61dzhcPHUz0CPmdCgRm7TDWCTnw9LbLp9fRIofHtukaHrzHSthvyFRQ8mw9KIear9Kj/89eUzDKisMr3RKSv8T8SReHD3yydvkKLXMOtMVF5nka5Z8RFLnf5IBZ3Zkq51SSCvlJNqZKjF8suw+XahKxq+DUi3wb/vqQ8M7Rqv0ME1AGsE8pVMmRXadmJ8icu4hhkH3L3+7sq9HWoxJDtQ04nFEk72mvsOopyt2CbXejVTGUAX/JwQnr5JGVe/RV0lrGgpvOFPbG4fUYzWnyCjdD1UsDsZmP3+z3ATOWevoEtEeSnz0W04xaYmTLi4CuUYcpxnwq6vVfyeE41wAg+xwvrD3WZ9UVG6nqeJB+JTbUBxtTtkdsoDa/QrDeqhgJItI/tbAeUhGkGvisZiHhvWbjHpzDdEZMBRSXMitiWzsOCnHbGbYFJ02T5g5yCUJp1pCffNzp/6w=="
        }, { parent: this });
        const [mountedSecret, secretEnvs] = secret.mount('/secrets');

        const pb = new kx.PodBuilder({
            serviceAccountName: service_account.metadata.name,
            containers: [{
                name: "authelia",
                image: "ghcr.io/authelia/authelia:4.29.4",
                command: ["authelia"],
                args: [
                    `--config=${configPath}/authelia.yaml`
                ],
                // ports
                ports: {
                    https: 9091
                },
                // each key in secret is passed in as env var
                env: secretEnvs,
                volumeMounts: [
                    cm.mount(configPath),
                    pvc.mount(storagePath),
                    mountedSecret,
                    this.certificate.mount('/tls'),
                ],
                // probes
                startupProbe: this.configureProbe({
                    failureThreshold: 6,
                    initialDelaySeconds: 10,
                }),
                livenessProbe: this.configureProbe({
                    periodSeconds: 30,
                }),
                readinessProbe: this.configureProbe()
            }]
        });

        const deployment = new kx.Deployment(name, {
            spec: pb.asDeploymentSpec(),
        }, { parent: this });
        return serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            }
        });
    }

    private configureProbe(override?: k8s.types.input.core.v1.Probe): k8s.types.input.core.v1.Probe {
        return {
            failureThreshold: 5,
            httpGet: {
                path: "/api/health",
                port: "https",
                scheme: "HTTPS"
            },
            initialDelaySeconds: 0,
            periodSeconds: 5,
            successThreshold: 1,
            timeoutSeconds: 5,
            ...(override ?? {})
        };
    }

    protected async initialize(args: pulumi.Inputs): Promise<AutheliaArgs> {
        return args as AutheliaArgs;
    }
}

/**
 * The secret used by authelia
 */
class AutheliaSecret extends SealedSecret {
    static mountPath = "/secrets";

    constructor(name: string, encryptedData: Record<string, string>, opts?: pulumi.CustomResourceOptions) {
        super(name, {
            metadata: {
                // make sure the name is stable, because kubeseal may use the secret name to decrypt
                name,
                annotations: {
                    "sealedsecrets.bitnami.com/namespace-wide": "true",
                }
            },
            spec: {
                encryptedData,
                template: {
                    metadata: {
                        annotations: {
                            "sealedsecrets.bitnami.com/namespace-wide": "true",
                        }
                    }
                }
            }
        }, {
            deleteBeforeReplace: true,
            ...opts ?? {}
        });
    }

    /**
     * mount the secret and provide the path for each key in env vars
     */
    public mount(destPath: string): [kx.types.VolumeMount, pulumi.Output<kx.types.EnvMap>] {
        const secretEnvs = this.spec.apply(spec =>
            _.chain(spec.encryptedData)
                .mapValues((_, k) => `${destPath}/${k}`)
                .mapKeys((_, k) => `AUTHELIA_${k}_FILE`)
                .value()
        );
        return [{
            destPath,
            volume: {
                name: this.metadata.name,
                secret: {
                    secretName: this.metadata.name
                }
            }
        }, secretEnvs];
    }
}
