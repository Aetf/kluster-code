import * as _ from "lodash";

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster, BackendCertificate } from '#src/base-cluster';
import { setAndRegisterOutputs, urlFromService, serviceFromDeployment, ConfigMap, SealedSecret, HelmChart } from "#src/utils";
import { Middleware } from './traefik';
import { FrontendService } from "./service";
import { Redis } from "#src/redis";

interface AutheliaArgs {
    base: BaseCluster,

    smtpHost: pulumi.Input<string>,
    smtpPort: pulumi.Input<number>,

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

        const secret = new AutheliaSecret(name, {
            JWT_SECRET: "AgCYT9tnsHJ+P1k7vFUXHc9kDweaIezXQueesrJXOpba76gRBYIFkZpAySuHLPtS9B6on+8104Yp0cfu58qbZMtQouSs9woZhDjKbe/WStjx3Znr2S7pMn9oE/0mYk3uO91Q3Cdo98l+gQYSXeqiCl1TYnVG+u+/xuxey+R6U278RK7Q7uuqop3IQq2QfpyIeFI4EJcZfKkr5+9hPe53UjuaZG0AFQt+WBXiR2a8O1y7acL9MJAOJ0rlG9WJ2CNLKJ+XNQt9Vq/QAWlPenRc5PqH7X8+5ZcxB02WXKsU0gU2cyUmbYoK8eL5PwTKGWoZNoJdUb7tgBEfkGASGnQl3OEu+KKvPRhLYAoOmfTN65oeCZCBl/xuW3WnYSmzImYLLqRLkMU4UDbVIXn/w6kaiU+/O6GiE3d4gjVXOeBN5pT+I9NuFAzNqirBH/TFJoyFYuz8eDcz7GVbpHZ/c5NqVh/tu1V9mwTPaSxSeHc2RKBsYo4y7q+WauJXZZk0AZ/81jBDDct3WE3ROhhwWwokaTtelGGxacaug5Ij+92bt9C3ZNOw7VA/vdnoh/62Fr42gDfg9/fIdkorE2ep0eHSMeACUm49tyUXozYaVggTpbQJxTkU0Al8/2QNCIuNQTRg/I2jceqw7beTtPBnR6fJ7BNFhPWhSXH9MKzCP/3VUDKakwdUl9v2u/bOuuxLeGTBAJAJuE6tSUrEcMwgahC/YbKbMo0fHjcBD7IdRxnrwARrh+5tF7Y3WlQ+/pT+k1J+1bXdwWgjq88GVPmY+uQQjwuZplfCAbe4GONDgtECUE/1NZQWgyIz04Q/J3NaN6fTuDXqwfviD952Lck73/Jc82vL3Qz9cABVatnmQMtKS91JTA==",
            SESSION_SECRET: "AgBHzPFXYd3WJezPRBsfa9iiQ4FFsq1XOpQRisPXF/DEtIivrHltMmrrt5XyU4LP2jjRBUIvk3dVdadpNoceDnVGld6JJOEjYk0GSSi5HVXcfg0cxwUhGm6tU8oFysFXAG0q2Y3dnElq35+gAWXdU7LheZLan36KUIrf767eDaZWgxPfyDAW1qB2gaGq2sWW2JH+UAD6DS/vL5ywdoMyLGFUdF/s73y/6qx06Oh0BwzrsCOzxB1+Rl0BKV7I4yVAuWhy2m7Iv/6+DoStL3QlQeM590KXLzgcEclvRfM0SxO3bzJ5f/BSPohdap5pB1jxD4qu4PWc7lDE1/ik0yDsfftyfdUAuXdlyihgQRq0O7UvQPpT/gqSY3waT3QsE89uWVd3EvN+noMPC4FugS4AeqAQOWX7cj6qFUkX61dzhcPHUz0CPmdCgRm7TDWCTnw9LbLp9fRIofHtukaHrzHSthvyFRQ8mw9KIear9Kj/89eUzDKisMr3RKSv8T8SReHD3yydvkKLXMOtMVF5nka5Z8RFLnf5IBZ3Zkq51SSCvlJNqZKjF8suw+XahKxq+DUi3wb/vqQ8M7Rqv0ME1AGsE8pVMmRXadmJ8icu4hhkH3L3+7sq9HWoxJDtQ04nFEk72mvsOopyt2CbXejVTGUAX/JwQnr5JGVe/RV0lrGgpvOFPbG4fUYzWnyCjdD1UsDsZmP3+z3ATOWevoEtEeSnz0W04xaYmTLi4CuUYcpxnwq6vVfyeE41wAg+xwvrD3WZ9UVG6nqeJB+JTbUBxtTtkdsoDa/QrDeqhgJItI/tbAeUhGkGvisZiHhvWbjHpzDdEZMBRSXMitiWzsOCnHbGbYFJ02T5g5yCUJp1pCffNzp/6w==",
            SESSION_REDIS_PASSWORD: "AgCppeKtS9/S+oJ3AgvODikhSWN0a1pQnoZFeotPbShRcI5kqkO5UAJENWjin2A6eU1WF5QqaGN7jIgUSa7ZI4OtAvdnqq/6L0cGDbxE0CJyfy8RObJwbC+FhQ9wNyjHNcwYTI2ET3UFTjLvbkSkpVwrpRKyYvc6TCmOTy0TjQ+o9Mn+tGdWqoTIO975wlph983vblUsiC8w8QUTfSZujtUoh3NYjEE8P+3t5ReLxuJD7hwrTGcTaIlo0lGOnrLBgRE1MIBUVPAnBqxJm8jt5L4mSv0MpN6yeNAj3+XHEiGG3YAI6uFLGUj4nUUBDrYr/Vnl83HFNnhUqKw2DOsXcxBQD/xPGCSnzRapgXxvIfM5bd/FAJmqmeGKuBdZYVxd5GuaYEixHq3RI+7SJYrhriml+pgllOtxpiLCPMzaPx0BJLHwtzoaNYxuTwFQ0I/c29EVU/i/ykjUEdB7ZxRVMon0nXpDwuQWTJmuS9Q7G43fcHdWOsuwQT84XkOA8bTsG3SMTXsChFHSB35nmTXo9KR8mg5n7cRhy0hZu+tHZAfNweL/0LKJokEqKLj4YYVU6bt346Vwr2PybCzO3/G9sfeTEMUL0XmJ/eHnhb/7vyWRC5wlX+xMXcnpx7yvuhl68OO/U6H+VwiF4+6+diwYwQ2MoCl76NVOi8cHJgl/zWu1KfKx3GHSjf+rLN5c+lrFhM209JNkekv7TBW3zAJqPCVl612+WhL7Y65+",
        }, { parent: this });

