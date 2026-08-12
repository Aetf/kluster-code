import * as dns from "dns";
import * as pulumi from "@pulumi/pulumi";
import * as kx from "@pulumi/kubernetesx";

import { ConfigMap, Node, SealedSecret } from "#src/utils";
import { versions } from "#src/config";

// k3s defaults, as configured on this cluster.
const podCidr = '10.42.0.0/16';
const serviceCidr = '10.43.0.0/16';
// The ZeroTier network the two nodes are joined over. k3s uses those addresses
// as the nodes' InternalIP, so it is also what the endpoint host resolves to.
const underlayCidr = '10.144.0.0/16';

// A /30 that exists only inside the tunnel.
const gatewayAddress = '10.210.0.1';
const clientAddress = '10.210.0.2';
const tunnelSubnet = '10.210.0.0/30';
const prefixLength = 30;

const port = 51820;
// The usual WireGuard-over-1500 figure. eth0 on both ends is 2800 (ZeroTier),
// but the hop past the gateway is a plain internet path, so size for that one.
const mtu = 1420;

const scriptPath = '/opt/egress';
const gatewayKeyPath = '/etc/wireguard/gateway.key';
const clientKeyPath = '/etc/wireguard/client.key';

// The private halves live in the SealedSecret below.
const gatewayPublicKey = '8Y0VA/JbXsPq5mIfZtrwRVM78p7UZGofY+FERBvXmHk=';
const clientPublicKey = 'tRjfWciQaPwJ3oi3cOPBiWnQzEc/OhEq2msqbq4lPWU=';

export interface EgressGatewayArgs {
    /** Node whose public IP outbound traffic should appear to come from. */
    node: Node,
    /** Name resolving to `node`'s address on the underlay network. */
    endpointHost: pulumi.Input<string>,
}

/**
 * Routes one pod's egress out through another node.
 *
 * A pod's outbound traffic is masqueraded to whichever node it happens to run
 * on, which is a problem for anything whose peers expect a fixed source address
 * -- hath, whose inbound LoadBalancer sits on the vps while its data lives on
 * homelab, being the case this was built for.
 *
 * The gateway is a pod pinned to `node`, terminating a WireGuard tunnel and
 * NATing what comes out of it to its own eth0. Since it is an ordinary pod,
 * flannel then masquerades that to `node`'s public address -- so the source IP
 * falls out of where the gateway pod is scheduled, with no host-level rule and
 * no root on either machine.
 *
 * Clients opt in with `clientInitContainer()`, which rewrites the default route
 * in their own network namespace. That is what keeps this per-pod: a route or
 * policy on the host would apply to every pod on the node.
 *
 * Clients must be in the same namespace, as they mount the key material here.
 */
export class EgressGateway extends pulumi.ComponentResource<EgressGatewayArgs> {
    private readonly secret: SealedSecret;
    private readonly scripts: ConfigMap;

