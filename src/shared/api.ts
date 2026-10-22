import type {
    DownloadJob,
    DownloadOptions,
    EngineStatus,
    LicenseInfo,
    Media,
    MediaSearchRequest,
    MediaSearchResult
} from './types'

export type Unsubscribe = () => void
export interface Tag {
    id: number
    name: string
}
export interface DownloadRequestResult {
    success: boolean
    error?: string
    message?: string
}
export interface DuplicateNotice {
    jobId: string
    message: string
}
export interface FavoriteEntry {
    media: Media
    favoriteId: number
    favoriteAT: Date
}

export interface AppApi {
    downloadVideo(url: string, options?: DownloadOptions): Promise<DownloadRequestResult>
    onQueueUpdate(callback: (queue: DownloadJob[]) => void): Unsubscribe
    onDuplicate(callback: (notice: DuplicateNotice) => void): Unsubscribe
    getMediaFiles(): Promise<Media[]>
    deleteMedia(id: number): Promise<void>
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
    getFavorites(): Promise<FavoriteEntry[]>
    toggleFavorite(mediaId: number): Promise<boolean>
    checkFavorite(mediaId: number): Promise<boolean>
    getAllTags(): Promise<Tag[]>
    getMediaTags(mediaId: number): Promise<Tag[]>
    createTag(name: string): Promise<Tag>
    renameTag(tagId: number, newName: string): Promise<Tag>
    deleteTag(tagId: number): Promise<void>
    addTagsToMedia(mediaId: number, tagNames: string[]): Promise<Tag[]>
    removeTagFromMedia(mediaId: number, tagId: number): Promise<Tag[]>
    bulkAddTags(mediaIds: number[], tagNames: string[]): Promise<void>
    bulkRemoveTags(mediaIds: number[], tagIds: number[]): Promise<void>
    bulkReplaceTags(mediaIds: number[], tagNames: string[]): Promise<void>
    searchMedia(request: MediaSearchRequest): Promise<MediaSearchResult>
    suggestAuthors(keyword: string): Promise<string[]>
    suggestPlatforms(keyword: string): Promise<string[]>
    suggestTags(keyword: string): Promise<string[]>
}
