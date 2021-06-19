import * as tsConfigPaths from "tsconfig-paths";
tsConfigPaths.register(undefined as any);

import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

import { BaseCluster } from "./base-cluster";
import { Serving } from "./serving";

function setup() {
    const config = new pulumi.Config();
    const isSetupSecrets = config.requireBoolean("setupSecrets");

    const cluster = new BaseCluster("kluster", { isSetupSecrets }, {
        provider: new k8s.Provider('k8s-provider', {
            namespace: 'kube-system'
        })
    });

    if (isSetupSecrets) {
        return;
    }

    const serving_system = new k8s.core.v1.Namespace("serving-system", {
        metadata: {
            name: "serving-system",
        }
    }, { deleteBeforeReplace: true });

    const serving = new Serving("kluster-serving", {
        base: cluster,
        domain: 'unlimited-code.works',
        externalIPs: [
            "45.77.144.92",
            // TODO: add zerotier-one IP
        ],
        httpPort: 10000,
        httpsPort: 10443,
    }, {
        provider: new k8s.Provider('serving-provider', {
            namespace: serving_system.metadata.name,
        })
    })

}

setup();