        // redis
        const redis = new Redis(`${name}-redis`, {
            namespace,
            base: args.base,
            password: secret.asSecretKeyRef('SESSION_REDIS_PASSWORD'),
            size: "50Mi",
        }, { parent: this });

        // deployment and service
        this.service = this.setupDeploymentService(name, args, service_account, secret, redis);

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

    private setupDeploymentService(
        name: string,
        args: AutheliaArgs,
        service_account: k8s.core.v1.ServiceAccount,
        secret: AutheliaSecret,
        redis: Redis
    ): kx.Service {
        // persistent storage
        const storagePath = "/storage";
        const pvc = args.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "100Mi",
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
                smtpHost: args.smtpHost,
                smtpPort: args.smtpPort,
                storagePath,
                redisHost: redis.serviceHost,
                redisPort: redis.servicePort
            },
        }, { parent: this });

        // setup the secrets
        const [mountedSecret, secretEnvs] = secret.mountBoth('/secrets');

        const pb = new kx.PodBuilder({
            serviceAccountName: service_account.metadata.name,
            // avoid polute authelia environment variables
            enableServiceLinks: false,
            containers: [{
                name: "authelia",
                image: "ghcr.io/authelia/authelia:4.31.0",
                command: ["authelia"],
                args: [
                    `--config=${configPath}/authelia.yaml`
                ],
                // ports
                ports: {
                    https: 9091
                },
                // each key in secret is mounted in as a file,
                // and the file path is set in the env var
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
            }],
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
            spec: {
                encryptedData,
            }
        }, opts);
    }

    /**
     * mount the secret and provide the path for each key in env vars
     */
    public mountBoth(destPath: string): [pulumi.Output<kx.types.VolumeMount>, pulumi.Output<kx.types.EnvMap>] {
        const secretEnvs = this.spec.apply(spec =>
            _.chain(spec.encryptedData)
                .mapValues((_, k) => `${destPath}/${k}`)
                .mapKeys((_, k) => `AUTHELIA_${k}_FILE`)
                .value()
        );
        return [this.mount(destPath), secretEnvs];
    }
}
