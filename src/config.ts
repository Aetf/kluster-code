import * as pulumi from "@pulumi/pulumi";

/**
 * get property key name
 */
function propertyKeyName(prop: PropertyKey) : string {
    // get a string key from prop
    let key: string;
    if (typeof prop === "symbol") {
        const propKey = Symbol.keyFor(prop);
        if (!propKey) {
                throw TypeError("Can not access config with unknown symbol key");
        }
        key = propKey;
    } else if (typeof prop === "string") {
        key = prop;
    } else {
        throw TypeError("Can not access config with number key");
    }
    return key;
}

class VersionHandler implements ProxyHandler<Record<string, string>> {
    private _config: pulumi.Config
    constructor(config: pulumi.Config) {
        this._config = config
    }

    get(_: Record<string, string>, prop: PropertyKey) {
        // get a string key from prop
        const key = propertyKeyName(prop);
        return this._config.require(key);
    }
}

interface Versions {
    readonly image: Record<string, string>
    readonly chart: Record<string, string>
}
export const versions: Versions = {
    image: new Proxy({}, new VersionHandler(new pulumi.Config('image'))),
    chart: new Proxy({}, new VersionHandler(new pulumi.Config('chart'))),
};

interface Config {
    readonly setupSecrets: boolean
    readonly staging: boolean
    readonly enableMc: boolean
}
class ConfigHandler implements ProxyHandler<Config> {
    private _config: pulumi.Config
    constructor(config: pulumi.Config) {
        this._config = config
    }

    get(_: Config, prop: PropertyKey) {
        // get a string key from prop
        const key = propertyKeyName(prop);
        return this._config.requireBoolean(key);
    }
}
export const config = new Proxy({} as Config, new ConfigHandler(new pulumi.Config()));

