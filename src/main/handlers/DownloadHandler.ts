import { IpcMainInvokeEvent } from 'electron'
import { DownloadManager } from '../managers/DownloadManager'

export const downloadHandler = {
    'video:download': async (_: IpcMainInvokeEvent, url: string, options: any) => {
        console.log(`[IPC] Download Request: ${url}`)
        const result = await DownloadManager.getInstance().addJob(url, options || {})
        if (result) return result
        return { success: true, message: 'Download added to queue' }
    },

    'download:get-queue': async () => {
        return DownloadManager.getInstance().getQueue()
    },
    'download:remove-job': async (_: IpcMainInvokeEvent, jobId: string) => {
        DownloadManager.getInstance().removeJob(jobId)
        return true
    }
}
