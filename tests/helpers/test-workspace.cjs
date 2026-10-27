/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

const projectRoot = fs.realpathSync(path.resolve(__dirname, '../..'))
const dataRoot = path.join(projectRoot, '.test-data')
const owned = new Map()

function inside(base, target, allowSelf = false) {
    const relative = path.relative(base, target)

    return (
        (allowSelf || relative !== '') &&
        relative !== '..' &&
        !relative.startsWith('..' + path.sep) &&
        !path.isAbsolute(relative)
    )
}

function pathKey(value) {
    const absolute = path.resolve(value)
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function assertProjectPath(value) {
    const absolute = path.resolve(value)

    if (!inside(projectRoot, absolute)) {
        throw new Error('TEST_PATH_OUTSIDE_PROJECT')
    }

    let current = projectRoot

    for (const segment of path.relative(projectRoot, absolute).split(path.sep)) {
        current = path.join(current, segment)

        let info

        try {
            info = fs.lstatSync(current)
        } catch (error) {
            if (error.code === 'ENOENT') break
            throw error
        }

        if (info.isSymbolicLink() || pathKey(fs.realpathSync(current)) !== pathKey(current)) {
            throw new Error('TEST_PATH_LINK_NOT_ALLOWED')
        }
    }

    return absolute
}

function ensureDirectory(directory) {
    assertProjectPath(directory)
    fs.mkdirSync(directory, { recursive: false })
    assertProjectPath(directory)
}

function ensureExistingDirectory(directory) {
    assertProjectPath(directory)

    if (!fs.existsSync(directory)) {
        ensureDirectory(directory)
    }

    if (!fs.lstatSync(directory).isDirectory()) {
        throw new Error('TEST_DIRECTORY_INVALID')
    }
}

function createTestWorkspace(name) {
    if (
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)
    ) {
        throw new Error('TEST_NAME_INVALID')
    }

    ensureExistingDirectory(dataRoot)

    const group = path.join(dataRoot, name)
    ensureExistingDirectory(group)

    const id = randomUUID()
    const directory = path.join(group, `run-${id}`)

    ensureDirectory(directory)

    fs.writeFileSync(
        path.join(directory, '.workspace.json'),
        JSON.stringify({ version: 1, projectRoot, id }),
        { flag: 'wx' }
    )

    owned.set(directory, fs.lstatSync(directory, { bigint: true }))

    return directory
}

function readWorkspace(value) {
    const directory = assertProjectPath(value)
    const parts = path.relative(dataRoot, directory).split(path.sep)

    if (parts.length !== 2 || !parts[1].startsWith('run-')) {
        throw new Error('TEST_WORKSPACE_INVALID')
    }

    const markerPath = assertProjectPath(path.join(directory, '.workspace.json'))

    const info = fs.lstatSync(markerPath)

    if (!info.isFile() || info.size > 4096) {
        throw new Error('TEST_WORKSPACE_INVALID')
    }

    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))

    if (
        marker.version !== 1 ||
        marker.projectRoot !== projectRoot ||
        parts[1] !== `run-${marker.id}`
    ) {
        throw new Error('TEST_WORKSPACE_INVALID')
    }

    return { directory, marker }
}

function testPath(root, ...segments) {
    const { directory } = readWorkspace(root)
    const target = assertProjectPath(path.resolve(directory, ...segments))

    if (!inside(directory, target, true)) {
        throw new Error('TEST_PATH_OUTSIDE_WORKSPACE')
    }

    return target
}

function testEnvironment(root) {
    const { directory, marker } = readWorkspace(root)

    function folder(name) {
        const destination = testPath(directory, name)
        ensureExistingDirectory(destination)
        return destination
    }

    const temporary = folder('temp')

    const environment = {
        ...process.env,
        STORAGEBUCKET_TEST_ROOT: directory,
        STORAGEBUCKET_TEST_ID: marker.id,
        TEMP: temporary,
        TMP: temporary,
        TMPDIR: temporary,
        APPDATA: folder('appData'),
        LOCALAPPDATA: folder('localAppData'),
        XDG_CACHE_HOME: folder('cache'),
        XDG_CONFIG_HOME: folder('config'),
        NODE_COMPILE_CACHE: folder('node-cache')
    }

    if (process.env.NODE_V8_COVERAGE) {
        environment.NODE_V8_COVERAGE = folder('coverage')
    }

    return environment
}

function requireTestWorkspace() {
    const value = process.env.STORAGEBUCKET_TEST_ROOT

    if (!value) {
        throw new Error('격리 테스트 실행기를 통해 실행해 주세요.')
    }

    const { directory, marker } = readWorkspace(value)

    if (process.env.STORAGEBUCKET_TEST_ID !== marker.id) {
        throw new Error('TEST_WORKSPACE_ID_MISMATCH')
    }

    return directory
}

function cleanupTestWorkspace(root) {
    const expected = owned.get(root)

    if (!expected) {
        throw new Error('TEST_WORKSPACE_NOT_OWNED')
    }

    const { directory } = readWorkspace(root)
    const current = fs.lstatSync(directory, { bigint: true })

    if (current.dev !== expected.dev || current.ino !== expected.ino) {
        throw new Error('TEST_WORKSPACE_CHANGED')
    }

    fs.rmSync(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
    })

    owned.delete(root)
}

module.exports = {
    projectRoot,
    createTestWorkspace,
    cleanupTestWorkspace,
    testPath,
    testEnvironment,
    requireTestWorkspace
}
