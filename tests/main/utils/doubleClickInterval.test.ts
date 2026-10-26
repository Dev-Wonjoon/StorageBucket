import { afterEach, describe, expect, it, vi } from 'vitest'
const exec = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile: exec }))
import { getDoubleClickInterval } from '../../../src/main/utils/doubleClickInterval'

afterEach(() => exec.mockReset())
describe.skipIf(process.platform !== 'win32')('Windows double-click interval', () => {
    it('고정 명령을 숨김 프로세스로 호출하고 OS 응답을 반환한다', async () => {
        exec.mockImplementation((_file, _args, _options, done) => done(null, '900\r\n'))
        expect(await getDoubleClickInterval()).toBe(900)
        const [executable, args, options] = exec.mock.calls[0]
        expect(executable).toMatch(/WindowsPowerShell.*powershell.exe$/)
        expect(args).toContain('-NoProfile')
        expect(args.at(-1)).toContain('GetDoubleClickTime')
        expect(options).toEqual({ windowsHide: true, timeout: 5000, maxBuffer: 1024 })
    })
    it('프로세스 실패를 추측한 시간값으로 대체하지 않는다', async () => {
        exec.mockImplementation((_file, _args, _options, done) => done(new Error('failed'), ''))
        expect(await getDoubleClickInterval()).toBeNull()
    })
    it('잘못된 응답은 포인터 토글에 사용하지 않는다', async () => {
        for (const value of ['', 'invalid', '0', '-1', '5001', '1.5']) {
            exec.mockImplementation((_file, _args, _options, done) => done(null, value))
            expect(await getDoubleClickInterval()).toBeNull()
        }
    })
})
