import * as _ from 'lodash';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { SealedSecret } from "#src/utils";
import { Serving } from "#src/serving";

interface GenshinArgs {
}

export class Genshin extends pulumi.ComponentResource<GenshinArgs> {
    constructor(name: string, args: GenshinArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Genshin', name, args, opts);

        const secrets = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    COOKIE_HOYOLAB: "AgAO69rI2bXl/jK99Ni8W4OFUBmhEIVo6hxciZ2gZEI9hFuTKNNxioj8Nl1xRC2i2/E48IAVK4U1pY067KY7r2k45EboDjRtqwmy7HOGJscBEUIQPd7X6h5uKu9GtZXFIrDDepVNNNG6Xd/dW70zEaEqGKNhQ7YZTq34aeVMNUfgTlcI63BfM66Mv+s3G5H1BIeF7xliAZN1s1FtYmc2SlJxJg5uklKUF6WMJuXnbMnqxcjZTBFO9Wsf8C/IREqxG7euibFPU8INea1Pnh3l1HoXXXy34mmLfwhNoN+PT/QKsf+VCaDeFWbOKnFKt4D2uGtgiyOpUZ4PDGZLW6OUDsUjkG6czQIVuA0/MIr0bnsBMB8LZ0dU4zKtfmc4zd3z1nHQxn6FA7GyWMuWNXwtB9/pSQX0Uc+BHf7lNZDI4nPPGA5TXlyd+/WvEL3QCqyndSDjmXa5KdLH0+I2U0IUsH8se1Mkas+nCQOxfmwdLcD33Kc6jsOXWdEN+dB/wP56WgVp4bE7YCMQ6+E6XFSpCCZdrxb7LPel7VDJtieuZr9dJ6DEf82uOtzzQBTadKgEmAblzeIs1pahLzUu5AhiDbd/ToG+BjWf0YUtyF696kL8hk0EAI1c+lCJFAK5CW/nTxGmLBHAs82pa8b2re7jTlCVrEId2CMy3gm7R1fXqwVEYz9UBODgoZI10XMv/KeN2TqmcsecDlOrsaQM570RV9MN6vf1Y+KF+4HKPuxkK7JFyvSDAJsf4/9VsJEbER879IG05FMpCYDrZ/+9uwpMFNKLj7YXNS7glqMN8hVf2zbE11ref5JdLWXw6iXZT7VCI0yrBT8+3c5BUPKvmsoTcVl3Mw0gBTcim8wm6D0U4m0cWea0/lHVhHYTDo2qUh9p0EuHNL6lfa5f13QsWbisfY5bdFNAmC0m1jgsj9Px4MWyCbvHUMNrt/GN+2XnnbmKrUfviMmTMc2CSezfcpS8fAD5ulqyDETPHHAJJm3mpqb2GO8cVt6N2lhUzQKxMLu7GihYetRQC7HKvM23QQxAYUvMI7ro8uAaX7JG3/0+qnyIqlo6iCHIqmR1RvYz4lT8+OYcr9zcdKSli0524nV2zVl+xtxT2jzHe+5palg8sb6H7lJZYFaKHwp0Ckrp3OA=",
                }
            }
        }, { parent: this });

        const cronpb = new kx.PodBuilder({
            restartPolicy: 'Never',
            containers: [{
                image: 'yindan/genshinhelper:1.7.1',
                command: [
                    "python3",
                    "-m",
                    "genshinhelper"
                ],
                env: {
                    LANGUAGE: 'zh-cn'
                },
                envFrom: [{
                    secretRef: {
                        name: secrets.metadata.name
                    }
                }],
            }]
        });
        const cron = new k8s.batch.v1.CronJob(name, {
            spec: {
                schedule: "0 15 * * *",
                concurrencyPolicy: 'Forbid',
                failedJobsHistoryLimit: 1,
                successfulJobsHistoryLimit: 1,
                jobTemplate: {
                    spec: cronpb.asJobSpec()
                }
            }
        }, { parent: this });
    }
}
