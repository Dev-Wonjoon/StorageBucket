import type { AppApi, Unsubscribe } from '../shared/api'

export interface IpcTransport {
    invoke<T>(channel: string, ...args: unknown[]): Promise<T>
    subscribe<T>(channel: string, callback: (value: T) => void): Unsubscribe
}

// Channel names intentionally match the existing main-process handlers.
export function createAppApi(transport: IpcTransport): AppApi {
    return {
        downloadVideo: (url, options) => transport.invoke('video:download', url, options),
        onQueueUpdate: (callback) => transport.subscribe('download:queue-update', callback),
        onDuplicate: (callback) => transport.subscribe('download:duplicate', callback),
        getMediaFiles: () => transport.invoke('media:get-all'),
        deleteMedia: (id) => transport.invoke('media:delete', id),
        showItemInFolder: (filepath) => transport.invoke('shell:show-item', filepath),
        getDownloadPath: () => transport.invoke('get-download-path'),
        setDownloadPath: () => transport.invoke('set-download-path'),
        getEngineStatus: () => transport.invoke('system:engine-status'),
        installEngine: (engine) => transport.invoke('system:engine-install', engine),
        getEngineLicenses: () => transport.invoke('system:engine-licenses'),
        getCookieBrowser: () => transport.invoke('system:get-cookie-browser'),
        setCookieBrowser: (browser) => transport.invoke('system:set-cookie-browser', browser),
        getCookieFilePath: () => transport.invoke('system:get-cookie-file'),
        setCookieFilePath: () => transport.invoke('system:set-cookie-file'),
        clearCookieFilePath: () => transport.invoke('system:clear-cookie-file'),
        getFavorites: () => transport.invoke('favorite:get-all'),
        toggleFavorite: (mediaId) => transport.invoke('favorite:toggle', mediaId),
        checkFavorite: (mediaId) => transport.invoke('favorite:check', mediaId),
        getAllTags: () => transport.invoke('tag:get-all'),
        getMediaTags: (mediaId) => transport.invoke('tag:get-by-media', mediaId),
        createTag: (name) => transport.invoke('tag:create', name),
        renameTag: (id, name) => transport.invoke('tag:rename', id, name),
        deleteTag: (id) => transport.invoke('tag:delete', id),
        addTagsToMedia: (id, names) => transport.invoke('tag:add-to-media', id, names),
        removeTagFromMedia: (id, tagId) => transport.invoke('tag:remove-from-media', id, tagId),
        bulkAddTags: (ids, names) => transport.invoke('tag:bulk-add', ids, names),
        bulkRemoveTags: (ids, tagIds) => transport.invoke('tag:bulk-remove', ids, tagIds),
        bulkReplaceTags: (ids, names) => transport.invoke('tag:bulk-replace', ids, names),
        searchMedia: (request) => transport.invoke('search:media', request),
        suggestAuthors: (keyword) => transport.invoke('search:suggest_authors', keyword),
        suggestPlatforms: (keyword) => transport.invoke('search:suggest-platforms', keyword),
        suggestTags: (keyword) => transport.invoke('search:suggest-tags', keyword)
    }
}
