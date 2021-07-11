import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";
import _ = require("lodash");

export function setAndRegisterOutputs(obj: any, outputs: pulumi.Inputs) {
    for (const key in outputs) {
        obj[key] = outputs[key];
    }
    obj.registerOutputs(outputs);
}

export function chartNamingWorkaround(obj: any, opts: pulumi.CustomResourceOptions) {
    opts.deleteBeforeReplace = true;
}

export function removeHelmTestAnnotation(obj: any, opts: pulumi.CustomResourceOptions) {
    _.unset(obj, 'metadata.annotations["helm.sh/hook"]')
}

export function urlFromService(service: k8s.core.v1.Service, schema: string): pulumi.Output<string> {
    return pulumi.all([service.metadata, service.spec])
        .apply(([metadata, spec]) => {
            const port = _.find(spec.ports, v => v.name === schema || v.name.startsWith(schema) || v.name.endsWith(schema));
            const portNumber = port?.port;
            if (_.isUndefined(portNumber)) {
                return `${schema}://${metadata.name}.${metadata.namespace}`;
            } else {
                return `${schema}://${metadata.name}.${metadata.namespace}:${portNumber}`;
            }
        });
}

/**
 * Workaround until deployment.createService allows set physical name
 * See https://github.com/pulumi/pulumi-kubernetesx/issues/52
 */
export function serviceFromDeployment(
    name: string,
    d: kx.Deployment,
    args?: Omit<kx.types.Service, 'spec'> & { spec?: kx.types.ServiceSpec }
): kx.Service {
    const serviceSpec = pulumi
        .all([d.spec.template.spec.containers, args?.spec ?? {}])
        .apply(([containers, spec]) => {
            const ports: Record<string, number> = {};
            containers.forEach(container => {
                if (container.ports) {
                    container.ports.forEach(port => {
                        ports[port.name] = port.containerPort;
                    });
                }
            });
            return {
                ...spec,
                ports: spec.ports ?? ports,
                selector: d.spec.selector.matchLabels,
            };
        });

    const metadata: k8s.types.input.meta.v1.ObjectMeta = {
        namespace: d.metadata.namespace,
        ...args?.metadata ?? {},
    };
    const deleteBeforeReplace = !_.isUndefined(metadata.name);
    return new kx.Service(name, {
        metadata,
        spec: serviceSpec,
    }, {
        parent: d,
        deleteBeforeReplace,
    });
}

export class NamespaceProbe extends pulumi.ComponentResource {
    public readonly namespace!: pulumi.Output<string>;

    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super('kluster:utils:NamespaceProbe', name, {}, opts);

        const cm = new k8s.core.v1.ConfigMap(name, {
            data: {
                comment: 'This is a workaround for pulumi not able to get namespace from the provider.'
            }
        }, { parent: this });

        setAndRegisterOutputs(this, {
            namespace: cm.metadata.namespace
        });
    }
}

export class HelmChart extends k8s.helm.v3.Chart {
    constructor(releaseName: string, config: k8s.helm.v3.ChartOpts | k8s.helm.v3.LocalChartOpts, opts?: pulumi.ComponentResourceOptions) {
        const transformations = [
            chartNamingWorkaround,
            ...config.transformations ?? []
        ];
        super(releaseName, {
            ...config,
            transformations,
        }, opts);
    }

    /**
     * Returns the first service
     */
    public get service(): pulumi.Output<k8s.core.v1.Service | undefined> {
        return this.resources.apply(res => {
            const key = _.keys(res).find(k => k.startsWith('v1/Service::'));
            if (!_.isUndefined(key)) {
                return res[key] as k8s.core.v1.Service;
            }
            return undefined;
        });
    }
}
