import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      downloadVideo: (url: string) => Promise<{
        success: boolean;
        data?: any;
        error?: string;
      }>,
      onQueueUpdate: (callback: (queue: any[]) => void) => () => void,
      getMedias: () => ipcRen
      deleteMedia: (id: string) => Promise<{ success: boolean; error?: string}>,
      cancelDownload: (id: string) => Promise<{ success: boolean, error?: string }>;
      getEngineStatus: () => Promise<string, { installed: boolean; error?: string }>,
      installEngine: (engine: string) => Promise<boolean>,
      getEngineLicenses: () => Promise<Array<{ name: string; url: string; notice: string}>>,
    }
  }
}
