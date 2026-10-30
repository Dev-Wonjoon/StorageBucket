import { describe, expect, it } from 'vitest'
import {
    selectDownloadEngine,
    type DownloadEngineKind
} from '@features/download/DownloadEngineRouting'
import type { DownloadJobOptions } from '../../../src/shared/download-api'

describe('다운로드 엔진 선택', () => {
    const cases: {
        url: string
        options: DownloadJobOptions
        expected: DownloadEngineKind
    }[] = [
        {
            url: 'https://www.youtube.com/watch?v=BaW_jenozKc',
            options: {},
            expected: 'yt-dlp'
        },
        {
            url: 'https://www.instagram.com/p/Fixture/?img_index=2&dlrf=fixture',
            options: {},
            expected: 'gallery-dl'
        },
        {
            url: 'https://www.instagram.com/reel/Fixture/',
            options: { type: 'video', quality: 'best' },
            expected: 'gallery-dl'
        },
        {
            url: 'https://x.com/fixture/status/123',
            options: {},
            expected: 'gallery-dl'
        },
        {
            url: 'https://www.reddit.com/r/fixture/comments/123/example/',
            options: {},
            expected: 'gallery-dl'
        },
        {
            url: 'https://fixture.tumblr.com/post/123',
            options: {},
            expected: 'gallery-dl'
        },
        {
            url: 'https://example.invalid/unknown?custom=value',
            options: {},
            expected: 'yt-dlp'
        },
        {
            url: 'https://instagram.com.example.invalid/post',
            options: {},
            expected: 'yt-dlp'
        }
    ]

    it.each(cases)('$url 의 기본 후보는 $expected 이다', ({ url, options, expected }) => {
        expect(selectDownloadEngine(url, options)).toBe(expected)
    })

    it.each<DownloadJobOptions>([
        { type: 'audio' },
        { quality: 'audio' },
        { quality: '1080' },
        { extension: 'mp4' }
    ])('변환 옵션 %j 는 yt-dlp를 선택한다', (options) => {
        expect(selectDownloadEngine('https://www.instagram.com/p/Fixture/', options)).toBe('yt-dlp')
    })

    it.each([
        'not-a-url',
        'file:///example.mp4',
        'ftp://example.invalid/video',
        'https://user:password@example.invalid/video',
        'https://example.invalid/with space'
    ])('올바르지 않은 입력 %s 는 후보를 반환하지 않는다', (url) => {
        expect(selectDownloadEngine(url, {})).toBeUndefined()
    })

    it('선택 과정에서 원본 주소와 옵션을 변경하지 않는다', () => {
        const url = 'https://www.instagram.com/p/Fixture/?img_index=2&dlrf=fixture'
        const options = Object.freeze({ type: 'video' as const, quality: 'best' as const })

        expect(selectDownloadEngine(url, options)).toBe('gallery-dl')
        expect(url).toContain('?img_index=2&dlrf=fixture')
        expect(options).toEqual({ type: 'video', quality: 'best' })
    })
})
