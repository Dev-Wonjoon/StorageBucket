import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmDiscard } from '../../../../src/renderer/src/shared/utils/leaveGuard'

afterEach(() => vi.unstubAllGlobals())

describe('unsaved detail guard', () => {
    it('초안이 없으면 확인하지 않으며 거부·수락 결과를 보존한다', () => {
        const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
        vi.stubGlobal('window', { confirm })
        expect(confirmDiscard(false)).toBe(true)
        expect(confirm).not.toHaveBeenCalled()
        expect(confirmDiscard(true)).toBe(false)
        expect(confirmDiscard(true)).toBe(true)
        expect(confirm.mock.calls[0][0]).toContain('태그')
    })
})
