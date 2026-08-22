import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { SealedSecret, renderStaticFiles, serviceFromDeployment } from "#src/utils";
import { Serving } from "#src/serving";
import { versions } from "#src/config";

interface MatrixArgs {
    serving: Serving,
    /** Where the homeserver itself is reachable, e.g. matrix.unlimited-code.works. */
    host: pulumi.Input<string>,

    storageClass: pulumi.Input<string>,
}

/**
 * Continuwuity, a Matrix homeserver (conduwuit lineage: single binary,
 * embedded RocksDB, no Postgres).
 *
 * Authentication is delegated to Authelia over OIDC, which hard-disables every
 * password login/registration path -- accounts exist in Authelia from day one.
 * Like SplitPro it therefore must NOT sit behind the forward-auth middleware.
 *
 * The server_name is the apex domain; the blog nginx serves the
 * /.well-known/matrix/{server,client} delegation to args.host (src/index.ts),
 * so federation rides the normal 443 frontend and no port 8448 exists.
 *
 * Future bridges go into this same namespace as sibling components
 * (src/matrix/bridges/<name>.ts), talk to the homeserver over `this.address`,
 * and get registered at runtime via `!admin appservices register` in the admin
 * room -- the homeserver needs no config for them.
 */
export class Matrix extends pulumi.ComponentResource<MatrixArgs> {
    public readonly port: pulumi.Output<number>;
    public readonly address: pulumi.Output<string>;

