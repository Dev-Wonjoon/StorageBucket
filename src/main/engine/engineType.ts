import type { LicenseInfo } from '../../shared/types'

export type EngineName = 'yt-dlp' | 'gallery-dl' | 'ffmpeg'
export type ReleaseProvider = 'github' | 'codeberg'

export interface EngineInfo {
    name: EngineName
    repo: string
    provider: ReleaseProvider
    getAssetCandidates: (platform: NodeJS.Platform) => string[]
    license: LicenseInfo
}

export interface ReleaseAsset {
    name: string
    browser_download_url?: string
    url?: string
}

export interface ReleaseData {
    tag_name: string
    assets?: ReleaseAsset[]
    attachments?: ReleaseAsset[]
}
