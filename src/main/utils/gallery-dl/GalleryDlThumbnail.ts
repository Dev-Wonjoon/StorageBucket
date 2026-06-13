import path from 'path'
import fs from 'fs'
import { spawnSync } from 'child_process'
import { BinManager } from '../../managers/BinManager'
import { ConfigManager } from '../../managers/ConfigManager'

export const createGalleryDlVideoThumbnail = (file: string): string | null => {
    if (!file.match(/\.(mp4|webm|mov|mkv)$/i)) return null

    const ffmpegPath = BinManager.getInstance().getBinaryPath('ffmpeg')
    const thumbDir = path.join(ConfigManager.getInstance().getThumbnailPath(), 'instagram')

    if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true })

    const output = path.join(thumbDir, `${path.basename(file, path.extname(file))}.jpg`)

    const result = spawnSync(ffmpegPath, [
        '-y',
        '-ss',
        '00:00:01',
        '-i',
        file,
        '-frames:v',
        '1',
        '-q:v',
        '2',
        output
    ])

    return result.status === 0 && fs.existsSync(output) ? output : null
}
