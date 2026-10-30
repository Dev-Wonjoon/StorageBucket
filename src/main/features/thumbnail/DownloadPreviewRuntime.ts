import { join } from 'node:path'
import { getWritableBasePath } from '../../infrastructure/portablePath'
import { DownloadPreviewService } from './DownloadPreviewService'

let instance: DownloadPreviewService | undefined

export function getDownloadPreviews(): DownloadPreviewService {
    if (!instance) {
        instance = new DownloadPreviewService(
            join(getWritableBasePath(), 'cache', 'download-previews', 'jpeg-v1')
        )
    }

    return instance
}
