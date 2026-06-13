import { ChildProcess, spawn } from 'child_process'
import fs from 'fs'
import { BinManager } from '../managers/BinManager'
import { ConfigManager } from '../managers/ConfigManager'
import { DownloadResult, DownloadResultItem, TaskCallbacks, TaskHandle } from '../../shared/types'
import type { InstagramStructure } from '../../shared/instagram_structure'
import { cleanUrl } from './ArgsUtils'
import {
    buildGalleryDlPrintFormat,
    parseGalleryDlPrintMetadata
} from './gallery-dl/GalleryDlMetadata'
import { buildGalleryDlDownloadedFilePath } from './gallery-dl/GalleryDlPath'
import { createGalleryDlVideoThumbnail } from './gallery-dl/GalleryDlThumbnail'
import { mapGalleryDlInstagramMetadata } from './gallery-dl/GalleryResultMapper'

export function downloadGalleryDl(
    url: string,
    basePath: string,
    callbacks: TaskCallbacks
): TaskHandle {
    const binManager = BinManager.getInstance()
    const galleryDlPath = binManager.getBinaryPath('gallery-dl')
    let proc: ChildProcess | null = null
    let aborted = false

    const promise = new Promise<DownloadResult>((resolve, reject) => {
        const metadataPrintFormat = buildGalleryDlPrintFormat()

        const args = [
            cleanUrl(url),
            '-d',
            basePath,
            '-o',
            'directory=["{category}", "{owner_id}"]',
            '-o',
            'filename="{media_id}_{filename}.{extension}"',
            '--Print',
            metadataPrintFormat
        ]
        const cookieFile = ConfigManager.getInstance().getCookieFilePath()
        const cookieBrowser = ConfigManager.getInstance().getCookieBrowser()

        if (cookieFile) {
            args.push('--cookies', cookieFile)
        } else if (cookieBrowser) {
            args.push('--cookie-from-browser', cookieBrowser)
        }

        console.log(`[GalleryDlTask] command: ${galleryDlPath} ${args.join(' ')}`)

        proc = spawn(galleryDlPath, args)

        const downloadedItems: Partial<InstagramStructure>[] = []
        let stdoutBuffer = ''
        let stderrBuffer = ''

        proc.stdout?.on('data', (data: Buffer) => {
            stdoutBuffer += data.toString()
            const lines = stdoutBuffer.split('\n')
            stdoutBuffer = lines.pop() || ''

            lines.forEach((line) => {
                const trimmed = line.trim()
                if (!trimmed || trimmed.startsWith('#')) return

                const info = parseGalleryDlPrintMetadata(trimmed)
                if (!info) {
                    console.log(`[gallery-dl stdout] ${trimmed.substring(0, 300)}`)
                    return
                }

                downloadedItems.push(info)
                callbacks.onProgress(50, {
                    status: 'downloading',
                    itemCount: downloadedItems.length
                })
            })
        })

        proc.stderr?.on('data', (data: Buffer) => {
            const text = data.toString()
            stderrBuffer += text
            callbacks.onLog?.(text.trim(), 'raw')
            console.log(`[gallery-dl stderr] ${text}`)
        })

        proc.on('close', (code) => {
            if (aborted) {
                reject(new Error('Aborted'))
                return
            }

            if (code === 0 && downloadedItems.length > 0) {
                // changed: 같은 포스트의 sidecar 이미지는 첫 번째 항목만 카드로 등록
                const seenPostKeys = new Set<string>()

                const firstItemsByPost = downloadedItems.filter((info) => {
                    const postKey = info.post_id || info.post_url || info.shortcode || info.media_id

                    if (!postKey) return true

                    if (seenPostKeys.has(postKey)) {
                        return false
                    }

                    seenPostKeys.add(postKey)
                    return true
                })

                const results: DownloadResultItem[] = firstItemsByPost
                    .map((info) => {
                        const file = buildGalleryDlDownloadedFilePath(basePath, info, url)
                        if (!fs.existsSync(file)) return null

                        const isImage = !!file.match(/\.(jpg|jpeg|png|webp|gif|heic)$/i)
                        const metadata = mapGalleryDlInstagramMetadata(
                            info,
                            file,
                            url,
                            fs.statSync(file).size
                        )

                        return {
                            metadata,
                            videoPath: file,
                            thumbnailPath: isImage ? file : createGalleryDlVideoThumbnail(file)
                        }
                    })
                    .filter((item): item is DownloadResultItem => item !== null)

                if (results.length === 0) {
                    callbacks.onProgress(0, { status: 'failed' })
                    reject(new Error('gallery-dl completed, but downloaded files not found.'))
                    return
                }

                callbacks.onProgress(100, { status: 'completed', itemCount: results.length })

                if (results.length === 1) {
                    resolve({
                        success: true,
                        multiple: false,
                        metadata: results[0].metadata,
                        videoPath: results[0].videoPath,
                        thumbnailPath: results[0].thumbnailPath
                    })
                } else {
                    resolve({
                        success: true,
                        multiple: true,
                        items: results,
                        metadata: results[0].metadata,
                        videoPath: results[0].videoPath,
                        thumbnailPath: results[0].thumbnailPath
                    })
                }
                return
            }

            callbacks.onProgress(0, { status: 'failed' })
            reject(new Error(`gallery-dl exited with code ${code}: ${stderrBuffer}`))
        })
    })

    return {
        promise,
        abort: () => {
            aborted = true
            proc?.kill()
        }
    }
}
