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
