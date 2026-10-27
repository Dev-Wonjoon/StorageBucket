import type { V2Database } from '@features/media/MediaRepository'
import { createDownloadRuntime, type DownloadEngineOptions } from './DownloadRuntime'

export { createYouTubePolicy } from './YouTubePolicy'

export interface YouTubeDownloadOptions extends DownloadEngineOptions {
    getStorageRoot: () => string
}

export function createYouTubeDownloadRuntime(db: V2Database, options: YouTubeDownloadOptions) {
    return createDownloadRuntime(db, {
        getStorageRoot: options.getStorageRoot,

        engines: {
            ...options,

            // 기존 YouTube 진입점의 허용 범위를 유지한다.
            getBinaries: () => {
                const { ytDlp, ffmpeg } = options.getBinaries()

                return { ytDlp, ffmpeg }
            }
        }
    })
}
