import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { HelmChart, SealedSecret, removeHelmTestAnnotation } from "./utils";
import { Redis } from "#src/redis";

export interface JuiceFsArgs {
    storageClass: string,

    namespace: pulumi.Input<string>,
    metadataStorageClass: pulumi.Input<string>,
}

// enable format-in-pod which is required for data encryption
function patchCsiNode(obj: any, opts: pulumi.CustomResourceOptions) {
    if (obj.kind === "StatefulSet" && obj.metadata.name === "juicefs-csi-controller") {
        for (const a of obj.spec.template.spec.containers) {
            if (a.name === "juicefs-plugin") {
                a.args.push("--format-in-pod=true");
            }
        }
    }
    if (obj.kind === "DaemonSet" && obj.metadata.name === "juicefs-csi-node") {
        for (const a of obj.spec.template.spec.containers) {
            if (a.name === "juicefs-plugin") {
                a.args.push("--format-in-pod=true");
            }
        }
    }
}

/**
* juice-csi-driver that provides cloud-storage based storage for the cluster
* It has on storage class: juicefs-sc
*/
export class JuiceFs extends pulumi.ComponentResource<JuiceFs> {
    public readonly storageClass: pulumi.Output<k8s.storage.v1.StorageClass>;
    public readonly chart: HelmChart;

    constructor(name: string, args: JuiceFsArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:JuiceFs', name, args, opts);

        const secret = this.setupSecret(name)

        this.setupRedis(name, args.namespace, args.metadataStorageClass, secret);

        this.chart = new HelmChart(name, {
            namespace: args.namespace,
            chart: 'juicefs-csi-driver',
            version: "0.13.5",
            fetchOpts: {
                repo: "https://juicedata.github.io/charts/",
            },
            transformations: [
                removeHelmTestAnnotation,
                patchCsiNode,
            ],
            values: {
                // we create our own storage class to take control of secret creation
                storageClasses: [
                    { name: 'juicefs-sc', enabled: false }
                ],
                // change the controller and node plugin reousrce limits, the default is too high
                controller: {
                    provisioner: true,
                    resources: {
                        requests: {
                            cpu: '25m',
                            memory: '128Mi',
                        }
                    }
                },
                node: {
                    resources: {
                        requests: {
                            cpu: '256m',
                            memory: '1Gi',
                        }
                    }
                }
            }
        }, opts);

        this.storageClass = pulumi.all([args.storageClass, secret.metadata, args.namespace])
            .apply(([storageClass, secret_md, namespace]) => {
            return new k8s.storage.v1.StorageClass(storageClass, {
                provisioner: 'csi.juicefs.com',
                volumeBindingMode: "Immediate",
                reclaimPolicy: "Retain",
                parameters: {
                    "csi.storage.k8s.io/provisioner-secret-name": secret_md.name!,
                    "csi.storage.k8s.io/provisioner-secret-namespace": namespace,
                    "csi.storage.k8s.io/node-publish-secret-name": secret_md.name!,
                    "csi.storage.k8s.io/node-publish-secret-namespace": namespace,
                    "juicefs/mount-delete-delay": "10m",
                    "juicefs/mount-cpu-limit": "100m",
                    "juicefs/mount-memory-limit": "128Mi",
                    "juicefs/mount-cpu-request": "50m",
                    "juicefs/mount-memory-request": "64Mi",
                    "pathPattern": "${.PVC.namespace}-${.PVC.name}",
                },
                mountOptions: [
                    "enable-xattr",
                    "allow_other",
                    "writeback", // async upload to cloud
                    "free-space-ratio=0.1",
                    "cache-dir=/mnt/storage/jfs-cache",
                    "put-timeout=3600", // allow more time to upload
                ]
            }, { parent: this });
        });
    }

