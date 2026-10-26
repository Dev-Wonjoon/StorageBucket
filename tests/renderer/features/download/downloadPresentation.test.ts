import { describe, expect, it } from 'vitest'
import type { DownloadJobDto } from '../../../../src/shared/download-api'
import {
    canCancelDownload,
    downloadPlatform,
    downloadStatus,
    downloadTrigger,
    visibleProgress
} from '../../../../src/renderer/src/features/download/downloadPresentation'
const job: DownloadJobDto = {
    id: 'job',
    url: 'https://youtu.be/example',
    title: null,
    state: 'running',
    phase: 'downloading',
    progress: 0,
    options: {},
    cleanupRequired: false,
    currentAttemptId: 'attempt',
    errorCode: null
}

describe('download presentation', () => {
    it('실제 다운로드 수치만 표시하고 검증·커밋을 완료로 오인하지 않는다', () => {
        expect(visibleProgress(job)).toBeNull()
        expect(visibleProgress({ ...job, progress: 42 })).toBe(42)
        for (const phase of ['discovering', 'verifying', 'committing', 'rolling_back'] as const) {
            expect(visibleProgress({ ...job, phase, progress: 100 })).toBeNull()
        }
        expect(downloadStatus({ ...job, phase: 'committing', progress: 100 })).toBe('저장 중')
        expect(downloadStatus({ ...job, state: 'cancelled', phase: 'finished' })).toBe('취소됨')
    })
    it('커밋·롤백·정리 필요 작업은 취소 조작을 제공하지 않는다', () => {
        expect(canCancelDownload(job)).toBe(true)
        expect(canCancelDownload({ ...job, phase: 'committing' })).toBe(false)
        expect(canCancelDownload({ ...job, phase: 'rolling_back' })).toBe(false)
        expect(canCancelDownload({ ...job, cleanupRequired: true })).toBe(false)
    })
    it('실패와 취소·중단의 재실행 종류를 구분한다', () => {
        expect(downloadTrigger({ ...job, state: 'failed' })).toBe('manual_retry')
        expect(downloadTrigger({ ...job, state: 'cancelled' })).toBe('manual_restart')
        expect(downloadTrigger({ ...job, state: 'interrupted' })).toBe('manual_restart')
        expect(downloadTrigger({ ...job, state: 'completed' })).toBeNull()
    })
    it('YouTube 도메인을 정확히 구분하며 URL 파싱 실패를 허용한다', () => {
        expect(downloadPlatform('https://www.youtube.com/watch?v=id')).toBe('YouTube')
        expect(downloadPlatform('https://youtu.be/id')).toBe('YouTube')
        expect(downloadPlatform('https://notyoutube.com/id')).toBe('notyoutube.com')
        expect(downloadPlatform('broken')).toBe('플랫폼 미확인')
    })
})
