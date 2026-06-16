import { ChildProcess, spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { BinManager } from '../managers/BinManager'
import { ConfigManager } from '../managers/ConfigManager'
import { DownloadResult, DownloadResultItem, TaskCallbacks, TaskHandle } from '../../shared/types'
import type { ExternalMediaStructure } from '../../shared/external_structure'
import type { GalleryDlRawMetadata } from '../../shared/gallery_dl_raw_metadata'
import { cleanUrl } from './ArgsUtils'
import {
    buildGalleryDlPrintFormat,
    parseGalleryDlPrintMetadata
} from './gallery-dl/GalleryDlMetadata'
import { buildGalleryDlDownloadedFilePath } from './gallery-dl/GalleryDlPath'
import { createGalleryDlVideoThumbnail } from './gallery-dl/GalleryDlThumbnail'
import {
    mapExternalMediaToDownloadMetadata,
    mapGalleryDlMetadata
} from './gallery-dl/GalleryResultMapper'
import { firstValidText } from './MetadataValue'

const findFileByHints = (directory: string, hints: string[], depth = 0): string | null => {
    if (depth > 3) return null
    if (!fs.existsSync(directory)) return null

    const entries = fs.readdirSync(directory, { withFileTypes: true })

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name)

        if (entry.isFile()) {
            const lowerName = entry.name.toLowerCase()
            const matched = hints.some((hint) => lowerName.includes(hint.toLowerCase()))

            if (matched) return fullPath
        }

        if (entry.isDirectory()) {
            const found = findFileByHints(fullPath, hints, depth + 1)
            if (found) return found
        }
    }
    return null
}

const findExistingGalleryDlFile = (
    expectedPath: string,
    basePath: string,
    info: GalleryDlRawMetadata,
    url: string
): string | null => {
    if (fs.existsSync(expectedPath)) return expectedPath

    const siteKey =
        firstValidText(info.category) ?? new URL(url).hostname.replace(/^www\./, '').split('.')[0]
    const filenameHints = [
        firstValidText(info.media_id),
        firstValidText(info.sidecar_media_id),
        firstValidText(info.id),
        firstValidText(info.filename)
    ].filter((value): value is string => !!value)

    const searchRoots = [path.dirname(expectedPath), path.join(basePath, siteKey), basePath]

    for (const root of searchRoots) {
        if (!fs.existsSync(root)) continue

        const found = findFileByHints(root, filenameHints)
        if (found) return found
    }

    return null
}

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
            'directory=["{category}"]',
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

        const downloadedItems: GalleryDlRawMetadata[] = []
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
                const seenContentKeys = new Set<string>()
                const normalizedItems = downloadedItems.map((raw) => ({
                    raw,
                    item: mapGalleryDlMetadata(raw, cleanUrl(url))
                }))

                const firstItemsByContent = normalizedItems.filter(({ item }) => {
                    const groupKey = getExternalContentGroupKey(item)

                    if (seenContentKeys.has(groupKey)) {
                        return false
                    }

                    seenContentKeys.add(groupKey)
                    return true
                })

                const results: DownloadResultItem[] = firstItemsByContent
                    .map(({ raw, item }) => {
                        const expectedFile = buildGalleryDlDownloadedFilePath(basePath, raw, url)
                        const file = findExistingGalleryDlFile(expectedFile, basePath, raw, url)
                        if (!file) {
                            console.warn(
                                '[GalleryDlTask] Downloaded file not found: ',
                                expectedFile,
                                raw
                            )
                            return null
                        }

                        const isImage = !!file.match(/\.(jpg|jpeg|png|webp|gif|heic)$/i)
                        const metadata = mapExternalMediaToDownloadMetadata(
                            item,
                            file,
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

const getExternalContentGroupKey = (item: ExternalMediaStructure): string => {
    const contentKey = firstValidText(item.contentKey, item.contentUrl)

    if (contentKey) {
        return `${item.downloader}:${item.extractor}:content:${contentKey}`
    }

    const fileKey = firstValidText(item.fileKey, item.filename)

    if (fileKey) {
        return `${item.downloader}:${item.extractor}:file:${fileKey}`
    }

    return `${item.downloader}:${item.extractor}:source:${item.sourceUrl}`
}
