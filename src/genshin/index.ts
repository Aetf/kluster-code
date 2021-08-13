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
                    COOKIE_HOYOLAB: "AgAASjGq3CVWRhbFMEDuwt+NqHlDfhIwTPtQ1Ql05kYM9qwjtP2r/KAQqHekz497ZJrUrk5fFv5XTQeT6rEKviI2MeKAzTtWDvucsnPT+5GC71Y1qKjL4fAeONMVBzaX/sHzHFfP1vUrWscNDlEll6Zvx1fORTjh7tk+XHr3rR4o1wbvhobn0nxdolcYdBufkqrG5srMg1I7LecemdnkcbDX1CKU7/GEf282Dy7odpk+PULVP0uxZ0R9tb9tou4DTZ78nfgeynAoa1+cQix6gE85YKAT4Baza9ai31I6jbQ3vskyyxMLVTwgOasa93A5fTev38QzqoU+qYeOxGAdCnqGLLiR7l1AJmrpYSrGQippjizez+IS2fwV6ItfDMo+dhQ10tJSkYeuOkPvhwTF16sifuxkjlfPSXyoV0tuT8DNLew5fG1d9GZCbIdIvBvzVbzlsIDDNFn+04RwDleaocfowQBA4esnzNeN9Rz7yLHhboNJxlv+4tTDEgghiGW6mN3sn6WqX2BvMOvbfYFYGTzEatRhR7GIe9GRrD0sRJkR1jlWAv7yTSdyJg8Zp0vF3OGG6O73MJbsx3I4KkxDAaxoI8ToS5MUoQI2uCKRIcEnJR4oVUIxcG5QqgRDQVQp8h9mfPc1izzJVaR+b9QtAjgv1sNqeqBIh4oR0CDhM6fRPs8hZWK7579H2cD2r8hwC1XstjR3E4ij8LzWhpwzeFTnTry4kcETlr4XXWOzVyVv/YIM2YwLiEoJr5F6gKb88e9jk5lFbNrCn71sUtD2hzekNXK7+B39W9VMLaK5Jq6lcx5p9fEDvYasdagQEWwlKCslibPjLOCe82trgzJJt5PmUZPAprr1k4lUnWgOOqeqtEi2+1GU2XGzYtXX1q37FhvETFssq4KCJU+u9k2b8SVy4gedNrugQ0Os6sUkujp3VrXBITon6itQjGhVLfTqWywpC6JEw3V0oA3K5iLpT8DldOjgGl4bA7efFCPggRV6Mp7oY5i2mHHMvI6EMzIn3NSUQ/X9Wu3LDPL4OAfUtGo6Ed4=",
                }
            }
        }, { parent: this });

        const cronpb = new kx.PodBuilder({
            restartPolicy: 'Never',
            containers: [{
                image: 'yindan/genshinhelper:1.5.1',
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
                schedule: "0 6 * * *",
                concurrencyPolicy: 'Forbid',
                failedJobsHistoryLimit: 5,
                successfulJobsHistoryLimit: 1,
                jobTemplate: {
                    spec: cronpb.asJobSpec()
                }
            }
        }, { parent: this });
    }
}
