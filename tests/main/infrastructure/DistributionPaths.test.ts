import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    getAppDataPath,
    getDatabasePath,
    getDefaultDownloadPath,
    getWritableBasePath
} from '../../../src/main/infrastructure/portablePath'
import { requireTestWorkspace, testPath } from '../../helpers/test-workspace.cjs'

const fixture = vi.hoisted(() => ({
    packaged: true,
    project: '',
    userData: '',
    downloads: ''
}))

vi.mock('electron', () => ({
    app: {
        get isPackaged() {
            return fixture.packaged
        },
        getAppPath: () => fixture.project,
        getPath: (name: string) => {
            if (name === 'userData') return fixture.userData
            if (name === 'downloads') return fixture.downloads
            throw new Error('허용하지 않은 테스트 경로입니다.')
        }
    }
}))

const workspace = requireTestWorkspace()

beforeEach(() => {
    fixture.packaged = true
    fixture.project = testPath(workspace, 'project')
    fixture.userData = testPath(workspace, 'profile')
    fixture.downloads = testPath(workspace, 'downloads')
    vi.stubEnv('PORTABLE_EXECUTABLE_DIR', '')
})

afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('배포 방식별 저장 경로', () => {
    it('설치형은 사용자 데이터와 사용자의 다운로드 폴더를 사용한다', () => {
        expect(getWritableBasePath()).toBe(fixture.userData)
        expect(getDatabasePath()).toBe(join(fixture.userData, 'storagebucket.db'))
        expect(getAppDataPath()).toBe(fixture.userData)
        expect(getDefaultDownloadPath()).toBe(join(fixture.downloads, 'StorageBucket'))
    })

    it('기존 Portable의 데이터와 다운로드 경로는 유지한다', () => {
        const portable = testPath(workspace, 'portable')
        vi.stubEnv('PORTABLE_EXECUTABLE_DIR', portable)

        expect(getWritableBasePath()).toBe(portable)
        expect(getDatabasePath()).toBe(join(portable, 'storagebucket.db'))
        expect(getAppDataPath()).toBe(join(portable, 'data'))
        expect(getDefaultDownloadPath()).toBe(join(portable, 'downloads'))
    })

    it('userData를 초기화한 뒤에도 경로가 중첩되지 않는다', () => {
        const initial = getAppDataPath()
        fixture.userData = initial
        expect(getAppDataPath()).toBe(initial)

        const portable = testPath(workspace, 'portable')
        vi.stubEnv('PORTABLE_EXECUTABLE_DIR', portable)
        fixture.userData = getAppDataPath()

        expect(getAppDataPath()).toBe(join(portable, 'data'))
        expect(getWritableBasePath()).toBe(portable)
    })

    it('개발 환경의 기존 경로는 유지한다', () => {
        fixture.packaged = false
        vi.spyOn(process, 'cwd').mockReturnValue(fixture.project)

        expect(getWritableBasePath()).toBe(fixture.project)
        expect(getDatabasePath()).toBe(join(fixture.project, 'storagebucket.db'))
        expect(getAppDataPath()).toBe(join(fixture.project, 'data'))
        expect(getDefaultDownloadPath()).toBe(join(fixture.project, 'downloads'))
    })
})
