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
      onQueueUpdate: (callback: (queue: any[]) => void) => () => void;
    }
  }
}
