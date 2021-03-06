import { promises as fs } from 'fs';
import * as pathFn from 'path';

import * as _ from 'lodash';
import * as fg from 'fast-glob';

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import * as kx from "@pulumi/kubernetesx";

import * as crds from "#src/crds";

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
    _.unset(obj, 'metadata.annotations["helm.sh/hook"]');
    _.unset(obj, 'metadata.annotations["helm.sh/hook-delete-policy"]')
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
     * @param namePattern: optional search for this name
     */
    public service(namePattern?: RegExp): pulumi.Output<k8s.core.v1.Service> {
        return this.resources.apply(res => {
            const keys = _.keys(res).filter(k => k.startsWith('v1/Service::'));
            let key: string | undefined = undefined;
            if (keys.length === 0) {
                // pass
            } else if (keys.length === 1) {
                key = keys[0];
            } else {
                if (_.isUndefined(namePattern)) {
                    throw new TypeError("Multiple services defined in the chart, specify a selector");
                } else {
                    key = keys.find(k => namePattern.test(k));
                }
            }
            if (_.isUndefined(key)) {
                throw new TypeError("No service defined in the chart");
            }
            return res[key] as k8s.core.v1.Service;
        });
    }
}

export type ConfigMapArgs = Omit<k8s.types.input.core.v1.ConfigMap, 'data'> & {
    /**
     * base directory to start glob
     */
    base: pulumi.Input<string>,
    /**
     * glob pattern for the data
     */
    data: pulumi.Input<string | pulumi.Input<string>[]>,
    stripComponents?: pulumi.Input<number>,
    /**
     * if not null, render template
     */
    tplVariables?: pulumi.Inputs,
};

export class ConfigMap extends kx.ConfigMap {
    constructor(name: string, args: ConfigMapArgs, opts?: pulumi.CustomResourceOptions) {
        const renderedData = pulumi.output(args).apply(async args => {
            const data = await this.globFiles(args.data, args);
            if (_.isUndefined(args.tplVariables)) {
                return data;
            } else {
                // render data with template
                try {
                    return _.mapValues(data, content => {
                        const tpl = _.template(content, { interpolate: /<%=([\s\S]+?)%>/g });
                        return tpl(args.tplVariables);
                    });
                } catch (err) {
                    console.log('Error rendering config map', name, args);
                    throw err;
                    // return data;
                }
            }
        });

        super(name, {
            ...args,
            data: renderedData,
        }, opts);
    }

    private async globFiles(glob: string | string[], args: pulumi.UnwrappedObject<ConfigMapArgs>): Promise<Record<string, string>> {
        const paths = await fg(glob, {
            cwd: args.base,
            onlyFiles: true,
        });
        const contents = await Promise.all(paths.map(path => fs.readFile(pathFn.join(args.base, path), 'utf-8')));
        const stripped = paths.map(p => pathStripComponents(p, args.stripComponents ?? 1));
        return _.fromPairs(_.zip(stripped, contents));
    }
}

/**
 * Remove leading dir components like tar's --strip-component
 * @param path input path
 * @param count 
 * @returns 
 */
function pathStripComponents(path: string, count: number): string {
    const parts = pathFn.normalize(path).split(pathFn.sep);
    if (parts.length > 1 && parts[0] === '.') {
        parts.shift();
    }

    if (count > parts.length - 1) {
        return pathFn.normalize(parts[parts.length - 1]);
    }

    return pathFn.join(...parts.slice(count));
}

export type SealedSecretArgs = Omit<crds.bitnami.v1alpha1.SealedSecretArgs, 'spec'> & {
    readonly spec?: SealedSecretSpecArgs
}

export interface SealedSecretSpecArgs {
    encryptedData: pulumi.Inputs,
}

export interface SecretKeyRef {
    name: string,
    key: string,
}

export class SealedSecret extends crds.bitnami.v1alpha1.SealedSecret {
    constructor(name: string, args: SealedSecretArgs, opts?: pulumi.CustomResourceOptions) {
        // add namespace-wide annotation by default,
        // but also provide a stable name
        const metadata = _.merge({
            name,
            annotations: {
                "sealedsecrets.bitnami.com/namespace-wide": "true",
            },
        }, args.metadata);
        const spec = _.merge({
            template: {
                metadata: {
                    annotations: {
                        "sealedsecrets.bitnami.com/namespace-wide": "true",
                    }
                }
            }
        }, args.spec);
        // only need delete before replce if the name is a stable name
        const deleteBeforeReplace = metadata.name === name;

        super(name, {
            ...args,
            metadata,
            spec,
        }, {
            deleteBeforeReplace,
            ...opts ?? {}
        });
    }

    public mount(destPath: pulumi.Input<string>, srcPath?: pulumi.Input<string>): pulumi.Output<kx.types.VolumeMount> {
        return pulumi.output({
            volume: {
                name: this.metadata.name,
                secret: {
                    secretName: this.metadata.name,
                },
            },
            destPath,
            srcPath,
        });
    }

    public asSecretKeyRef(key: pulumi.Input<string>): pulumi.Output<SecretKeyRef> {
        return pulumi.output({
            name: this.metadata.name,
            key,
        });
    }

    public asEnvValue(key: pulumi.Input<string>): pulumi.Output<k8s.types.input.core.v1.EnvVarSource> {
        return pulumi.output({
            secretKeyRef: this.asSecretKeyRef(key),
        });
    }
}
