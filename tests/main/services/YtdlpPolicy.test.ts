import { describe, expect, it } from 'vitest'
import { createYtdlpPolicy } from '@features/download/YtdlpPolicy'

const source = 'https://example.invalid/watch/123?custom=value'

function info(changes: Record<string, unknown> = {}) {
    return {
        id: '123',
        extractor_key: 'Fixture',
        webpage_url: source,
        ...changes
    }
}

function keys(url: string, row: ReturnType<typeof info>) {
    return createYtdlpPolicy(url)?.identify(row, [row])
}

describe('yt-dlp 공통 단일 미디어 정책', () => {
    it('미등록 사이트와 추가 쿼리를 그대로 허용한다', () => {
        const policy = createYtdlpPolicy(source)!

        expect(policy.accepts(source, {})).toBe(true)
        expect(policy.accepts(source + '&changed=1', {})).toBe(false)
    })

    it('단일 미디어 단계에서는 명시적인 재생목록 요청을 받지 않는다', () => {
        expect(createYtdlpPolicy(source)!.accepts(source, { playlist: true })).toBe(false)
    })

    it('공개 여부·연령·제목 필드를 필수 조건으로 삼지 않는다', () => {
        const row = info({ availability: 'unlisted', age_limit: 18 })

        expect(keys(source, row)?.[0]).toMatch(/^ytdlp:v1:[0-9a-f]{64}$/)
    })

    it('기존 YouTube 파일 키를 유지하고 다른 영상 ID는 거부한다', () => {
        const url = 'https://www.youtube.com/watch?v=BaW_jenozKc&start=1'
        const row = info({
            id: 'BaW_jenozKc',
            extractor_key: 'Youtube',
            webpage_url: url
        })

        expect(keys(url, row)).toEqual(['youtube:BaW_jenozKc'])
        expect(keys(url, { ...row, id: 'abcdefghijk' })).toBeUndefined()
    })

    it('같은 추출기와 ID라도 서로 다른 호스트는 구분한다', () => {
        expect(keys(source, info())).not.toEqual(
            keys(
                source,
                info({
                    webpage_url: 'https://other.invalid/watch/123'
                })
            )
        )
    })

    it('일반 추출기의 동일 ID는 페이지별로 구분한다', () => {
        const first = info({ extractor_key: 'Generic' })
        const second = info({
            extractor_key: 'Generic',
            webpage_url: 'https://example.invalid/watch/other'
        })

        expect(keys(source, first)).not.toEqual(keys(source, second))
    })

    it('미디어 URL의 서명이 바뀌어도 같은 페이지의 키는 유지한다', () => {
        const first = info({
            extractor_key: 'Generic',
            url: 'https://cdn.invalid/file.mp4?signature=old'
        })
        const second = {
            ...first,
            url: 'https://cdn.invalid/file.mp4?signature=new'
        }

        expect(keys(source, first)).toEqual(keys(source, second))
    })

    it.each([{ id: '' }, { extractor_key: '' }, { webpage_url: 'file:///media.mp4' }])(
        '식별 정보가 잘못된 결과 %j 는 거부한다',
        (changes) => {
            expect(keys(source, info(changes))).toBeUndefined()
        }
    )

    it('목록 결과를 단일 영상으로 오인하지 않는다', () => {
        const row = info()
        const policy = createYtdlpPolicy(source)!

        expect(policy.identify({ _type: 'playlist', entries: [row] }, [row])).toBeUndefined()

        expect(policy.identify(row, [row, row])).toBeUndefined()
    })
})
