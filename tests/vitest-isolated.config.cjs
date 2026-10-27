/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path')
const { projectRoot, requireTestWorkspace, testPath } = require('./helpers/test-workspace.cjs')

const workspace = requireTestWorkspace()

module.exports = {
    root: projectRoot,
    envDir: testPath(workspace, 'config'),
    cacheDir: testPath(workspace, 'vite-cache'),

    resolve: {
        alias: {
            '@features': path.resolve(projectRoot, 'src/main/features')
        }
    },

    test: {
        watch: false,
        cache: false
    }
}