    private setupSecret(name: string): SealedSecret {
        return new SealedSecret(name, {
            spec: {
                /*
                 * name="juicefs",
                 * metaurl="redis://:password@juicefs-redis-master.kube-system:6379",
                 * storage="s3",
                 * bucket="https://works-unlimited-code-jfs.s3.us-east-1.amazonaws.com",
                 * redis_pass="",
                 * access-key="",
                 * secret-key="",
                 * envs='{"JFS_RSA_PASSPHRASE": ""}',
                 * encrypt_rsa_key="",
                 */
                encryptedData: {
                    name: 'AgAWELuoGXcv92S5HOzdnWIWxIaKbbzwvUNEA5sATIlhHTzhgYjAUZXy2q305wcSCk3cIghkdu/QjLm+5dY4vczv0UprO2phrph80XHaSvMFPvfLq5jgt/v1NBse3YQlJKdfgakCmWFdsx9Wa9kXZAEVvbIVPoEQ0A5xKERDnYCVXqeRDU02vncwPfiNNuOhAG437QG8gYv8Nt4ncgADpXTQ+e9n+hmIPau1D/1Ai3/S2IJdjObYQk4NbHPy+AP85CFz6lYG54dNZi81VwQwois/SlKLY145IHAb/8JLvABf3hsJQU+dYkMUpa8ozxwq96JWykDt/hCthPDEo2etBn16+ExdgyJIwAIevCxvnjTXTfLUuHcVKDv1STB4qeBvdjb1r/vu7TZwnQx+hXrMicmSxdGH/dHe8I3Mijc0MPzV7vjBXl8awhjjEXA07POGfDDr/5aztNcoTimv2gpgO72/s8waOVI1JATO9E5qDKseP6cZ7nZ4YK8Nit85Ag00ztCdlYtzeETz97HHQ1eB7BocGBdHP69BgH4Rlw/myk/jY251Ike46l3rGyvWP2CQe3+L5OVim+N15j53waMLJ0V46/VZj3MLdsBbTkq3p57GU8hzc9xAMs0SXy30uuwM63vS/VNh9NK6RsAIa9/V2jZV2hdiBx0PSHEOcOrOsIaRZuH3xh+lze/l6IkHaTQeITms82wErutP',
                    metaurl: 'AgBSA0hqkaJ9ci2+nghenPXi2LtwP8BrDAf/VMhQyJHl1hvK3ccADt+eY54tCQlJ8dsWquJeATxEmFECTrfTFMF9kDM8sl54K5UbTCj3jvGLXgjA7vjYsa3fYbzASzlwnWVL+RatC0T46hR+W7v+jjs/vWYhAqiueWnBWW5ExtrPJi2D8cEMxCVmCa0iRA/kPxgRL4fOZ03n2ZcA2p84xxzfofuywhr/X0iF1ARJEAgijB8XPdJJK7cnez/Q6QcR9b6TzPqDeGUQSzrnKE4+iOnQtn08lNh57rU1AVyllyTTYduKlFMrYKkl0qFodZIY9+ONJM4ZJ5QKpHCasGQux4tM9lGwPTVfIADkzlBruZuYPgR/KmHurMKOxnpU2wRjsIZH/5oK7tsoctBt7AqbGxYYjMIJlMoKOhXm/o/ndeu6aj8IYFBaOyN/mQOCPHiQvi0HSPCz315u25W5KmSa4fQHXmw6O5BMKFRfEzuHvlVtr/bDniSVJdpbaGWxLQbagUi9Cnd4j5bA7gRoD24zi0+HCi1ceLmcTlhLWshS1b8HQHgXqvTB5qpr1OxeKMpxVMrgNxmCCQHkqHzZT0nU45Ymkwh3dBu7CEgFia6tEcQ4OChNhDDpruxYxVjhJFxeYXk4H/hrmA+GFtIUCd1XyoCRcNqyXUSBe8vkaPtRAfJo7zKgjGu8WKjVKrZA3VmmQpDDgokDwWaZObE7HjRKQrKgjvChkEkB19IctdQMJrc4VnwJV7qU5rbjEgNFn/xuQ6UY1n+PDlLJuDspTAnywCjHEwc/I5i/+peiSMuFURgueYa6oUX3HfE=',
                    storage: 'AgA3W1x3UbF1jgyK/tLWWD4y4laggfWqZT34jK/GuXChyw3n+R0tr/aGs3PqBa5v5I3/Z9MSEIF5WrFGUL99JohwtUR3GYcbL2h2oeI7AK7OmDcoXEffkB/PUSflhtWEzOdP6ezqP9d8pqHu7pL+r5bISc9MW/YeW7a0AWPDEQn2uVHZjirkJvocCvRgl+UYKzGLCi8mO9mKYIOyu1eC37K7rVxbuzaPc1pPGP+0rq+BAhV/2l/2VZl6Oc8WjQVobyPRz91CyCItnUsanL1dBIuHnIGlYJc4I7xLGLj9kbForv1NRmR6jeHw9Mzs9SbjEWhx6azPqhQPdmDCUSaffy1tbFudMIBiM1qz2or1JFiJPvpFsiPTnpU/29KGlmxyAcsJkiS17vsmwqEWCaoboYowiGcDxpxcMyiI6P24LbUlSiG/whprDe6rSsnxTDSgmx3dHOoOoK6jRe+wevE/ie/ftfNyN6c9LF8berjnKp2Yt1bagO00WAiucMa/XCff1Ph8vRlVB0LItfiPCwbbR/8UjxWD9GT1cSPPWMFZLoWVNPzl218Z31Cd9SMwx9aesH7xKwfUBm22Fgkjfp8oUtPPN0DrI+MXTssVvSdYlqUa+klEs2LI/dAiIh+5y+jxz+l83A14L2YpnZPpH34FAN8gHa1JZck8xM7YesR0h8AV8ACuui3XNSKD3ZZE0HKxncjpww==',
                    bucket: 'AgCMratYJ3sGBKm/pqkw12szb20Ego+FLM57kV4mnzlx7FW9Ut2j27rfvLwncDL85CBqydaoDeLIvu8oE6yPIhyMttFLaLTRa6Cyq4DtAUnT9fCxr9HmFU2PHxN2rM0XWBG46/qTvy43t1/MYpMDZ3zr8wVFL10Hb9FfDYyHjgCMPjS3BIUJRsHfSNOQog16FC8F+z2ClEWGXHtPvdghoskS0Fl9QJWEBbxmjPTIVhSr4hRFAUods/0AqY3bAZvnn753QwwIS2yeZxxUO6OcdDA/9nJOuDzSBRuVDn1B1f3bhRkXROcFaQvTvgHumjhaT9XSGiopao3Gekuc1iokWXIPubJISsp2khXkEn5Tq36JZeNsU1lxyQYah+mMpvp7CEdNEZ+l2FwkudTdMk0r1qPsQbUxkxedSmzSuF3CGrk+vUTPlDy9eqBcMljRcfPEXVuiozEA4RTgrrNNIa4op1B4PC/v10i/3nmx8r8iMW9MDRP4nlCamPwCMTT+EgBMSyLx7fQP8bqOWSmkbe+rnE6Aj/ClrNGQtW1daNng8jvCUk/Ej4fVkPMHYhuTXTSc3RN0/uuf/Nk5+/9oVlZrTsz2n4E+e1BBoIX/4ahG7PmhYo9gKwg4Oby5xr/w2fDrbgQgIhv4RIVmksUdtDho4MteGydwel2N+TKuQhf8CCBDTnglhnWac9dS4aQiW3duS0RXIUmuqBBgXnNxK+xnbtC6BxMvcfNc3szWZTWWXZgcyHT2MlMUwPMrKv2+u+X6OgLIl7j3vlFH2QzgKg==',
                    'access-key': 'AgB2t0bg6g9HcZhXfvDo/7D8AOUmOUB5sRfiV3UxZZv7WMjhz3GZ3G7sQP9KYQ7CUSNsM8H4OgeFmsILNk6sNntUTFp4aGCm1XHupYDNv/fEEoNLB/gdGhjnJ/eIJYMcrDzgY4LMui7iKjLkamCaHtE2t8hZSzODm0mctoSftFHX2WDaYr/WvPtVeoQevnqQiJe4HVVW7TuFQTPRhLC8C+3v+trQ+JXPD+VSSCuA1izYSg7Rs6vvcywO9OK7RgSQ7o1rwf5ejEUbznX84aR8LY9BuhX3IvIfxa+XFc1uYVOvVeYr3DnRbuj0M3khqADIP2OwF4THcglfG21Vhc6zg+D/VOEMpWgsZSOsb15FwqFwViYK7DsEBnh6dqjk2pO350cuiu1UmW3eH4xazRaiBmRiD3Q2u/Qe4vRHNm5QvejOHD1GJIdkUnBPAMcpyPCm2sudUhBk/XIwqf0znXAWaqVGJQPBzrjSBHa8eoyULNC1FvZpRpek8RGIpX31SQyRvvfKe7LSwThaWPxgUZqjqPY0fydxaNRAZDAnuII2hwmcjDSIfOvKuKfT+2rGhCrYf0jvo2AYRUIPgBT7N+V+EfAYTgvo5blOeTKs260kQf1sPFQfdCzgkQKVLRiogSyH20agyXb6AHnkl9SXTCI+TKpjY4IML2OF5dRumQ2j9Id3DvfR0KCso5RauOQnrsxyHaRlVQKUZt/jZoB/L7YMKj4QNvN2Mw==',
                    'secret-key': 'AgA9bCG3F6gZdc11P8O8ySVzHvp5kJS7SlkZJYwd9x0CmP0wYk6DzTbTc8QMNfLkaIYjPlFahJLcZdIU4w5+2HunZ5Ox/dwSW6cXcHjsUv6BjdqcRmCWu6TpJgAnxAvUtg2LtNXgfFGKi80zsFyP37PmA1eY5SEo+UeuVjYkvkKKHdb4KyO60jR4N8TW5cHV1HxkGsR1GQz3FmQTtaSGvRadFiA0pMZsr2O5AzzD6kzDLOoIQLqVjw0xlSKhnpk08r3nboh+Z/keBbOxrzmW73iXggLs+sXsPkFxIKHmwkKV4FZIjWZMqfItm0jAHjRSIEoX/i/A3Af2exfmXj2RXAjE5iSg9UsSi5cZrqcE+f4QN7uFFkgzc8v2nf9JreptwWqz+kB9V+K8YLlZNCEeQ9o3lRE8jd53T9qzZInz84FCoHdhRdreL2jOvpKYqns5faWN5OzWRSLHDK+GhvUPVKxxY1/9QR0daMrCMIzry7Ds1dfvLWOaLHvL9Up/4UGKNJfMdxQlmfiUlJ6sEwySEDTluT/FOcI2ANbd8r7T2Th/RbsR84I8/Q8HsPv1s6aWikvbXA7jcq9Df7qDp7ewMLOXGAm6srSAHkWuwh2Td37iUXJ3M9PAbo/GPefKt8S5Ox0oSyQFURImWBYiLcyUEqc8SEybVwmRgrPkSGGJg46y0Ux/D4NDfPVelCvPDlq9+MtxkJWSWgtEJGaEjRfaynEuOwRHNWulr3WfTHf0OGUFUyh9C35Zb5lx',
                    encrypt_rsa_key: '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',
                    envs: 'AgBgoIOYw6XLqIpRdN42P0DBRZv85SZ+tMUlhcmp4GcwRRbbsp7RYa+SHLDRPn6koZcWSzaMEAzxIAxlctjmgXw5eX88ccnLs6H17HYo6bQYUANiJqV0tvEVgEnzaGoa+sfFEHfyAyUa/v+qMuRiYy3r+ZeLXHg4K/x5E0dLKStuEGzqDwa8jv6j3jDkrGA1uN/A3tCEQ+RUMHO6wl8ZHmwmz55+5Zwy8Cn9hJVjTcFsvwe2QO35/yCCxSfPfgfW9lPktFEU3qzlnNhLpZ9qY6um54GHTzpogSP/9f6awGW5TkyvYXFT5mPSrW3DbxYevl/QNME7IFtG2M7gLw3iONIhg8PQLLLl1+9xfSVXcklqOl0z88nYOnxQ1GDA1donE9aUOHPJUq6PtswmxJN6ExZX3jF9VVQn9R5+G65xnXj1Niy7UHtbv4+Q2FZxkR6gkfUZ25rKLfLL4GPyRLZe9TAXu72YeaDIOGtDtar6TjQrslmjUaTIzdCq0Cgd/hCvSxq1UJAdvcIjm3qU7AkHBQ9M/izHApRF7zsIt6cFgJzRPdhc18X3MEMfIli3YnUK55QNUUMS5zdvfSHE4ueFGuYLw2hD1lhKBwpPtnnbkAKIohorj/+ofBTxMLGJztXUUp7vYlkP/aKJ73viXiVo3CArq64RqbPAY02mrHzFFtwUfhjiXOczKUwAzaumI2tMokUTt/E+kz9vII8JwfrjbgdFqNoxSq2JYXF9CMpJ490DFYAI4U2mwcxCM/g3im42xbYeMYxporqSAI7YaTO50y/nyeg=',
                    redis_pass: "AgBI0jhTTppW89w6jiapNmb3eJNiHpD3iT6UrIJFBmFUcrMZpoNqeDVRWIpjL4keRRfYrVhb9/Ra8CLDwOr5D9OlaDVdhu2sa9BMTD0pR91wxYZnIR0/qv7DnlYSe19e/09T4Ie3mfdFySEVN+qkypvmSGxKjd1ktQ1h/SkWHILxLeeMdH6puwzremHLkQs/BS5Prm5sLBJYW9QNuutGlMKKv2Wuqcpw4rkuqN2/vDgWJShIEn+sQ7QjOTLnyUHGMpPZPzXEB21z3HKRkjQyKqgCH52/Cgqu0QAK53T5W3J4X7AXzDGtDtdYLlzOqeAEqEIJv7NgcezJTNIPHI0qQGttjJiSP3qCn4yuqxQsp2Qf0j8WOHTMMwst/cwVUyctFrln1hGQqL7ybJxjTRQkIQwIugL8q2xg1SgG4knBK85BKsysEgmeOWYa0IA54wD8KZ3oR4MdZLE68nK3BImk6FN5dIl2fYWJ+hjCJidgMHHE/UMHv4OJxVFHqG6DVGd04UfIR3E55k4ftUHvU4+vvb/3GzTdFiBuTelT1jekQ7EpHVY8aJ/CNvTtFfefiE9td8KowR0Jn7epAqojTE1D15U80N7ESzTvrcw/Y0hlU8K18l3SzVMHGf/bdk7Eaa1Dkxy9bXwP2wq+hG1u3ohy2e70wx/L97xQtlfWY0VUAlCcSGnNTOUWxdh0MUoSBZ4qdYQ1SWoaGqtXLkc3Ck/H6J3AYyc2pS9xgyN/9IAFEMJaI4Aw8jKx1LFu",
                },
            }
        }, {
            parent: this
        });
    }

    // create a redis instance, and then create an ExternalName service, so it has a stable url to refer to in the
    // secret
    private setupRedis(name: string, namespace: pulumi.Input<string>, metadataStorageClass: pulumi.Input<string>, secret: SealedSecret) {
        const redis = new Redis(`${name}-redis`, {
            namespace: namespace,
            persistentStorageClass: metadataStorageClass,
            password: secret.asSecretKeyRef('redis_pass'),
            size: "8Gi",
        }, { parent: this });
    }
}
