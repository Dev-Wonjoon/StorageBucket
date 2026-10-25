import type { EngineStatus, LicenseInfo } from './types'
import type { MediaApi } from './media-api'
import type { DownloadApi } from './download-api'

export type Unsubscribe = () => void

export interface AppApi {
    media: MediaApi
    downloads: DownloadApi

    showItemInFolder(filepath: string): Promise<void>

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
}