import type { DownloadJobOptions } from '../../../shared/download-api'

export type DownloadEngineKind = 'yt-dlp' | 'gallery-dl'

// 지원 허용 목록이 아니라 게시물 전체 미디어를 우선하는 선택 힌트다.
const galleryFirstHosts = [
    'instagram.com',
    'x.com',
    'twitter.com',
    'reddit.com',
    'redd.it',
    'tumblr.com',
    'imgur.com',
    'pinterest.com',
    'pin.it',
    'flickr.com',
    'flic.kr',
    'bsky.app'
] as const

export function selectDownloadEngine(
    originalUrl: string,
    options: Readonly<DownloadJobOptions>
): DownloadEngineKind | undefined {
    if (/[\u0000-\u0020\u007f]/.test(originalUrl)) return

    let url: URL

    try {
        url = new URL(originalUrl)
    } catch {
        return
    }

    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        return
    }

    // 현재 gallery-dl 어댑터가 처리하지 않는 변환 옵션은 yt-dlp에 전달한다.
    if (
        options.type === 'audio' ||
        options.quality === 'audio' ||
        (options.quality !== undefined && options.quality !== 'best') ||
        options.extension !== undefined
    ) {
        return 'yt-dlp'
    }

    const host = url.hostname.toLowerCase()

    if (galleryFirstHosts.some((domain) => host === domain || host.endsWith('.' + domain))) {
        return 'gallery-dl'
    }

    // 미등록 사이트도 후보를 반환한다. 실제 지원 여부는 추출 단계에서 확인한다.
    return 'yt-dlp'
}
