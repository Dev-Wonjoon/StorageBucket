/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const {
    projectRoot,
    createTestWorkspace,
    testPath,
    testEnvironment
} = require('./helpers/test-workspace.cjs')

const targets = {
    'thumbnail-smoke': {
        type: 'electron',
        entry: 'tests/ui/thumbnail-smoke.cjs'
    },
    'ui-smoke': {
        type: 'electron',
        entry: 'tests/ui/smoke.cjs'
    },
    'thumbnail-unit': {
        type: 'vitest',
        files: [
            'tests/main/services/DownloadThumbnailService.test.ts',
            'tests/main/repositories/DownloadCommitRepository.test.ts',
            'tests/main/repositories/MediaRepository.test.ts',
            'tests/preload/api.test.ts'
        ]
    },
    'download-unit': {
        type: 'vitest',
        files: [
            'tests/main/services/DownloadRuntime.test.ts',
            'tests/main/services/YouTubeDownload.test.ts',
            'tests/main/services/DownloadEngineRouting.test.ts',
            'tests/main/services/DownloadEngineSelection.test.ts',
            'tests/main/services/YtdlpPolicy.test.ts'
        ]
    },
    'gallery-dl-smoke': {
        type: 'vitest',
        files: ['tests/main/services/GalleryDlAdapter.test.ts']
    },
    'instagram-smoke': {
        type: 'vitest',
        files: ['tests/main/services/InstagramDownload.smoke.test.ts']
    },
    'distribution-unit': {
        type: 'vitest',
        files: [
            'tests/main/infrastructure/DistributionPaths.test.ts',
            'tests/main/managers/BinManager.test.ts'
        ]
    }
}

const name = process.argv[2]
const target = targets[name]

if (!target) {
    throw new Error(
        '사용법: node tests/run-isolated.cjs ' +
            '[thumbnail-unit|thumbnail-smoke|ui-smoke|download-unit|gallery-dl-smoke|instagram-smoke]'
    )
}

const workspace = createTestWorkspace(name)
const environment = testEnvironment(workspace)

const realEngineSmoke = name === 'gallery-dl-smoke' || name === 'instagram-smoke'

if (realEngineSmoke) {
    if (process.platform !== 'win32') {
        throw new Error('실제 엔진 테스트는 Windows에서 실행해 주세요.')
    }

    const testProfile = testPath(workspace, 'profile')
    fs.mkdirSync(testProfile)

    // 실제 사용자 프로필을 사용하지 않는다.
    environment.USERPROFILE = testProfile
    environment.HOME = testProfile
    environment.HOMEDRIVE = path.parse(testProfile).root.replace(/[\\/]$/, '')
    environment.HOMEPATH = testProfile.slice(environment.HOMEDRIVE.length)
    environment.PYTHONDONTWRITEBYTECODE = '1'
}

if (name === 'gallery-dl-smoke') {
    environment.STORAGEBUCKET_GALLERYDL_SMOKE = '1'

    // 로컬 서버 테스트에만 적용한다.
    environment.NO_PROXY = '*'
    environment.no_proxy = '*'
} else {
    delete environment.STORAGEBUCKET_GALLERYDL_SMOKE
}

if (name === 'download-unit') {
    delete environment.STORAGEBUCKET_LIVE_YOUTUBE
    delete environment.STORAGEBUCKET_ENGINE_HOST_SMOKE
}

let executable
let args

if (target.type === 'electron') {
    executable = require('electron')

    if (typeof executable !== 'string') {
        throw new Error('이 실행기는 node 명령으로 실행해 주세요.')
    }

    delete environment.ELECTRON_RUN_AS_NODE
    args = [path.join(projectRoot, target.entry)]
} else {
    executable = process.execPath

    args = [
        path.join(projectRoot, 'node_modules/vitest/vitest.mjs'),
        'run',
        ...target.files,
        '--config',
        path.join(projectRoot, 'tests/vitest-isolated.config.cjs'),
        '--configLoader',
        'native'
    ]
}

const stdout = fs.openSync(testPath(workspace, 'stdout.log'), 'wx')
const stderr = fs.openSync(testPath(workspace, 'stderr.log'), 'wx')

console.log('테스트 데이터:', workspace)

let activeChild
let interrupted = false

process.once('SIGINT', () => {
    interrupted = true
    activeChild?.kill()
})

function runChild(command, commandArgs) {
    return new Promise((resolve) => {
        let failedToStart = false

        const child = spawn(command, commandArgs, {
            cwd: projectRoot,
            env: environment,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        })

        activeChild = child

        child.stdout.on('data', (data) => {
            fs.writeSync(stdout, data)
            process.stdout.write(data)
        })

        child.stderr.on('data', (data) => {
            fs.writeSync(stderr, data)
            process.stderr.write(data)
        })

        child.once('error', (error) => {
            failedToStart = true

            const message = String(error) + '\n'

            fs.writeSync(stderr, message)
            process.stderr.write(message)
        })

        child.once('close', (code) => {
            if (activeChild === child) {
                activeChild = undefined
            }

            resolve(failedToStart ? 1 : (code ?? 1))
        })
    })
}

async function main() {
    try {
        if (name === 'ui-smoke') {
            const buildCode = await runChild(process.execPath, [
                path.join(projectRoot, 'tests/ui/build-renderer.mjs')
            ])

            if (interrupted) return 130
            if (buildCode !== 0) return buildCode
        }

        if (interrupted) return 130

        const code = await runChild(executable, args)

        return interrupted ? 130 : code
    } finally {
        fs.closeSync(stdout)
        fs.closeSync(stderr)

        console.log('\n테스트 산출물:', workspace)
    }
}

void main().then(
    (code) => {
        process.exitCode = code
    },
    (error) => {
        console.error(error)
        process.exitCode = 1
    }
)
