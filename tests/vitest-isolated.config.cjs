/* eslint-disable @typescript-eslint/no-require-imports */
const { projectRoot, requireTestWorkspace, testPath } = require('./helpers/test-workspace.cjs')

const workspace = requireTestWorkspace()

module.exports = {
    root: projectRoot,
    envDir: testPath(workspace, 'config'),
    cacheDir: testPath(workspace, 'vite-cache'),
    test: {
        watch: false,
        cache: false
    }
}