    constructor(name: string, args: EgressGatewayArgs, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:EgressGateway', name, args, opts);

        // Resolved at eval time, the same way haos reaches across the tunnel.
        const endpointIP = pulumi.output(args.endpointHost).apply(async host => {
            const result = await dns.promises.lookup(host);
            return result.address;
        });

        this.secret = new SealedSecret(name, {
            spec: {
                encryptedData: {
                    gateway_privkey: "AgAemfOCHegIC9qdcPZx68OpGYBhhREsgv8WAARQAK7enFAZzzEZweI1gK2FixoLwnI7Byn1WXoxp4olofPmdR9bUAWvf/bDdyx8tTDUEjQHIPITuGIPrhH+W+GlpaSDoMFLiZw27soEtHtkDzxdYuYyQX6jSuPiFmwu/L1z0hfjWh2cdnOmIiTTOOhQpdPidQJtoQ4a6ziw/uhOHz8WKUkGLJegTH5Te/eNRsuwXGY2TU7QWUbv7W6ucBmpPsPxJ8DpOoXKDC/sV7VowGLsonBh3Qeo/1Mp+iyDXFI0gzh7UPlJFFa6wLzpsfXYYi+Wyaug41AwowbOkX73KbVuInpK+JbUIXFsMlseU3KafFEQOWMwEVtfbDRdGp9O6cgq7JdYET7XoS2rHSFxxMsvJpp/OKQTWc72DRGs00aNFUlnJvhHQzdlb+AZRB4rJRq8ZC+c3f1JiSJ4/9FW+JSt5RZK/4R+s26D8bq4PGCuCoHsx9G3DOKYFWvBNR1iBbNu3+mec/NqwBKaY+K3sUTL0YBzFgdj4GTlSosBusuoGRoGnIB8qdx3+CZ6r68N/Ij398rB+DzOy3Ma+lei4S8JWJ51YdKCRLaS5Dz8/4oJYzAWQ4/GzpjczWseKQJHGVmuo2Ni/MQfJ/3dKmCv+IYXKaKfXxfRJRCE1VAnICUzEGfG6tB6GGF6CTtIV4Qc6S9ZcoKFENNVSRpOxf1GBL483RhTRfk/vnUDJqB/7AvA5sKi3UEP6P24bvleDNm/lw==",
                    client_privkey: "AgCwOVsa911WHM33q0PKXfH2CN8hUA14Olq4YseHvW3iK2tyF+RUX/WOPIAnD9qpXKNZYv9tQQMzUEAA/RSjjJXnyfpW1VcIN+Efz++AVex+m+RodHGobi8QBaFlFf4eYlreqYt3OfeQw2pR51pY5IP59Lefo+vVpJXkWffNWtSeT3hFRTNmNP+JMhpzFYwEOVtkGB4mpBISnCaPUH6cju18ovAZwK5R2AwHnDCEpX4sBS1ThQq6FgwJ+KjJlAru94o91Y7HomkCiG05PquzzTm0qV3+7KlHk5um86GPLG7vIk+e6wXIzUw3vQQAhoRXK91/CFjaWbi4Nm7cn6XfpLYDdqds0EXH9yuN1WKJTGI3H/h1peLNaI5gQC5svKlUi+S2q2/3dh1xmyO/qXogA9KL2mbke10uGGuzvA7c+RXHjbAkKhUsojQXzRyTQrcdfPVU3dZLvpc7MCDdwQf42eBx4DZ53yRlqjMQJ3ZBpu2QFCZbaFy8xsF+kG8Qtt5qwJM2RVLbBsZQSRW48jfvXXxuidxpDl74xsjPrcFnvOj7s84qq3GzuaIsC7eGQnFsma6RUnzdkhydM2O6GLYS8GUmLEFWsY8pMJYSb0g5E2K8uCuEwmyDbFU8RinwOLeSQ95rszCIBvsUgt2sV/hFs8Qv5ZwklQ1WDuAPqIEKT73hJNwKwiMu/aX6jSy2EZCCjbT7SRfLHXQjt4FJPWqCu7a90gEb6cZUgEgQZAt8fV4yCyNNQdhmsqr4z1M+3w==",
                }
            }
        }, { parent: this });

        this.scripts = new ConfigMap(name, {
            ref_file: __filename,
            data: 'static/*',
            stripComponents: 1,
            tplVariables: {
                podCidr, serviceCidr, underlayCidr,
                gatewayAddress, clientAddress, tunnelSubnet, prefixLength,
                port, mtu,
                gatewayKeyPath, clientKeyPath,
                gatewayPublicKey, clientPublicKey,
                endpoint: pulumi.interpolate`${endpointIP}:${port}`,
            }
        }, { parent: this });

        const pb = new kx.PodBuilder({
            restartPolicy: 'Always',
            nodeSelector: args.node.hostnameSelectorLabels,
            securityContext: {
                // Namespaced and, since k8s 1.29, a safe sysctl -- the svclb
                // pods this cluster already runs set it the same way.
                sysctls: [{ name: 'net.ipv4.ip_forward', value: '1' }],
            },
            containers: [{
                name,
                image: versions.image.wireguard,
                // Skip the image's s6 entrypoint, we only want its tools.
                command: ['/bin/sh', `${scriptPath}/gateway.sh`],
                resources: {
                    requests: { cpu: "10m", memory: "32Mi" },
                    limits: { cpu: "500m", memory: "128Mi" },
                },
                ports: [{
                    name: 'wireguard',
                    protocol: 'UDP',
                    containerPort: port,
                    hostPort: port,
                    // Bind to the underlay only, so the endpoint isn't also
                    // listening on the node's public address.
                    hostIP: endpointIP,
                }],
                securityContext: {
                    capabilities: {
                        add: ['NET_ADMIN'],
                    }
                },
                volumeMounts: [
                    this.scripts.mount(scriptPath),
                    this.secret.mount(gatewayKeyPath, 'gateway_privkey'),
                ],
            }],
        });

        new kx.Deployment(name, {
            metadata: {
                annotations: {
                    "reloader.stakater.com/auto": "true"
                }
            },
            // Recreate, not the default RollingUpdate: the hostPort below can
            // only be held by one pod per node, so a surge replica would sit
            // Pending on "didn't have free ports" while the rollout waits for
            // it to go Ready -- a deadlock. Take the old pod down first and
            // accept a few seconds without a tunnel; WireGuard re-handshakes on
            // its own and clients keep their routes across the gap.
            spec: pb.asDeploymentSpec({ strategy: { type: 'Recreate' } }),
        }, { parent: this });

        this.registerOutputs({});
    }

    /**
     * Init container replacing the enclosing pod's default route with this
     * gateway. Needs NET_ADMIN; the app container itself needs nothing.
     *
     * Deliberately an init container and not a sidecar: kernel WireGuard is
     * state in the network namespace, not a process, so there is nothing left
     * to keep running once it is set up.
     */
    public clientInitContainer(name: string): pulumi.Input<kx.types.Container> {
        return {
            name,
            image: versions.image.wireguard,
            command: ['/bin/sh', `${scriptPath}/client.sh`],
            securityContext: {
                capabilities: {
                    add: ['NET_ADMIN'],
                }
            },
            volumeMounts: [
                this.scripts.mount(scriptPath),
                this.secret.mount(clientKeyPath, 'client_privkey'),
            ],
        };
    }

    protected async initialize(args: pulumi.Inputs): Promise<EgressGatewayArgs> {
        return args as EgressGatewayArgs;
    }
}
