import { describe, expect, it } from 'vitest'
import { toMediaUrl, formatDuration } from './media'
import { isHttpUrl } from './url'

describe('local media URLs', () => {
    it('preserves reserved filename characters and Unicode on Windows', () => {
        const filepath = 'C:\\사진\\a #1%?.jpg'
        const url = toMediaUrl(filepath)!
        expect(new URL(url).hash).toBe('')
        expect(new URL(url).search).toBe('')
        expect(decodeURIComponent(url.replace('media:///', ''))).toBe('C:/사진/a #1%?.jpg')
    })
    it('preserves absolute POSIX paths', () => {
        expect(toMediaUrl('/home/user/photo.jpg')).toBe('media:///home/user/photo.jpg')
    })
    it('preserves UNC path separators', () => {
        expect(toMediaUrl('\\\\server\\share\\a.jpg')).toBe('media:////server/share/a.jpg')
    })
    it('handles missing thumbnails', () => {
        expect(toMediaUrl(null)).toBeNull()
        expect(toMediaUrl('')).toBeNull()
    })
})

describe('media duration', () => {
    it('formats whole seconds without a 60-second remainder', () => {
        expect(formatDuration(125.9)).toBe('2:05')
        expect(formatDuration(3600)).toBe('60:00')
    })
    it('ignores unavailable or invalid durations', () => {
        for (const value of [null, undefined, 0, -1, NaN, Infinity])
            expect(formatDuration(value)).toBeNull()
    })
})

describe('pasted download links', () => {
    it('accepts only HTTP and HTTPS URLs', () => {
        expect(isHttpUrl('https://example.com/watch?v=1')).toBe(true)
        expect(isHttpUrl('http://example.com')).toBe(true)
        for (const value of [
            'file:///C:/photo.jpg',
            'javascript:alert(1)',
            'not a url',
            'ftp://example.com'
        ]) {
            expect(isHttpUrl(value)).toBe(false)
        }
    })
})
