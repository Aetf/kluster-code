import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from "#src/base-cluster";
import { SealedSecret, renderStaticFiles } from "#src/utils";
import { versions } from "#src/config";

interface EmailProxyArgs {
    base: BaseCluster,
}

/**
 * email-oauth2-proxy: transparent XOAUTH2 bridge so clients without OAuth
 * support (Home Assistant's imap integration) can watch Gmail label folders
 * without an app password (Aetf/meta#10).
 *
 * Clients connect over TLS on the LAN LoadBalancer (port 1993; HA's imap
 * integration is IMAP4_SSL-only so plaintext is not an option); the
 * proxy speaks IMAPS+XOAUTH2 towards imap.gmail.com. The OAuth client is the
 * same GCP desktop client gmailctl uses. Tokens are cached on a small stable
 * PVC, encrypted with the IMAP password the client presents.
 *
 * First-time account authorisation (and re-auth if the refresh token dies):
 *   kubectl -n emailproxy port-forward deploy/emailproxy 8080:8080
 * then connect a client once and follow the URL from the pod log.
 */
export class EmailProxy extends pulumi.ComponentResource<EmailProxyArgs> {
    public readonly port: pulumi.Output<number>;

    constructor(name: string, args: EmailProxyArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:EmailProxy', name, args, opts);

        this.port = pulumi.output(1993);

        const secret = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    account: "AgB1ZiB3WGaZopWLSN9Jm6LgJcwPwg/JMvRoPTQ77P/iqq634darYpjWb6I2WqYFVpI8lcyI0dHAcA1cW8uh+pQPbw70FuY5DEkatM/mCeXtiAqNV+cDy+1gBSa49X0au0ehaqcpnINkxkSrgjIMwlWCLNzZV94XSdOr3JyWTqBS7AjxTOInvgYzIFHVgNYhyko1JVp+BBd/Nv/ftxeFlNj8OqNZ3VVPYHQW4eKaW6U73ekjHfaCDRFwjt7zLfm2VhwxCzNN2dW31yXZdQppedl2RsXreAXhj2lh5vWmDOyRSIKwrCMIhLUwSwWzp3iG+bMewYKL+4e9pCoPXhHL6lR3bzSSJ4XhlXuXxm1RTakfFIPP+srZidxrSxw9jBYvJo72kkTB+KKJwJeOcW/Ydw4C77f2iNkDkNbCcN7Orya6abnC+PXUu+kLabMf4yZ4uMCIFPjTfF440LcF2HjzTMLohRFaOKOHethZP5LksiiEpUy8wGkzCswwxr/aQqU/v7nmflltK8q4QHSHS6FPY6sDI9zoWuOhh5c0VAojfgfsnJB1g0jfcNvHcJmATS4ez0a4SlS2he+YnY9JrKsrKCTFrtXA0XiAuh1u7DRBdIA1uX99rc5yM2Gpo1kO7tKzmGXLOFqGlr2efelcprDgxTGvnDmjQg5MfLJc0kQ9MFOEOMYD/UYRu2NcPQgXu/kfc2wgqBGkfLQd0D5kvysnDBUYmQ==",
                    client_id: "AgAIPGLzKe4/YL1S0T7XQ5hJYkGLJIlK0fAHAKmIhPSBzOEBzFH02TUtqH+3MxXEI5qirPfG8j5okCkHtZFXXUpyUbraTe6tKRL6wRLlWWiETGmmHhuZSPyLpEVI4SNnQ6IF9ug4n8mnqhoVr0P0VBugSv/QjkjAt31BST8uSndbKOQs/39FHpbJjDpHiHl5oUzA9kXZrrGYVUBqbRHXVUbrFLTdSxQY9o/excf3B3srLf4HZp02wbvqtPFWAn2u5zIL/78rmEenAKlzcsqUYC+6rseMxhU4aeGAKHr1jX1wCzMcJfuYsGFu8Eji2ZaRQhHkXikWnM1uifjFzkNCJvdF4Cp6zsL7czVSUNSg9QU7SCNP0mmfMAROPvweTHpbThG3CYeK+K9WcLD0KZHWSDxOFMS0Oi8YHO6O3OMim4ysCQVzyw/5hPVs8NMpyzwB2tGH9QMU0r3NSweZHB0z1TfSCUtJxtk7YsXmcWJSqa6axKdKdS3W6sZ3y7RcAKe5xtzlJipdm51F1MNlhhYHLgzbyQP32U5YhSLIY44LJxAkrhbqCMmBSWgJ9dXHZNaLdwiugFmdZ5AKGdHXLXghgkdM3HoDujWFkWQp8ppxjFFu0jk8Q+SsTYK9VwJ+Njm+eLWpIRGjaFPNRL0oJrX28FXa1Zh8t+7B+aiEf2LFQlNcFi1B8C68LJxVjQV7rv8z3p+h2juO2l55awkP/JbK/pk5bLByIncLtrByi7C4k/CgVEckoMJ7B52P/Hy9wnosRPKKw1T+RfuO00cm4sJRrrp2yVRhMifwf/E=",
                    client_secret: "AgBqwiJFrWanLgGHb+hFvD8CbqnlegJxlBl1UIa2xzQdE8EBpr1Ycz/H7aOjTsHJUeEg8ZVUgUzAFCTZLNYLaPjO2HjYVMWyNQ/cBIzsfjZJzMlU3V1taus9QKBQ+MssggAhOf6YRkz9r52AHPj21LLNLJkjUYfixe4Jua25sXnyw9np+dCvha9KXvWS8ki1o5OEsWlBYXHIL+37nkxO//2IbszdUgm63E+Su/+LBy8Af9uENRjJOlyvHwzwJi9Lj+YkWwGzlSVMUewWZuydqs19cbREYTtySFl147vhxs11C3HVbTUELN5S4NNjhcbt6EpvMpiH/Kv1iFUBTHBweLFB0VSMW9wJu8Pw546Gcg9A9lZUs0z2qgVCV0GAxVLwad8IDe4gOTM1WE8rjEStXW70h9I+QclvSB8z32B59F0cc/Yui6LoTLLoKpt9F09szKZqMUXVtZpENwTOiSu0G07gdB3g3gHUAcMgKhloug0A6YOKkJfvGsPzuGx91VI85aRGkmOwPabh4dgfxIsdrVRGbAiIcQTvktlEBW/aXL8FeCRE7vamk2Y9IFdlKmo/ZVbNYMe1ZYZ4GiXSHjzD1yEsnEdxNmGM801shmeAb0y3XeZbGtJnncOy8jLxWWiR8FB1C6KTjNXmhh9jaKrdWHUJUMnCeXHGcRcbvYUa+Uln7/lch1xcYw5nCEOwRBAT66pY6j32C0DlQFBRjrWPn8sdL1z8ItCcZXxX/r4jVjeLdH6RNw==",
                },
                template: {
                    // The plaintext config stays reviewable in git; the
                    // controller renders it as a Go/sprig template with the
                    // decrypted encryptedData as context. No tplVariables
                    // here on purpose: that skips the Handlebars pass, so
                    // the Go-template braces reach the controller untouched.
                    data: renderStaticFiles(name, {
                        ref_file: __filename,
                        data: 'static/*',
                    }),
                },
            },
        }, { parent: this });

        const cert = args.base.createBackendCertificate(name, {
            namespace: pulumi.output(secret.metadata).apply(md => md.namespace!),
        }, { parent: this });

        const dataPv = args.base.createLocalStoragePVC(name, {
            storageClassName: args.base.localStableStorageClass.metadata.name,
            resources: {
                requests: {
                    storage: "16Mi"
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            containers: [{
                name,
                image: versions.image.emailproxy,
                resources: {
                    requests: { cpu: "5m", memory: "48Mi" },
                },
                ports: {
                    imap: 1993,
                },
                volumeMounts: [
                    {
                        name: 'config',
                        mountPath: '/config',
                        readOnly: true,
                    },
                    {
                        name: dataPv.metadata.name,
                        mountPath: '/data',
                    },
                    cert.mount('/tls'),
                ],
            }],
            volumes: [
                {
                    name: 'config',
                    secret: {
                        secretName: secret.metadata.name,
                    },
                },
                {
                    name: dataPv.metadata.name,
                    persistentVolumeClaim: {
                        claimName: dataPv.metadata.name,
                    },
                },
            ],
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/search": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });

        // LAN-only service; no ingress, no auth -- IMAP straight from HA.
        new kx.Service(`${name}-lan`, {
            metadata: {
                name: `${name}-lan`,
                labels: {
                    'svccontroller.k3s.cattle.io/lbpool': 'homelan',
                },
                annotations: {
                    'pulumi.com/skipAwait': 'true',
                }
            },
            spec: {
                type: 'LoadBalancer',
                ports: [
                    { name: 'imap', port: 1993, },
                ],
                allocateLoadBalancerNodePorts: false,
                selector: {
                    app: name,
                },
            },
        }, { parent: this, deleteBeforeReplace: true });
    }
}
