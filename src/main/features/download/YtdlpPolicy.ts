import { createHash } from 'node:crypto'
import type { YtdlpDiscoveryPolicy } from './YtdlpAdapter'

function pageUrl(value: unknown): URL | undefined {
    if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) return

    try {
        const url = new URL(value)

        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            return
        }

        return url
    } catch {
        return
    }
}

function identifier(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
        return
    }

    return value
}

// 직접 입력한 YouTube 단일 영상의 ID만 확인한다. 쿼리를 삭제하지 않는다.
function youtubeRequestId(url: URL): string | undefined {
    if (url.hostname === 'youtu.be') {
        return /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
    }

    if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
        if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
            const id = url.searchParams.get('v')!
            return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : undefined
        }

        return /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
    }

    return
}

export function createYtdlpPolicy(originalUrl: string): YtdlpDiscoveryPolicy | undefined {
    const request = pageUrl(originalUrl)

    if (!request) return

    const expectedYoutubeId = youtubeRequestId(request)

    return {
        // 이번 단계는 단일 영상·오디오를 처리한다.
        accepts: (url, options) => url === originalUrl && options.playlist !== true,

        identify: (document, leaves) => {
            if (
                leaves.length !== 1 ||
                (document._type !== undefined && document._type !== 'video') ||
                document.entries !== undefined
            ) {
                return
            }

            const row = leaves[0]
            const id = identifier(row.id)
            const extractor = identifier(row.extractor_key)
            const source = pageUrl(row.webpage_url ?? originalUrl)

            if (
                !id ||
                !extractor ||
                !source ||
                document.id !== id ||
                document.extractor_key !== extractor
            ) {
                return
            }

            const name = extractor.toLowerCase()

            if (
                expectedYoutubeId !== undefined &&
                (name !== 'youtube' || id !== expectedYoutubeId || youtubeRequestId(source) !== id)
            ) {
                return
            }

            // 기존 YouTube 파일 키를 유지한다.
            if (name === 'youtube') {
                return /^[A-Za-z0-9_-]{11}$/.test(id) ? ['youtube:' + id] : undefined
            }

            // 일반 추출기의 ID는 파일명일 수 있으므로 원본 페이지로 구분한다.
            // 만료 가능한 미디어 다운로드 URL은 식별 키에 사용하지 않는다.
            const identity = [name, source.origin, id, name === 'generic' ? source.href : null]

            return [
                'ytdlp:v1:' + createHash('sha256').update(JSON.stringify(identity)).digest('hex')
            ]
        }
    }
}
