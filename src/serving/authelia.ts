import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import { BaseCluster, BackendCertificate } from '#src/base-cluster';
import { FileSecret, setAndRegisterOutputs, serviceFromDeployment, ConfigMap, SealedSecret } from "#src/utils";
import { Redis } from "#src/redis";
import { Service } from "#src/utils";
import { versions } from '#src/config';

import { FrontendService } from './service';
import { Middleware } from './traefik';

interface AutheliaArgs {
    base: BaseCluster,
    crdsReady: pulumi.Input<pulumi.CustomResource[]>,

    smtp: pulumi.Input<Service>,

    domain: pulumi.Input<string>,
    subdomain: pulumi.Input<string>,
}

export class Authelia extends pulumi.ComponentResource<AutheliaArgs> {
    public readonly service: Service;
    public readonly certificate: BackendCertificate;

    public readonly authHost!: pulumi.Output<string>;
    // Verify endpoint for forward auth
    public readonly url!: pulumi.Output<string>;
    // Verify endpoint for basic auth
    public readonly urlBasic!: pulumi.Output<string>;

    constructor(name: string, args: AutheliaArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:serving:Authelia', name, args, opts);

        const service_account = new k8s.core.v1.ServiceAccount(name, {}, { parent: this });
        const namespace = service_account.metadata.namespace;

        this.certificate = args.base.createBackendCertificate(name, {
            namespace,
        }, { parent: this });

        const secret = new FileSecret(name, {
            spec: {
                prefix: 'AUTHELIA_',
                encryptedData: {
                    IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET: "AgCYT9tnsHJ+P1k7vFUXHc9kDweaIezXQueesrJXOpba76gRBYIFkZpAySuHLPtS9B6on+8104Yp0cfu58qbZMtQouSs9woZhDjKbe/WStjx3Znr2S7pMn9oE/0mYk3uO91Q3Cdo98l+gQYSXeqiCl1TYnVG+u+/xuxey+R6U278RK7Q7uuqop3IQq2QfpyIeFI4EJcZfKkr5+9hPe53UjuaZG0AFQt+WBXiR2a8O1y7acL9MJAOJ0rlG9WJ2CNLKJ+XNQt9Vq/QAWlPenRc5PqH7X8+5ZcxB02WXKsU0gU2cyUmbYoK8eL5PwTKGWoZNoJdUb7tgBEfkGASGnQl3OEu+KKvPRhLYAoOmfTN65oeCZCBl/xuW3WnYSmzImYLLqRLkMU4UDbVIXn/w6kaiU+/O6GiE3d4gjVXOeBN5pT+I9NuFAzNqirBH/TFJoyFYuz8eDcz7GVbpHZ/c5NqVh/tu1V9mwTPaSxSeHc2RKBsYo4y7q+WauJXZZk0AZ/81jBDDct3WE3ROhhwWwokaTtelGGxacaug5Ij+92bt9C3ZNOw7VA/vdnoh/62Fr42gDfg9/fIdkorE2ep0eHSMeACUm49tyUXozYaVggTpbQJxTkU0Al8/2QNCIuNQTRg/I2jceqw7beTtPBnR6fJ7BNFhPWhSXH9MKzCP/3VUDKakwdUl9v2u/bOuuxLeGTBAJAJuE6tSUrEcMwgahC/YbKbMo0fHjcBD7IdRxnrwARrh+5tF7Y3WlQ+/pT+k1J+1bXdwWgjq88GVPmY+uQQjwuZplfCAbe4GONDgtECUE/1NZQWgyIz04Q/J3NaN6fTuDXqwfviD952Lck73/Jc82vL3Qz9cABVatnmQMtKS91JTA==",
                    SESSION_SECRET: "AgBHzPFXYd3WJezPRBsfa9iiQ4FFsq1XOpQRisPXF/DEtIivrHltMmrrt5XyU4LP2jjRBUIvk3dVdadpNoceDnVGld6JJOEjYk0GSSi5HVXcfg0cxwUhGm6tU8oFysFXAG0q2Y3dnElq35+gAWXdU7LheZLan36KUIrf767eDaZWgxPfyDAW1qB2gaGq2sWW2JH+UAD6DS/vL5ywdoMyLGFUdF/s73y/6qx06Oh0BwzrsCOzxB1+Rl0BKV7I4yVAuWhy2m7Iv/6+DoStL3QlQeM590KXLzgcEclvRfM0SxO3bzJ5f/BSPohdap5pB1jxD4qu4PWc7lDE1/ik0yDsfftyfdUAuXdlyihgQRq0O7UvQPpT/gqSY3waT3QsE89uWVd3EvN+noMPC4FugS4AeqAQOWX7cj6qFUkX61dzhcPHUz0CPmdCgRm7TDWCTnw9LbLp9fRIofHtukaHrzHSthvyFRQ8mw9KIear9Kj/89eUzDKisMr3RKSv8T8SReHD3yydvkKLXMOtMVF5nka5Z8RFLnf5IBZ3Zkq51SSCvlJNqZKjF8suw+XahKxq+DUi3wb/vqQ8M7Rqv0ME1AGsE8pVMmRXadmJ8icu4hhkH3L3+7sq9HWoxJDtQ04nFEk72mvsOopyt2CbXejVTGUAX/JwQnr5JGVe/RV0lrGgpvOFPbG4fUYzWnyCjdD1UsDsZmP3+z3ATOWevoEtEeSnz0W04xaYmTLi4CuUYcpxnwq6vVfyeE41wAg+xwvrD3WZ9UVG6nqeJB+JTbUBxtTtkdsoDa/QrDeqhgJItI/tbAeUhGkGvisZiHhvWbjHpzDdEZMBRSXMitiWzsOCnHbGbYFJ02T5g5yCUJp1pCffNzp/6w==",
                    SESSION_REDIS_PASSWORD: "AgCppeKtS9/S+oJ3AgvODikhSWN0a1pQnoZFeotPbShRcI5kqkO5UAJENWjin2A6eU1WF5QqaGN7jIgUSa7ZI4OtAvdnqq/6L0cGDbxE0CJyfy8RObJwbC+FhQ9wNyjHNcwYTI2ET3UFTjLvbkSkpVwrpRKyYvc6TCmOTy0TjQ+o9Mn+tGdWqoTIO975wlph983vblUsiC8w8QUTfSZujtUoh3NYjEE8P+3t5ReLxuJD7hwrTGcTaIlo0lGOnrLBgRE1MIBUVPAnBqxJm8jt5L4mSv0MpN6yeNAj3+XHEiGG3YAI6uFLGUj4nUUBDrYr/Vnl83HFNnhUqKw2DOsXcxBQD/xPGCSnzRapgXxvIfM5bd/FAJmqmeGKuBdZYVxd5GuaYEixHq3RI+7SJYrhriml+pgllOtxpiLCPMzaPx0BJLHwtzoaNYxuTwFQ0I/c29EVU/i/ykjUEdB7ZxRVMon0nXpDwuQWTJmuS9Q7G43fcHdWOsuwQT84XkOA8bTsG3SMTXsChFHSB35nmTXo9KR8mg5n7cRhy0hZu+tHZAfNweL/0LKJokEqKLj4YYVU6bt346Vwr2PybCzO3/G9sfeTEMUL0XmJ/eHnhb/7vyWRC5wlX+xMXcnpx7yvuhl68OO/U6H+VwiF4+6+diwYwQ2MoCl76NVOi8cHJgl/zWu1KfKx3GHSjf+rLN5c+lrFhM209JNkekv7TBW3zAJqPCVl612+WhL7Y65+",
                    STORAGE_ENCRYPTION_KEY: "AgAN9Xv0sPz6C70thPr5GJ0jJ6hV9zocLFncukQtSh9s7mxUkA5C2MznpYUnkW1y0b2OFWr4T08qJMXBwB/JyKauiEZ5QbUMo24wcLa7kdw5NRibVy181ZXyJFoL4UYf0r7IX+dLN6pQjqkYcUhddvlV31z7P4OfxmOPyTXx1bM/rKCGt5OIf1Ob+1y+apOQidWrhL7HfgEz62gyfh3mlMn0ej1kb2rHNp8sF1ddRfTJBFDNGF2W2gGdXua+IGseIewUMde6523tPVYCbQaiqmt56O3qRrFVyGbwXeWYq2V4WmWBmrgNKyDInocE4vK/Qr+XTC2IhA6e0Fl6g9ocQuzEEFkeriQt3iXtLX+Uq+OpHNPYpWbeeMxS/Am9D0gSJBj2hvnfqImajmXnOOlalQ+p6w31KO0idNT+yZLH/3kVfc15fRpgviEpggdGCZDCUv6blw8a478LiJpJoL0GA4TN2O6JWf8SyMAcMBc8PDAxqFjmOSweMkzMMrhpmMln0wwnvnLjdDY1JVK8DTzw8s33b+4EnLbvsQtecJf+FfNVt6oF4fdDS4JsmtYB0rljIqXpjhLz8aNWwomhLmKF4ThcPCguYQ5Jzjs4EfN+2KDVcEcuITy8dnpXgjV9oVDM2SGqFKvG0GyfESc5waYAohkXZnn0hGYcXqBwrgujxBGSyOUfUyzLWO+bOD/94k1Y7ykGmztRIH7XufO+4ReZ3CBcEqeHHRaZWG4Z317FPThhFsNF2QWmt3vNbA==",
                    IDENTITY_PROVIDERS_OIDC_HMAC_SECRET: "AgCm4FEJbQB7PVGYiaVUhy7I5FGe4aKOuKJskxWMKFaaPIQIysrS8hRp/BlhZtyIOHcgNa5vkzUKGyiNMR+j+yRSF77r0UxPyRqPtwXaPPLdgjbAuJUuqdq5ewLyAMzhnBqZuIEYFZLxqZ6fbze1JSpO93ghQFXGlDMVWKQxveH6zT43zOL8ZIi4vobvT6QTznAM3XaSKSwD2ktZcR9CswsW7hICfafdO1UvnhlOLfivi+uy81QS7bJWEXstaOEybHy+WXf5jhB4whxeApS/k1qD2LznUW6wal4XS+G/W7SUO9Cc8O/dtygX8vOHnNWTTRueGpwaj1zL3Plq6qgrJPezAGAMzARmLGUn24xR27Dct+Yz5ASnLLE4zHBmcEdhxHhwhkw4JeHKFEXasoKeO68xg+CfEZWcc7MRW1JofXh+OqyvMab6/CyNn+fpk0ImpPce+wfgZJMFbySf7Rm5Gg4SMCYvfo9WPK3IGdurtysr0IR4UQPd/txoORvQ8HWEpxbqNhTOGRiAYE9NM9BQduW7cnySA3hAE03AEaNiohsDZTA67N2keO+NQtzkOzHD0+b8rs/oNlGM9NI2no7ee2eSEr5Sw5JIzM16UV89PywcajHtic2uKiCdtNbxtdsHZI7bDmg2ms7EpKLmXog7yfK8SX8oJ5N9Y/ew3XGf+LFN2eJLzYGnb/pPXQBC/Bu5+oJb42hCAh5bpc+LnDINO4/wkBzev9s1YgSGNQ/nT/rqMiLSaCa9MmOkEktM4/rtv60Jv8qeCLKI+puY4LOb6GK/",
                }
            }
        }, { parent: this });

        // redis
        const redis = new Redis(`${name}-redis`, {
            namespace,
            persistentStorageClass: args.base.localStorageClass.metadata.name,
            password: secret.asSecretKeyRef('SESSION_REDIS_PASSWORD'),
            size: "50Mi",
            resources: {
                requests: { cpu: "36m", memory: "32Mi" },
                limits: { cpu: "36m", memory: "32Mi" },
            },
        }, { parent: this });

        // deployment and service
        this.service = this.setupDeploymentService(name, args, service_account, secret, redis);
        this.authHost = pulumi.interpolate`${args.subdomain}.${args.domain}`;

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
        }, { parent: this, dependsOn: args.crdsReady });
        const front = new FrontendService('authelia', {
            host: this.authHost,
            targetService: this.service,
            middlewares: [middlewareAuthelia],
        }, { parent: this });

        // urls used for verify
        const url = this.service.asUrl('https').apply(url => {
            const fullUrl = new URL(url);
            fullUrl.pathname = '/api/authz/forward-auth';
            return fullUrl.href;
        });
        const urlBasic = this.service.asUrl('https').apply(url => {
            const fullUrl = new URL(url);
            fullUrl.pathname = '/api/verify';
            fullUrl.searchParams.append('auth', 'basic');
            return fullUrl.href;
        });

        setAndRegisterOutputs(this, {
            authHost: pulumi.interpolate`${args.subdomain}.${args.domain}`,
            url,
            urlBasic,
        });
    }

    private setupDeploymentService(
        name: string,
        args: AutheliaArgs,
        service_account: k8s.core.v1.ServiceAccount,
        secret: FileSecret,
        redis: Redis
    ): Service {
        // persistent storage
        const storagePath = "/storage";
        const pvc = args.base.createLocalStoragePVC(name, {
            resources: {
                requests: {
                    storage: "100Mi",
                }
            }
        }, { parent: this });

        // setup the secrets
        const [mountedSecret, secretEnvs] = secret.mountBoth('/secrets');

        // config file is not templated here.
        // Authelia has native file template.
        // https://www.authelia.com/reference/guides/templating/
        // We just pass in some env vars
        const configPath = "/config";
        const configSecret = new FileSecret(`${name}-config`, {
            spec: {
                prefix: 'CONFIG_EXTRA_',
                encryptedData: {
                    OIDC_JWKS_ISSUER_PRIVATE_KEY: "AgBOsa07XnejyOVVNnxqPMv9yZBcJ8gE07ugAHaffOiX3rETdo0aTKT79ByOKyLIPFri+3EpkXLLPGZI69VM1Avnqm/DzN3Wn1nySPmweoIUAz+5aEF9R6uZj2bfWT1/hZaCsRiHfGB2PmCXiYlaF0u6qMkDBJfkscJDToNYVladewXBKlfJUqPGxy80zp2k0P2rK0M66VkgLqoRPYSovUl+57IbF3YeQeCO0AvNaWbt//lQDGbf/4B3gzqDLLjJIBBtrUk4d0wromNZp3FADNaGzuC90aeg8KCztm/VjY8UEJaMPaRbH6mDs46yXMM+P7UzTdVz8tzuWoPAHw6mQO4BCjFSw8adrUW6ks2HznwWddgq+gBg0XFoU6KhHCpdZ2oFP65L4E0UB6dkEI12YYDCM5j0kTKiBWHAhX6keVuUvQixZ/PDxMI2OtTlis/sKYSGbyQFlVDH7BrxJC2/7QTGCE8ra2BoAfgTQUHPeWt0kAKg515oBXH+crl9luylrfbg7GmjSXrIr7VKlQoXkbIk1H2B0mp2ff6Mwf+b6ZssjJidgXizWSOXmZ5sEL2LthlK1U+NaQ52kh496U8Xe7M/+js4a/RecTxtVG2EdnLFkF/e5tWfpoic/wyBUP0jwKYYiOKUfyNPfiHrwrceLSdXHxwlFYzrzuf06Ktdx+jptIUoZd3a4SQ8xknwPb9KyRr2veTAwFy6SjY4EowjNaG9DJoCLhbWiY+aTD2vbz/TgqIS4lMs3kABIWh7w0lnj2IswCLUQiEH+n7A2P55TwS8tN7vD0RtFtI0Zw7xnAOKeJmHJbwnPL9LVQKoEToyb4auiyJVoner6VPHtSnwNmPbKccb5prPIzMDqax2a0u0ahZYhzxlEfbp2lHwxZfsFtt0x8Oh+GpZmGBN2QU0Y4s9Q9xfibgaqY9oVk0IR2nyYjrfRyC4gxz8paQ2qNgCWJYmmjn0R6hq1tyOvq8qc9gzA7n9nTXKLcdlYcaygGweVOFR53vPuQjFirHaGkxKiUBnLRaYp8SGiGEC42bxcNeQ8HjUDuguNNqUv+RyaPzOQHbiQlKrJ90bkU+PlZdCR63YChF13umqsWa7UwIm2lJyNd/MsO9Fxznk6qqeeWflI/gfglIQdV0AODQlKy+ftWuBsjP2LNQn8puKzRcXatYVMA7mpquaA+42rbL/6oNu+jg9h4YE9huX4YQ674wcMUGFCcJurnDeZ0BpJW86E+LDUDc7sRsPLX1xPhLCOWbXWf5sYhb0w6mE0gjW52tgbVwLlvypf+6yMLhV/TI1/pIVNj+IlKDAhC7DMaIe7k2Ooa7o436sGYzzbgXj2MImuJhkWcivcXzOeZs8qVH99VJHTCDgZugU08RgFnjyplTjOVdAAZHkHjG7Rw6QIs9SfqUDoMHXiJandGDfHeUmtllsIzJN9vM0E7/W03SCxYRlC8o1VRSAFjVssEXthMF3YqYVT/lkxymsq6O2uW9xxUvVd4lqFp7l9wg714fXJFHnDaK2IPwfSIH7WfhIeG64nA+h/LxDtaTTN+HKpFymPAtnIbQnbmvU2cdkgToGeOFx+mYOT0zyLOJwx/SED56D+lJUmn0NP44xZjfdw8Rdfep8L1GPuj9KyXoALXFsasdN/wjVyIVr7uPHhuPXJqze9aKd/XXmcA0FEeCpEhbzOgEsJJuUnQgUHseCNQvrXUWRDxxbbC/mWSMyN3H3TCD1eHJlTwICxnN+wf7tDOcIe72p9bB3GKldGEWj7nj8CCP85VoiBqy3oHIDM98IZm5xtn5eXIBUnNZlatWL4oUJZ/c49t7VqkVI7tOfPGFgUNRvbrKOJB42u/3nFgBn1KrAD3Itkp+ph0rb2XK7BxUW8tjr5xP3Nmy4gYWkkjkCqmYwi1eD406OJPhgCIHAW5m930VR/2R6L/3uRCjeHCCUtoqA+g80gBfZXeRYzyVxQxiHFDfYQ5a/65pXT6c0GNdXuqfGoeV1jHdbs7gJtRXJf8G9bPscY5sDddh7c34hLI1PBx1AktIbLhqIoG9IMaUmi/7Vb7DUB2C9SZ/jsJOikkM4Y6h/yCJY6X41hl4yFsKQdj8/h1LK8qrNExJenRr9g6D3YoxBXVk5tLu7/DMwEaOaTkBABScJiu15QkyOjndG8ulys53YbE3P/R6gKGX5wdjBKJgpEKQ7PZ9HJepWySnyHJsP2QBE8yb68/jqEIConq4CiEuw09HNfDjyE35PUtVy5nGCA87EJ3p304t7j+WEavs11y3QJpt03JttWR/DuYtmhSznhK3pYodADIw+J5LJH/hFkN4n2bqjpnItD0/z0/fEB86xasEZU9017qGnEHiSFPMtVGAK732Zrkw3OAaEfxAO+YNVmVN5FtWWyzqgvJu6GWu/rhGz9RSSKO+NL1PeArHM5hBXfnQ46+O680KXkc38nVxJDZP4Cde731G5djgep8GwjrJC19zVag1oOMpSSvM6PMa3qa3RtIdp/LzhB09RGJmYOlBYK4+sdnd+txspsXf0QOl7hUNy82H5IHER+DvQVMAg1nWdOGICan0LZWWsiQzlTLhvPQtQ9S/a4gZqx8MRAgRn8OwWWx4rZXDNytu1aEbzMlyQrO8QVijwjgXb3PsvwyF8bsOTu95qr1t11bd7CFMizb/P4va0josCWr1joo+RAcrcvUgoua8/pUp6Z5o1Xi8CJf2U8DdCxno3P0lqH+t2xSTBMI+rGRSSdWYDnUp+plERhyPSXk4iEeC96qgYL5bfO4L3a9O4YHBQJslifU0fQ3j7AZuDJGlQ8Kwb2gNHSJDkHpntEs/81MOOQ7aaKC69T6xMPIiiPFzGXrSJ56r0ALRdKNbZwD5fRFkVPssDnQQBos5pZVRmP3fx3aNC68fIOD/Mu2sP/IZ+EhgRK5j+fLLSaaqK2rMepGTLBczI+TZb/3m6rw/cfRUZycg2ldAwpv9xKEziQczummh8asqE2ds4L1INqNDbfy4oaNFe3lcLcoBcDYL/MFG45Wxmpl6afDdwB26OiQaopz3PHyJWE96H86AivL+vg/yZyrRN+PdfwHvFlqzZWurmacOwMNLyNU6NdeLAxjjyVKdrS5Lom5y0murl1MrjvuMzhrMdapOI2HY0Myr4D/W/ZfdCodDMCWzBGydnTgXPLK+HVxg58LLbbQW80K9/pyikWIjH3n17yDEbTca8oRjgUO0g/oh2dXW2dn/U00GX7xskrTzk+nx1yN4U/BMNVny49MW5EdwMfnhezNRdLDhYRnyKS1hSn0JF3BtAU8IUxd9ER37IdlIyOFzzB91KAQzRNxyvCHqM8zbuV4pYnv97ORaeAvuXrfKNPqoGcHZ7zCwhYOotmgGNS8WYljrB1rftgQs1/4IJ914GEZtIFIyj2QsbIOEB6hF0e8sbn7U8F11HiQT5UXdtl5Lun4OilUsO3tNtj7ne/Oh7buKyj8C/W79SXy4VVsRB0mTdRDcJlPyEAh3ARie3rK/qkxdsfNlzB+FGWktOMAh6Ja5kLvmZE97a+2bs+tLBKhju3zA80kWAzINSGCF+mc90mT1MCY8VGvChd7Rkq0gWjQOWKPeeuEkE9ESM/n1Ahs5WnT4HPMv0qyGbdJtB3xsUGBelXAw67Ray5toWU64Iu6b5iYXyuJyi5ppULDL7e43/5t7u4OeGBQurXK036/oJ4RKWy/zWe29pgq7SHAdwax6hBUJIfPzaGKfiuxm3uUcwYyMG5XV08KY9u4D0ae89fWJHUeDdewevuS48pTIQrnQOFPvECJy7aJUVmhP/mmGvbt8ZQxkOBnsqdXuzXZpx2Dz1wmD7acHQfO405+jv0ggxkCnepI1+ZG87Sa+kwMeFsAvvyXMHZJeaaGid5T6hyaHWc8alDp5bk+xCsfmnQnD/8EuyApTesruSWORYiDuG0ifoYx/+PpeF6+DXZCKD+J9v+uKEHitUmUB4u7XT8hAYXkXe7QmjqFHDaWr6ME8mZqAiuyC36DcXgoCHTWBMnklJ77CAA5ow4praPQv0n/mWxhCm0udrZixYhI5vuTkBr5wUum2rRhsjLed3f2WTKuwKdZ7LaSPWAAxSqU9QUQ5Ft2Gkc68jukh7/aWDeQTA1RMCf2nmgQFCIuEoXpy5bfDaQS/HHQuFcHmPw93iyULIaZi94fUtVlXzQqOZz5TUvEkKJqOL02ToLm1Xr6hiiDrTbDsMWEUEjNfH0jFTC2HbiKSgvwMLl8F0iDxtRIYu7PgfA589HbeUpPocPuRYhSQuRLPg0FGdtIfOPbojPFEb0CCW4E6V6F0gODzbaxYoGI9FlB87U7SnpEP3oImzYnMnd6MddLFB/ZcxGyE7TILCEgR8OK/84wyEZemDTFX0LqHc44Vv/vQavILNznsCJiAjNFMTDrH6iO2kQlHXKQ9lnXLm4Ah0XVNf3psA7emgKAwerU5U//sMwU1mA2iTz6wZgjVzuSldpfC5z0HED/WVkZ8A6/WZS4LkCmrfANIUu16DUvonRvn/Qi1Pv8nKJ81JCVH3EL7L82A4BYT1Ei9w5rZN6e/JJvEk+ImIZWxWnOo4lm0S78J1A/TIf3WSVzBpbAMfbtRM0KmwyEPjCps1brnkWvA2CGxxLL3RH8zet+vafMmJn9modmtggWVdLLeWrwhP9rZ7NvL3d3sAlgoBf8sn7dj9QcmEoss4SFqihl/kHoTJa9+Yamda1EtH0OJyQwFM9Pli7nAJXVLcykTlGqRJBjjgtxKlojXbvv21TFc+ZzwIhccSE5wCHM3G/S+tT24YRjl91/o8CUbMWR6EZ+l1NDUwrjpLAwgduCHXPSNDAI5yL3xbDU8kzXJnX5Rj9QrsyFy6rpme9MqZyaxlLZnCIeNEhYuEmxRrAEHq7FLLyNJ0Xhne3PCT/YxjobhUlNcaf6JVl5IWKjuMDzh2uJp2PLD/j19gOUdd8u3Z0Rt7PQOmz5P46ZAWCneLqeaFsvL312Ut6N2nQwZ2/3hindsRnrRNj0EC0FRwDalOTPrrMAOYkiJIj/45BwYmqvbPeXykl104MaaDvsXgUrEeW2I5OmijCw==",

                    OIDC_CLIENTS_IMMICH_ID: "AgAgRkbHs0T8tTzmIrLp+oIbg51WaFMgfNj7bGOrfZW1QEELrcVzJA5y78lHd0/iicvNrYg9+rSvF5SaINfs9FS7lvHKW5+4rFr7bmJJ9DZTYtf7IHBLbUH9lM/UndXOr1q5aM9+Xr/ekWwdZKDGUhxPhIyvSPavcIpxTAWEgSS59uidL8/uJz4A/wzk1GoBYkjf1yW9LzQGU8nhES8veeeHvkCEP0DChje+rbjSXpp8fnmeL2yK2vnpH/THfenG10lYWXLXWk0wKG3TLjd5zypOEj3LAeYb14zXRByd4/Mjq1AeUG+8Pbu6wgqSg8aAmrgTfO1KxuRMr4FeUn9h7QOdNEP/E+XJdhsCBUzfafpdVyORVJMIO1Jc75wFurQCuW+Z3DZ4gV8nM1l6rJlyUqWIzsTQG548t5p4pBKu+9eHvZlycg6YtVWOdNrkbyPswkTTS6z8QlLGqXaQy0J1cCykrKD5ZeDN7lSF7ASJgXRCtreK5gRZW64+LtCPuvBMK3m8WPE9U8ugGAqiPlJhyEMGiWrLMRD78VtMBnoNbwpxht5EMutpUj/y2qom2wLVWX9jd9xVnoC88guslC+cGRRLGuFoi5EOTjMMo/mUBPIuQIZMMsQrlvXqlgHcbNIhZgTuJlCsY1YrbfITYogOoiEOC1fdF0ie5bOA2UYrO0ysR1qT95c3DALngm232dOf+Vm10JuAO9Reg0xNDxVTUUo+DwIt/QkmKrN2Fr5QgHQbzp0WT2o1TWuV6Vafbm0/fr62MF6X0lLmzJFdGkkJJJmBOeCGWuAruLY=",
                    OIDC_CLIENTS_IMMICH_SECRET: "AgAxBr/fP7NLIroP8JZyuhH5MIruIYxvdqN/nXbMmXPNsau1UJV0KLsWcdPZqjD6UzE6oLMSEyQw4TqRIGwzIiNimxOxFqLIjtzjnSSm+gyO0a3mL2T0H4ttNTRHrC825NrBaCT9FLyS/3JErk6XuPTkDf48FVrhjC+/mjzan2y7P/+fGANOIBybDCnjm5lmLYnQGhPNyyrLbKur+INpv/z2g6Cr3ZeUYxeClA/qSIccOvmAinKv2egyqELdvtxbPIz2ijTiX9iReCJu7XBeYGdbcJRfN283pIaK4hZJwojk5j5M4hhIWSdvu37kIJ543Bmcr5oyc+nHGRtscrwURrF8OdH8x3V7+yb8h2DmhgGXSPAOsvO2dIBao4onI/6/fIQrLewAym41snr2WmkFGuDM4HSUSFMBwPKVltIiEOm49hqQfjbAYM27/1D9m2QVfzzMFqM6FnpFsHq+p59KUn4AuJV0IU98Zt1ZNXOsqDjDnkQ+hH3k+Y2bK6Cy7ur8uDhKrPzVqCzDclqqdfGkPtM6/vukcEPh5/U5qZs2Z16Tb1zcQqK2CGumtA+SZuY80Sx19v7kKrRVZBtA2LUCrDWVxjfagZqJ3NgAlq2dXkrV/nHr7xxxwPu0ru4ajr6PalgCnTRdV5cYhUGeg85BNnGIV4jGQ2VWdSZGUua7n3rl84RV1SwhRw2OH39fdrEy9sK7WHC/9NMDwValmHUnDi52DWs6t/9pxsJe403khZQ5ozu79XR6UeVCccXASjtNqAMmCB2wo9fj56AzQeVPbfQOYRlbvKtGn324ek80xdYkPB/f2RCxSJ+Frbi8FLmCfHyXYH/QQhLasxnW0uXH0QZICs2Buf7UrJjJT1ck6j1eO5h0MQ==",

                    OIDC_CLIENTS_JELLYFIN_ID: "AgBannmtoYc5j6WxPZGfttnWQOilSVvYpzFHVtQcpkoq2oOSqD8/e59hmHUs8Clqs6XQZwBHMZOtXSyVeS5b/kLnUQk4RykRgdeHOkBTS7PgP/ovihn/ri4ALWf751ONB48D9EMBx4nuHva0DlEbSHGnLyO12P1uIsUBZmSHoKwEB9tF+QohsgVyaN1DBApPGJ0LCq/OPWdcMqK9qst4uO5+BU22f7YTs05DEcakPV+tGoGV6hMfhG1E9h94Ab3hSOaZk4fz7mxa/nseEfRkv1naohgnA1GvSoFCOXaL+bBGCzg7x/zd8fYHKOmn5gm4wyzni/9QHT7+4a/axFJ+0Y+AC94A8Fj7jBa0SmzvW+MJQy5y+QM+qHJRQHKiUoYD9XxQgDaMwya/85590WFOqkay6kdTTB/FiwWlKQ6wVmkZ8eChgDz4IpvYrUhK2iLivE8iTQLVxOlbnVq8TD9RXr901eDV2Y1fe9VyY+Y1NJ/B28zcUaO9tE3A+oLNbQmC/7Y6HdhwlUb7kVJnmzXTzZJPc90b08ayJMjsBgO2/mUxUQ2Q0bgwo6o9EV44kuT81Xfj9DrICetfwWd1bb5j61GFSnt6g9zA1pkpWfx8btTnxvcPnmDSApzgY+2dri16pA7dbP6fPKUL5XQIU+n0sH4VDaObIoyraiYS502033p4PY10HaOXeLTJAB2RxZ+jeozDbJ9nb2OCbDjqhNTY7BM8q/yptHEmNp5Tm7zziBZfAQOS7Lz5gCSJ/xYDTe+NYzg+XsCZjU3kyVVTTqUERX4UPT98/y+TPHc=",
                    OIDC_CLIENTS_JELLYFIN_SECRET: "AgA4G3y+BvSJgxygII4xkOC3lfgx0PgxK2v2tvSQ2RBcxAR4aFPwSHYSEmSTeZCtweGbfz8dg2DLKwNMYC2PuZkX+PoLdpxSdf0I8cVD/0OQGffDjNMCANnezd2wk9+lFKElXaVcuaNF7LlHR+PxiefQZ/RCugoHHNIxLZaBOjCn8w5s3fPuOdIR+dJq++JsEQYM4YsKdReW1l9GJOqA+Z6ipmrJ0giLLWCgswM8JhyyX5eKtN7AhmuX89wuIybWoHAuQCgM8YxZqs27TNAFIcNIC+GeR5Z01bK2h+wXE13p1IqWQyAPnwNNWNwVBm0J/h59ofd+5GFQciG2hUMwHwVNWrdXgdKPEIUZ9LUBf31Ux08yrxld7xx7jj6DV7cMHaktjIrd78FGX1TSjnJMHAgk0Eq/A7SiYtt7CLh0ycT4yosE1U5dUSmHvLa94fVHALwO8HrspfXK/vaCcXVKwRP/tneFMZdpqYoTWX+p4abaWFrZ05rW09Pom87Rqy012GZC+eSE22SAOznaKI2BffY6/DkSrHhnzGHf2UjvYZxtPeaPv/ekpXHhVAwzR99tq/AbbrqQ/INcJLXvYn34IgKHOSNoCwRAYm3RsapH6odO6L0tBniPfrzXiuj9RhHma8KdbsmSIg8tUWONyrx/WLpgvHRjo12JUCnrX4FVIQf//cqxiopahCCi9yK3X71iEWgSweXy+/bAEVhHN7HDVKQtctlm3AsVVyb3YyqhIv76W76MrQzaoPbXrRwVnqRBuSxg/OGk4aaWg09xPqzyAsa/Ay6UcB1vO0O5HiLx5jL1bYLkS1PM1KYTXiT2dFRdshE0OWj3rZ6oj4HKcowQdvPe4jpXiz9pSST9UaZyWZGfip5YfQ==",

                    OIDC_CLIENTS_GRAFANA_ID: "AgB7yInLsXJJUDnSZX66nX2FByW6WSXLA6MjeBzG5BSb+6BmZYLS7D3d3XHPUsW5xZMWhcw/XhJFlNJNBsVxCU+km4JsZdNmq1tCCzRbJctWQhxcdpMVHwz6Q0ixUL+/0jwgGtxjUqohCGLhJ8N79r+ZeYY2n8xr9Bg+EZ8pr1ekxWN8KejMVrtjKRr48tabYf+V59qUnt7tS5s9WFSZwnr2SHeTmYLy9fRPaGvWZCH/q/zf5J8WEoZEHYaDIYUxNKWr3EL6+6xlKuiiP3o5Dle2H3zWY3kdyLXlrG4mbBF96jQdKER+/NaIZaCgQGjIRVz1pTbdEQ3fEqActLspDi1bAomKIXrJxm2aEJpBZk5AX3twZMMd0suXu+Cou0WjJkThMVfIE30YoeLBdGbhVIKpWnvivkg0ZRBA1Jd9NhAuGv9Ao9NRRPhIhikS/UpDWbvquRTpYyj3V+bZGvNizYTTIRkLeBM9ywniNEhL8JZDFJFg+jwftsknFF+aLZMNHVRrml1CrZrXrHjB6/SGT7l5wed3yzp5P/Sv2qahBqzuwU7VYzWxtjLJYvtjwGwkcjY7OU5hGER5RKXSPL0Bf+RHNFEjLg8f3YPUX+uluClrxNG1A1iXPByc7VJn/lstAZHuk3zUQ4CElzfGR5LnrFaawAVxEqcOGz4POz51ihyRrYDo5kUCL6hRXte37EdG7utUihZ+xka1OQqxzVFtXJaZ/qpc3NtZBnqtqwwid5ONOwLXVXHhJlejWLD6KHX9aibLJZPLqLdrk+qI1Lx0B7We69wm/f/8LAQ=",
                    OIDC_CLIENTS_GRAFANA_SECRET: "AgBELiW+aF6yzb1jU/2UebJmwgbBHHPF8+N7YxKnoI/iBjBU2bWCNZl5lVQg7BqnpTQBabOUBxy/m544+jFrMZKUUt1zJgtNuF+Mhtj+MWMNsYmQazQ2H06SA7vF9kf/EWcu1ASB5HXD12eRsL3dsZZ+RNyjK6Aw6ER0YStF3yKDHi7riGVp+0Zd/uS6+LVhHVP7tOepWdQ4MVHqmW8EGoBj0aKQp0EXbvE8oWdtIhxpF3eWqBvZSC+gr0vPYGDllkBKtjLl4//N31EqrgBm6MrTz3RnWljXZnpB/mr16Yep6SGtr+ElKEOcaR6DmbiAI4RQgj658R5nqQGXtMjMNLiHs9ALdXvI45hC3jGWCcER/WARYrTo1U/uWMxv9t+avOgL695njglWE2IZgTXBYtPFI1QC6FQtnSPkr/YGBeqRktrCxA6OP/Xuy5/qEDbZrBRC6pGiKr//yL+i0ss+GIywdk1DpHVFRr2LH8vIkJTaAD5cJwoh90KqcJlqo3rKd0JhKAhGPDzZQgHWzZWSOobN1P/1+00JidyqWARS7kDQS1C4UA17S3KKjYSrl25eyw0x6QNOR9/KOUYr6rvcW3j3m17AMBK2vaK58V+/UDmaSPuRT2qzUfGq+dBImFkOGn3J+fCSmG3CP5Grbj+rgW3CqjWgXE7JfFTl1vSJ1rHudRjNIfz4RIDBtK7YbblKYmGLhTWHKykphYha6go9K6bb5m9CSgcyXVdlYlusWcnk4cPJfFIUEW2NeBk0vgGFAWdDjp/T6AJ4KrxZ8zkEvYKZ9n2CpWZT5YBiI7EWmKtMakrFJxClQfiqVFHTXaxpEBWuH5FgddnRvQR/bu2cvr24PsWj0gGwSyCPDpTYrcRjNSVdvQ==",
                }
            }
        }, { parent: this });
        const [mountedConfigSecret, configSecretEnvs] = configSecret.mountBoth('/config-secrets');

        const cm = new ConfigMap(name, {
            ref_file: __filename,
            data: 'authelia-static/*',
            stripComponents: 1,
        }, { parent: this });

        const pb = new kx.PodBuilder({
            serviceAccountName: service_account.metadata.name,
            // avoid polute authelia environment variables
            enableServiceLinks: false,
            containers: [{
                name: "authelia",
                image: versions.image.authelia,
                resources: {
                    requests: { cpu: "20m", memory: "128Mi" },
                    limits: { cpu: "50m", memory: "128Mi" }
                },
                command: ["authelia"],
                ports: {
                    https: 9091
                },
                // each key in secret is mounted in as a file,
                // and the file path is set in the env var
                env: pulumi.all([secretEnvs, configSecretEnvs, args, redis.masterService, args.smtp])
                .apply(([se, ce, a, rs, ss]) => ({
                    ...se,
                    'X_AUTHELIA_CONFIG': configPath,
                    'X_AUTHELIA_CONFIG_FILTERS': 'template',
                    'CONFIG_EXTRA_DOMAIN': a.domain,
                    'CONFIG_EXTRA_SUBDOMAIN': a.subdomain,
                    'CONFIG_EXTRA_STORAGEPATH': storagePath,
                    'CONFIG_EXTRA_CONFIGPATH': configPath,
                    'CONFIG_EXTRA_REDISHOST': rs.internalEndpoint(),
                    'CONFIG_EXTRA_REDISPORT': pulumi.interpolate`${rs.port()}`,
                    'CONFIG_EXTRA_SMTPADDR': ss.asUrl('smtp'),
                    ...ce,
                })),
                volumeMounts: [
                    cm.mount(configPath),
                    pvc.mount(storagePath),
                    mountedSecret,
                    this.certificate.mount('/tls'),
                    mountedConfigSecret,
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
            metadata: {
                annotations: {
                    "reloader.stakater.com/search": "true"
                }
            },
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

