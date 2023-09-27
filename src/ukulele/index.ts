import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster } from '#src/base-cluster';
import { SealedSecret, ConfigMap } from "#src/utils";

interface UkuleleArgs {
    base: BaseCluster
}

export class Ukulele extends pulumi.ComponentResource<UkuleleArgs> {

    constructor(name: string, args: UkuleleArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Ukulele', name, args, opts);

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    CONFIG_TOKEN: "AgAl0xpx5ToqEGlbDo1U1ttfkux90fzCT74jGeKg19AsFKc2lzZHXWfriw6EyjSE33TUW1MGHc75npNfPmk3EzJQ2VRdMkF0/sTb/WcfPls6muiHl+yiuI30uPsH4ibbe1p1/XqHcBnqMlT6AUOlRFGpIpq87x7e2b5EatcdXDPpc4OCvzZamauHphLmZ6DVzx3LlPEkc7DT7lIL3InOI+wrrTGfwlpmA5W4RlysNEV5JWQDviSyOCfHTYvyj9+UeXYCzrUHO4RAsTedrUCJbN99D8ont/ikCrH4+WJy9Taxju3Osj5xOux3r/0gCo38Sb6/gTtCtStynUkqbbjkksv5zOaYerfhGrTVQLMSh8PsW29raajVAK7ayaQXZsSPv9YMvY6t5v3qbaeuA8VP7Ziuw49bzTr/B0+ArjtdWDUoUxj3KnioVEDpzxtyQmN/aPkX2JU7JkWbT8jsorMmkESnCHdNL00isVUAUnmkUZujOBdom/EXP9T5Kq5xEiXpKSWvLIKOXk2FcCJEdwjBK6jiFNumnOFhwx6sfuaCC8oN1sPteZ5nAukQIfbrIfS1tepV+1zN7/CFqABmwSm63h9S747zhLAnAWnRhbGwE/9Yekawsw70PBDR1KvYlBnJg1esZ9wvgnaOc471guI066ESCtCTXVVYUX2HWgLFjm6sCa9heLlEryedWqj/+wRNVNbt/fOHC19pRn/nvyw74hRqtR+ORfrCkPdFeAUoCnD/PJpfblSIi/d47fnrldN9BCbo55fLyL2KW9lJyQ==",
                }
            }
        }, { parent: this });

        const cm = new ConfigMap(name, {
            base: __dirname,
            data: 'static/*',
            stripComponents: 1,
        }, { parent: this });

        const pvc = args.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "50Mi"
                }
            }
        }, { parent: this, });

        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            containers: [{
                name,
                image: 'ghcr.io/freyacodes/ukulele:master',
                envFrom: [
                    secrets.asEnvFromSource(),
                ],
                volumeMounts: [
                    cm.mount('/opt/ukulele/ukulele.yml', 'ukulele.yml'),
                    pvc.mount('/opt/ukulele/db'),
                ]
            }]
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            spec: pb.asDeploymentSpec(),
        }, { parent: this });
    }
}
