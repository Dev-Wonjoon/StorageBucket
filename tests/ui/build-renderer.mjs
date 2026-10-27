import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import workspaceTools from '../helpers/test-workspace.cjs'

const {
    projectRoot,
    requireTestWorkspace,
    testPath
} = workspaceTools

const workspace = requireTestWorkspace()
const rendererRoot = resolve(projectRoot, 'src/renderer')

const envDirectory = testPath(workspace, 'config')
const cacheDirectory = testPath(workspace, 'vite-cache')
const outputDirectory = testPath(workspace, 'renderer')

for (const directory of [
    envDirectory,
    cacheDirectory,
    outputDirectory
]) {
    await mkdir(directory, { recursive: true })
}

await build({
    configFile: false,
    root: rendererRoot,
    base: './',
    envDir: envDirectory,
    cacheDir: cacheDirectory,

    resolve: {
        alias: {
            '@renderer': resolve(rendererRoot, 'src')
        }
    },

    plugins: [react(), tailwindcss()],

    build: {
        outDir: outputDirectory,
        emptyOutDir: false
    }
})

console.log('테스트 렌더러:', outputDirectory)