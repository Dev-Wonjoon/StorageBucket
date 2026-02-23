import { contextBridge, IpcMain, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  downloadVideo: (url: string, options?: any) => ipcRenderer.invoke('video:download', url, options),
  onQueueUpdate: (callback: (queue: any[]) => void) => {
    const subscription = (_event: any, value: any[]) => callback(value);

    return () => {
      ipcRenderer.removeListener('download:queue-update', subscription);
    }
  }
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
