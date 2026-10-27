import type { AppApi, Unsubscribe } from '../shared/api'

export interface IpcTransport {
    invoke<T>(channel: string, ...args: unknown[]): Promise<T>
    subscribe<T>(channel: string, callback: (value: T) => void): Unsubscribe
}

export function createAppApi(transport: IpcTransport): AppApi {
    return {
        media: {
            list: (request = {}) => transport.invoke('media:list', request),
            get: (request) => transport.invoke('media:get', request),
            edit: (request) => transport.invoke('media:edit', request),
            unregisterFiles: (request) => transport.invoke('media:unregister-files', request),
            unregisterMedia: (request) => transport.invoke('media:unregister', request),
            suggest: (request) => transport.invoke('media:suggest', request)
        },

        downloads: {
            enqueue: (request) => transport.invoke('download:enqueue', request),
            list: (request = {}) => transport.invoke('download:list', request),
            get: (request) => transport.invoke('download:get', request),
            run: (request) => transport.invoke('download:run', request),
            cancel: (request) => transport.invoke('download:cancel', request)
        },

        thumbnails: {
            get: (request) => transport.invoke('thumbnail:get', request),
            retry: (request) => transport.invoke('thumbnail:retry', request)
        },

        showItemInFolder: (filepath) => transport.invoke('shell:show-item', filepath),
        getDownloadPreview: (url) => transport.invoke('system:download-preview', url),
        getDoubleClickInterval: () => transport.invoke('system:double-click-interval'),

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
        onMediaThumbnailUpdated: (listener) =>
            transport.subscribe<unknown>('media:thumbnail-updated', (value) => {
                if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
                    listener(value)
                }
            })
    }
}
