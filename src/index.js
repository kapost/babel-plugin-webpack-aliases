
import { join, resolve, relative, isAbsolute, dirname } from 'path';
import { StringLiteral } from 'babel-types';
import findUp from 'find-up';

const DEFAULT_WEBPACK_PATH = 'webpack.config.js';

function getConfig ({
    config: configPath = DEFAULT_WEBPACK_PATH,
    findConfig = false
}) {
    // Get webpack config
    let resolvedConfigPath = findConfig ? findUp.sync(configPath) : resolve(process.cwd(), configPath);

    let requiredConfig = require(resolvedConfigPath);
    if (requiredConfig && requiredConfig.__esModule) {
        requiredConfig = requiredConfig.default;
    }

    let config = requiredConfig;
    if (typeof requiredConfig === 'function') {
        config = requiredConfig(process.env.NODE_ENV);
    }

    return config;
}

function transformFilePathWithAliases (aliasConf, filePath, currentWorkingDirectory) {
    let requiredFilePath = filePath;

    for (let aliasFrom in aliasConf) {
        if (aliasConf.hasOwnProperty(aliasFrom)) {
            let aliasTo = aliasConf[aliasFrom];

            // If the filepath is not absolute, make it absolute
            if (!isAbsolute(aliasTo)) {
                aliasTo = join(process.cwd(), aliasTo);
            }

            let regex = new RegExp(`^${aliasFrom}(\/|$)`);

            // If the regex matches, replace by the right config
            if (regex.test(filePath)) {
                let relativeFilePath = relative(currentWorkingDirectory, aliasTo).replace(/\\/g, '/');

                // In case the file path is the root of the alias, need to put a dot to avoid having an absolute path
                if (relativeFilePath.length === 0) {
                    relativeFilePath = '.';
                }

                requiredFilePath = filePath.replace(aliasFrom, relativeFilePath);

                // In the unfortunate case of a file requiring the current directory which is the alias, we need to add
                // an extra slash
                if (requiredFilePath === '.') {
                    requiredFilePath = './';
                }

                return requiredFilePath;
            }
        }
    }

    return requiredFilePath;
}

export default function transformImportsWithAliases ({ types: t }) {
    return {
        visitor: {
            ImportDeclaration(path, {
                file: { opts: { filename } },
                opts = {
                    config: DEFAULT_WEBPACK_PATH,
                    findConfig: false
                }
            }) {
                // Get webpack config
                const conf = getConfig(opts);

                // If the config comes back as null, we didn't find it, so throw an exception.
                if (conf === null) {
                    throw new Error(`Cannot find configuration file: ${opts.config}`);
                }

                // Exit if there's no alias config
                if (!conf.resolve || !conf.resolve.alias) {
                    return;
                }

                // Get the webpack alias config
                const aliasConf = conf.resolve.alias;

                const { source } = path.node;
                // Exit if the import path is not a string literal
                if (!t.isStringLiteral(source)) {
                    return;
                }

                // Get the path of the StringLiteral
                const originalFilePath = source.value;
                const requiredFilePath = transformFilePathWithAliases(aliasConf, originalFilePath, dirname(filename));

                path.node.source = StringLiteral(requiredFilePath);
            },
            CallExpression(path, {
                file: { opts: { filename } },
                opts = {
                    config: DEFAULT_WEBPACK_PATH,
                    findConfig: false
                }
            }) {
                // Get webpack config
                const conf = getConfig(opts);

                // If the config comes back as null, we didn't find it, so throw an exception.
                if (conf === null) {
                    throw new Error(`Cannot find configuration file: ${opts.config}`);
                }

                // Exit if there's no alias config
                if (!conf.resolve || !conf.resolve.alias) {
                    return;
                }

                // Get the webpack alias config
                const aliasConf = conf.resolve.alias;

                const { callee: { name: calleeName }, arguments: args } = path.node;
                // Exit if it's not a require statement
                if (calleeName !== 'require' || !args.length || !t.isStringLiteral(args[0])) {
                    return;
                }

                // Get the path of the StringLiteral
                const originalFilePath = args[0].value;
                const requiredFilePath = transformFilePathWithAliases(aliasConf, originalFilePath, dirname(filename));

                path.node.arguments = [ StringLiteral(requiredFilePath) ];
            }
        }
    };
}
