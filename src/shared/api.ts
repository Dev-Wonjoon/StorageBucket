import type { EngineStatus, LicenseInfo } from './types'
import type { MediaApi } from './media-api'
import type { DownloadApi } from './download-api'
import type { ThumbnailApi } from './thumbnail-api'

export type Unsubscribe = () => void

export interface AppApi {
    media: MediaApi
    downloads: DownloadApi
    thumbnails: ThumbnailApi

    getDownloadPreview(url: string): Promise<string | null>
    showItemInFolder(filepath: string): Promise<void>
    getDoubleClickInterval(): Promise<number | null>

    getDownloadPath(): Promise<string>
    setDownloadPath(): Promise<string | null>

    getEngineStatus(): Promise<Record<string, EngineStatus>>
    installEngine(engine: string): Promise<boolean>
    getEngineLicenses(): Promise<LicenseInfo[]>

    getCookieBrowser(): Promise<string>
    setCookieBrowser(browser: string): Promise<boolean>

    getCookieFilePath(): Promise<string>
    setCookieFilePath(): Promise<string | null>
    clearCookieFilePath(): Promise<boolean>
    onMediaThumbnailUpdated(listener: (mediaId: number) => void): Unsubscribe
}
