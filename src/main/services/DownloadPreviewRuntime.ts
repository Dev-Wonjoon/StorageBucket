import { app } from 'electron'
import { dirname, join } from 'node:path'
import { DownloadPreviewService } from './DownloadPreviewService'

let instance: DownloadPreviewService | undefined

export function getDownloadPreviews(): DownloadPreviewService {
    if (!instance) {
        const applicationDirectory = app.isPackaged
            ? process.env.PORTABLE_EXECUTABLE_DIR?.trim() || dirname(app.getPath('exe'))
            : app.getAppPath()

        instance = new DownloadPreviewService(
            join(applicationDirectory, 'cache', 'download-previews', 'jpeg-v1')
        )
    }

    return instance
}