    constructor(name: string, args: MatrixArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:Matrix', name, args, opts);

        this.port = pulumi.output(8008);

        // Plaintext side of the Authelia OIDC client. The hashed counterpart
        // lives in serving/authelia.ts (OIDC_CLIENTS_MATRIX_*) and the client
        // block in serving/authelia-static/01-oidc.yaml; the config template
        // below splices these into static/continuwuity.toml.
        const secret = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    oidc_client_id: "AgAa7FL8xtAlTy9GNuX82lOwksjTQxClA+yTBBItQ/W3iITymlq12P/cLp+5IV3C4/YmTjxJ3YfNidQ0o5BRpZgrMt8SD0MIyrOKO1cN1QcgAsYRWx4FaPCZAJ/mr1o+uUGtxsQU99gGRchzEvlhybXaia4/6v7rB0SCbcQTDNP3EvN4Hsb4HAFI99HUtsXMEHt7DRwTBtt3YGtDA8lYbrarXXJnzz0GzBa0lbK2hQ8Rg0IfviccfEx0X7F80HeDJKD7OCsSS9MqiuIm+LvPKGtrd2aCbkymnfZjY7SYwwJDABASXEu0gA8nHs7NV+82dIQAlI8FwI3GlHmDvch6tQ2pQJ/qESfYBm9z412hGUUOu9KOahb7UDZr6oux5h5u9gr+HMXfY5H2jAzr06gi0zrR0sGlUqTILi5//oR0PcWQQw/98EKn6Y9bHX6M7PJFnI+2Jce0iJejfQYc7gKkdkFORxJGA0DboB2djyDnWRC4jGWpOpY6eKsSjJ9ZwITFvNgv8ALUkfm6S7iZjOrl1T9idQ3dWeH/xWY67FCEe6yVIr+RFjjt9ykyoyJ2DBALfAb7zN2vmgrXH+WUddoP0ZXQaY+RwfYNMD55FDX/Gd0XmH/1go4k7gVEP8PezcRCcb6/O4ZsWToRPmLZZ3Cd5p1TS89R9bYNXtOX4sFNDML/syxwXaEAGOpmlI6bOUtV0aYrHZzjn9/GiLP3R3QPakX5KBsEWB7YFSrIJJtJprBhIw==",
                    oidc_client_secret: "AgAZ9CUnDFXsgFxyQc3OLZqaO5VRQW6Izp6mcTqfdw3prxM7v5mO+CBAP2yYR2MqSMVLy0G+eY4OD+HoErTM1HsnrUWuvB4U3FaQHRibV88q7Qyp3AiA7qqdhi5i96b2+ZNrcQwTXDlJg8ciwRmg4ybjrvbqucs78klC/r6ipaxbcqlrVbspSqFw6iBJS4VFiCliuX8eeh0eN2I1E0ZFOi0oMTIc5ze8aVNEv9n+wiV1ZLI+PxEGM3O9h5b9PT6ZgMN56PzyRE+hZOix8QltI7xIXcOqKDx9h3Vh2wz5VWKPQEFj/ogQoscELBeP7lva3v4uXWQMNuGFSvr/anOkK+7xFCt4LIoEsn/IAyFUk7ocgzEM2HgJJgH/204jVMQB2e8BVU+UHPow6T0ROiSWg3gGsRuCRPj46UQ9XUtdbYDLK4EXh57B/SsA2mP37J46RV/AaXlFs9mGxL6oYD3254E+SRKx+5qx7BetKLzFo1ok/+atc016YXFPtV9seggi3AWCuBCx1MPTENhjdoY3GvSUxfkVDAz+7HmX4Ok6AApB8olCEAMUnAG/eaGbIg2mts2p+bfHFCBESkfqE6WCTy6R8Tfw0ZVdh+GzOFcjwN8/GSCHoPSwW/VtAYMSUr1bbSdgdI2qt/D4AXRYeVkWG9VRM+7b5jLTMSBgBkdwbtG0lKbpfhvw7YpxE50K7IALEsZQj9AcgpHBt5sJOMFgeloA7mDqAOEDU9/HYhf7EhX18NTFZw+JIHvHsv+5UL8lcxuICYP9xx/gEA==",
                },
                template: {
                    // The plaintext config stays reviewable in git; the
                    // controller renders it as a Go/sprig template with the
                    // decrypted encryptedData as context.
                    data: renderStaticFiles(name, {
                        ref_file: __filename,
                        data: 'static/*',
                    }),
                },
            },
        }, { parent: this });

        // RocksDB and media share one volume (database_path covers both).
        const dataPv = args.serving.base.createLocalStoragePVC(`${name}-data`, {
            storageClassName: args.storageClass,
            resources: {
                requests: {
                    storage: "20Gi"
                }
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            enableServiceLinks: false,
            containers: [{
                name,
                image: versions.image.continuwuity,
                resources: {
                    requests: { cpu: "100m", memory: "512Mi" },
                    limits: { memory: "2Gi" },
                },
                ports: {
                    http: this.port,
                },
                env: {
                    'CONTINUWUITY_CONFIG': '/config/continuwuity.toml',
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
                ],
                // RocksDB compaction/migration after an upgrade can hold the
                // endpoint back for a while on first start.
                startupProbe: {
                    httpGet: { path: "/_matrix/federation/v1/version", port: "http" },
                    periodSeconds: 2,
                    failureThreshold: 150,
                },
                readinessProbe: {
                    httpGet: { path: "/_matrix/federation/v1/version", port: "http" },
                },
            }],
            volumes: [
                {
                    name: 'config',
                    secret: {
                        secretName: secret.metadata.name,
                        // Only the rendered config; the raw id/secret keys ride
                        // in the same Secret and have no business as files.
                        items: [{ key: 'continuwuity.toml', path: 'continuwuity.toml' }],
                    },
                },
                {
                    name: dataPv.metadata.name,
                    persistentVolumeClaim: {
                        claimName: dataPv.metadata.name,
                    },
                },
            ],
            // The PVC is node-local with a Retain policy, so wherever the pod
            // first lands is where the data lives for good. Pin it to the
            // homelab, the node with headroom.
            nodeSelector: args.serving.base.nodes.AetfArchHomelab.hostnameSelectorLabels,
        });

        const deployment = new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/search": "true"
                }
            },
            spec: {
                ...pb.asDeploymentSpec(),
                replicas: 1,
                // No horizontal scaling, and the RWO data volume breaks if a
                // second pod overlaps with the old one.
                strategy: { type: 'Recreate' },
            },
        }, { parent: this });

        const service = serviceFromDeployment(name, deployment, {
            metadata: {
                name,
            },
        });

        args.serving.createFrontendService(name, {
            host: args.host,
            targetService: service,
            // Plain HTTP behind traefik.
            enableMTls: false,
            // Speaks OIDC to Authelia itself; forward-auth would break both
            // the login flow and federation.
            enableAuth: false,
        });

        this.address = pulumi.interpolate`${service.metadata.name}.${service.metadata.namespace}`;
    }
}
