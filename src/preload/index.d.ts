import { ElectronAPI } from '@electron-toolkit/preload'
import { ipcRenderer } from 'electron';

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      downloadVideo: (url: string, options?: any) => Promise<{
        success: boolean;
        data?: any;
        error?: string;
        message?: string;
      }>,
      onDuplicate: (callback: (data: { jobId: string; message: string }) => void) => () => void;
      onQueueUpdate: (callback: (queue: any[]) => void) => () => void
      getMediaFiles: () => Promise<any[]>,
      deleteMedia: (id: string) => Promise<{ success: boolean; error?: string }>,
      getEngineStatus: () => Promise<Record<string, { installed: boolean; version: string | null }>>,
      installEngine: (engine: string) => Promise<boolean>,
      getEngineLicenses: () => Promise<Array<{ name: string; url: string; notice: string }>>,
      getCookieBrowser: () => Promise<string>,
      setCookieBrowser: (browser: string) => Promise<boolean>,
      getCookieFilePath: () => Promise<string>,
      setCookieFilePath: () => Promise<string | null>,
      clearCookieFilePath: () => Promise<boolean>,
      getFavorites: () => Promise<any[]>,
      toggleFavorite: (mediaId: number) => Promise<any>,
      checkFavorite: (mediaId: number) => Promise<boolean>,
    }
  }
}
