import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  downloadVideo: (url: string, options?: any) => ipcRenderer.invoke('video:download', url, options),
  onQueueUpdate: (callback: (queue: any[]) => void) => {
    const subscription = (_event: any, value: any[]) => callback(value);
    ipcRenderer.on('download:queue-update', subscription);
    return () => {
      ipcRenderer.removeListener('download:queue-update', subscription);
    }
  },
  onDuplicate: (callback: (data: { jobId: string, message: string }) => void) => {
    const subscription = (_event: any, value: any) => callback(value);
    ipcRenderer.on('download:duplicate', subscription);
    return () => {
      ipcRenderer.removeListener('download:duplicate', subscription);
    }
  },
  getMediaFiles: () => ipcRenderer.invoke('media:get-all'),
  deleteMedia: (id: string) => ipcRenderer.invoke('media:delete', id),
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
  addTagsToMedia: (mediaId: number, tagNames: string[]) => ipcRenderer.invoke('tag:add-to-media', mediaId, tagNames),
  removeTagFromMedia: (mediaId: number, tagId: number[]) => ipcRenderer.invoke('tag:remove-from-media', mediaId, tagId),
  bulkAddTags: (mediaIds: number[], tagNames: string[]) => ipcRenderer.invoke('tag:bulk-add', mediaIds, tagNames),
  bulkRemoveTags: (mediaIds: number[], tagIds: number[]) => ipcRenderer.invoke('tag:bulk-remove', mediaIds, tagIds),
  bulkReplaceTags: (mediaIds: number[], tagNames: string[]) => ipcRenderer.invoke('tag:bulk-replace', mediaIds, tagNames),
}


if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
