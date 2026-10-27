import type { YtdlpDiscoveryPolicy } from './YtdlpAdapter'


const videoIdPattern = /^[A-Za-z0-9_-]{11}$/

function videoId(value: string): string | undefined {
    try {
        if (typeof value !== 'string' || /[\u0000-\u0020\u007f]/.test(value)) {
            return
        }

        const url = new URL(value)

        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
            return
        }

        const tracking = new Set(['si', 'feature', 'ab_channel'])
        let id: string | undefined

        if (url.hostname === 'youtu.be') {
            id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
        } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
            if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) {
                id = url.searchParams.get('v')!
                tracking.add('v')
            } else {
                id = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
            }
        }

        if (!id || !videoIdPattern.test(id)) return

        for (const key of url.searchParams.keys()) {
            if (!tracking.has(key)) return
        }

        return id
    } catch {
        return
    }
}

export function createYouTubePolicy(originalUrl: string): YtdlpDiscoveryPolicy | undefined {
    const expectedId = videoId(originalUrl)

    if (!expectedId) return

    return {
        accepts: (url, options) =>
            videoId(url) === expectedId &&
            options.playlist !== true &&
            (options.type === undefined || options.type === 'video' || options.type === 'audio'),

        identify: (document, leaves) => {
            if (leaves.length !== 1) return

            for (const row of [document, leaves[0]]) {
                if (
                    (row._type !== undefined && row._type !== 'video') ||
                    row.entries !== undefined ||
                    row.id !== expectedId ||
                    row.extractor_key !== 'Youtube' ||
                    row.extractor !== 'youtube' ||
                    row.availability !== 'public' ||
                    row.age_limit !== 0 ||
                    row.live_status !== 'not_live' ||
                    row.is_live === true ||
                    row.is_upcoming === true ||
                    row.has_drm === true ||
                    typeof row.webpage_url !== 'string' ||
                    videoId(row.webpage_url) !== expectedId
                ) {
                    return
                }
            }

            return ['youtube:' + expectedId]
        }
    }
}
