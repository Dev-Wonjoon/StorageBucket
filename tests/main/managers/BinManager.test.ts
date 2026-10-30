import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    createTestWorkspace,
    cleanupTestWorkspace,
    requireTestWorkspace,
    testPath
} from '../../helpers/test-workspace.cjs'

const fixture = vi.hoisted(() => ({
    root: '',
    version: '1.32.1',
    packaged: false
}))

vi.mock('electron', () => ({
    app: {
        get isPackaged() {
            return fixture.packaged
        },
        getAppPath: () => fixture.root,
        getPath: (name: string) => {
            if (name === 'userData') {
                return testPath(fixture.root, 'profile')
            }

            if (name === 'exe') {
                return testPath(fixture.root, 'program', 'storagebucket.exe')
            }

            throw new Error('허용하지 않은 테스트 경로입니다.')
        }
    }
}))

vi.mock('@features/settings/ConfigManager', () => ({
    ConfigManager: {
        getInstance: () => ({
            getBasePath: () => fixture.root
        })
    }
}))

vi.mock('node:child_process', () => ({
    execFile: vi.fn(
        (
            _file: string,
            _args: string[],
            _options: unknown,
            callback: (error: Error | null, stdout: string, stderr: string) => void
        ) => {
            callback(null, `${fixture.version}\n`, '')
            return {}
        }
    )
}))

requireTestWorkspace()
describe.skipIf(process.platform !== 'win32')('BinManager 설치', () => {
    let bin: ReturnType<
        (typeof import('../../../src/main/features/engines/BinManager'))['BinManager']['getInstance']
    >
    let executable: string

    beforeEach(async () => {
        vi.resetModules()
        vi.stubEnv('PORTABLE_EXECUTABLE_DIR', '')

        fixture.root = createTestWorkspace('engine-install')
        fixture.version = '1.32.1'
        fixture.packaged = false

        executable = testPath(fixture.root, 'bin', 'gallery-dl.exe')

        // 실제 네트워크 요청 없이 실행 파일 응답을 모의한다.
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(new Uint8Array([0x4d, 0x5a, 1, 2])))
        )

        const { BinManager } = await import('../../../src/main/features/engines/BinManager')

        bin = BinManager.getInstance()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        vi.unstubAllEnvs()
        vi.restoreAllMocks()

        cleanupTestWorkspace(fixture.root)
        fixture.root = ''
    })

    it('고정 버전을 Codeberg에서 받아 영구 경로에 설치한다', async () => {
        expect(await bin.downloadEngine('gallery-dl')).toBe(true)

        expect(fetch).toHaveBeenCalledWith(
            'https://codeberg.org/mikf/gallery-dl/releases/download/v1.32.1/gallery-dl.exe',
            expect.objectContaining({
                signal: expect.any(AbortSignal)
            })
        )

        expect(bin.getBinaryPath('gallery-dl')).toBe(executable)
        expect(await readFile(executable)).toEqual(Buffer.from([0x4d, 0x5a, 1, 2]))
        expect(await readdir(join(fixture.root, 'bin'))).toEqual(['gallery-dl.exe'])
    })

    it('다운로드 실패 시 기존 엔진을 보존한다', async () => {
        await mkdir(join(fixture.root, 'bin'))
        await writeFile(executable, 'existing-engine')

        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(null, { status: 404 }))
        )

        expect(await bin.downloadEngine('gallery-dl')).toBe(false)
        expect(await readFile(executable, 'utf8')).toBe('existing-engine')
        expect(await readdir(join(fixture.root, 'bin'))).toEqual(['gallery-dl.exe'])
    })

    it('버전이 다르면 기존 엔진을 교체하지 않는다', async () => {
        await mkdir(join(fixture.root, 'bin'))
        await writeFile(executable, 'existing-engine')

        fixture.version = '1.32.99'

        expect(await bin.downloadEngine('gallery-dl')).toBe(false)
        expect(await readFile(executable, 'utf8')).toBe('existing-engine')
    })

    it('HTML 등 실행 파일이 아닌 응답을 설치하지 않는다', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response('<html>download error</html>'))
        )

        expect(await bin.downloadEngine('gallery-dl')).toBe(false)
        expect(await readdir(join(fixture.root, 'bin'))).toEqual([])
    })

    it('설치형의 엔진은 프로그램 폴더 밖의 사용자 데이터에 저장한다', async () => {
        fixture.packaged = true

        const installed = testPath(fixture.root, 'profile', 'bin', 'gallery-dl.exe')

        expect(await bin.downloadEngine('gallery-dl')).toBe(true)
        expect(bin.getBinaryPath('gallery-dl')).toBe(installed)
        expect(await readFile(installed)).toEqual(Buffer.from([0x4d, 0x5a, 1, 2]))

        expect(await readdir(testPath(fixture.root, 'profile', 'bin'))).toEqual(['gallery-dl.exe'])
    })
})
