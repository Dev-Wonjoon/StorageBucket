import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { createAppApi } from './api'
import type { IpcTransport } from './api'

const transport: IpcTransport = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    subscribe: (channel, callback) => {
        const listener = (_event: IpcRendererEvent, value: Parameters<typeof callback>[0]): void =>
            callback(value)
        ipcRenderer.on(channel, listener)
        return () => ipcRenderer.removeListener(channel, listener)
    }
}
const api = createAppApi(transport)

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('electron', electronAPI)
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    const target = window as typeof window & { electron: typeof electronAPI; api: typeof api }
    target.electron = electronAPI
    target.api = api
}
