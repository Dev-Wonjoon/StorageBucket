import { contextBridge, ipcRenderer } from 'electron'
import type { MediaSearchRequest } from '../shared/types'

const api = {
    getDownloadPath: () => ipcRenderer.invoke('get-download-path'),
    setDownloadPath: () => ipcRenderer.invoke('set-download-path'),
    showItemInFolder: (mediaId: number) => ipcRenderer.invoke('shell:show-item', mediaId),
    getVersions: () => process.versions,
    downloadVideo: (url: string, options?: any) =>
        ipcRenderer.invoke('video:download', url, options),
    getDownloadQueue: () => ipcRenderer.invoke('download:get-queue'),
    removeDownloadJob: (jobId: string) => ipcRenderer.invoke('download:remove-job', jobId),
    retryDownloadJob: (jobId: string) => ipcRenderer.invoke('download:retry-job', jobId),
    onQueueUpdate: (callback: (queue: any[]) => void) => {
        const subscription = (_event: any, value: any[]) => callback(value)
        ipcRenderer.on('download:queue-update', subscription)
        return () => {
            ipcRenderer.removeListener('download:queue-update', subscription)
        }
    },
    onDuplicate: (callback: (data: { jobId: string; message: string }) => void) => {
        const subscription = (_event: any, value: any) => callback(value)
        ipcRenderer.on('download:duplicate', subscription)
        return () => {
            ipcRenderer.removeListener('download:duplicate', subscription)
        }
    },
    onBootstrapReady: (callback: () => void) => {
        const subscription = () => callback()
        ipcRenderer.on('app:bootstrap-ready', subscription)
        return () => ipcRenderer.removeListener('app:bootstrap-ready', subscription)
    },
    onBootstrapError: (callback: (error: { message: string }) => void) => {
        const subscription = (_event: any, value: { message: string }) => callback(value)
        ipcRenderer.on('app:bootstrap-error', subscription)
        return () => ipcRenderer.removeListener('app:bootstrap-error', subscription)
    },
    getMediaFiles: () => ipcRenderer.invoke('media:get-all'),
    deleteMedia: (id: number) => ipcRenderer.invoke('media:delete', id),
    getEngineStatus: () => ipcRenderer.invoke('system:engine-status'),
    installEngine: (engine: string) => ipcRenderer.invoke('system:engine-install', engine),
    getEngineLicenses: () => ipcRenderer.invoke('system:engine-licenses'),
    getCookieBrowser: () => ipcRenderer.invoke('system:get-cookie-browser'),
    setCookieBrowser: (browser: string) => ipcRenderer.invoke('system:set-cookie-browser', browser),
    getCookieFilePath: () => ipcRenderer.invoke('system:get-cookie-file'),
    setCookieFilePath: () => ipcRenderer.invoke('system:set-cookie-file'),
    clearCookieFilePath: () => ipcRenderer.invoke('system:clear-cookie-file'),
    getFavorites: () => ipcRenderer.invoke('favorite:get-all'),
    toggleFavorite: (mediaId: number) => ipcRenderer.invoke('favorite:toggle', mediaId),
    checkFavorite: (mediaId: number) => ipcRenderer.invoke('favorite:check', mediaId),
    getAllTags: () => ipcRenderer.invoke('tag:get-all'),
    getMediaTags: (mediaId: number) => ipcRenderer.invoke('tag:get-by-media', mediaId),
    createTag: (name: string) => ipcRenderer.invoke('tag:create', name),
    renameTag: (tagId: number, newName: string) => ipcRenderer.invoke('tag:rename', tagId, newName),
    deleteTag: (tagId: number) => ipcRenderer.invoke('tag:delete', tagId),
    addTagsToMedia: (mediaId: number, tagNames: string[]) =>
        ipcRenderer.invoke('tag:add-to-media', mediaId, tagNames),
    removeTagFromMedia: (mediaId: number, tagId: number) =>
        ipcRenderer.invoke('tag:remove-from-media', mediaId, tagId),
    bulkAddTags: (mediaIds: number[], tagNames: string[]) =>
        ipcRenderer.invoke('tag:bulk-add', mediaIds, tagNames),
    bulkRemoveTags: (mediaIds: number[], tagIds: number[]) =>
        ipcRenderer.invoke('tag:bulk-remove', mediaIds, tagIds),
    bulkReplaceTags: (mediaIds: number[], tagNames: string[]) =>
        ipcRenderer.invoke('tag:bulk-replace', mediaIds, tagNames),
    searchMedia: (request: MediaSearchRequest) => ipcRenderer.invoke('search:media', request),
    suggestAuthors: (keyword: string) => ipcRenderer.invoke('search:suggest-authors', keyword),
    suggestPlatforms: (keyword: string) => ipcRenderer.invoke('search:suggest-platforms', keyword),
    suggestTags: (keyword: string) => ipcRenderer.invoke('search:suggest-tags', keyword)
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
}
