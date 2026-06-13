import { ChildProcess, spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import { pipeline } from 'stream/promises'
import { EngineManager } from '../managers/EngineManager'
import {
    DownloadOptions,
    DownloadResult,
    DownloadResultItem,
    DownloadResultMetadata,
    TaskCallbacks,
    TaskHandle
} from '../../shared/types'
import { buildYtdlpArgs } from './ArgsUtils'
import { ConfigManager } from '../managers/ConfigManager'

async function downloadThumbnail(
    url: string,
    videoId: string,
    videoName: string,
    basePath: string
): Promise<string | null> {
    if (!url) return null

    try {
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true })
        const urlObj = new URL(url)
        const extension = path.extname(urlObj.pathname) || '.jpg'
        const safeId = videoId.replace(/[\/\\:*?"<>|]/g, '')
        const safeName = videoName.replace(/[\/\\:*?"<>|]/g, '')
        const filepath = path.join(basePath, `${safeName}_${safeId}${extension}`)
        if (fs.existsSync(filepath)) return filepath

        const response = await fetch(url)
        if (!response.ok || !response.body) return null

        // @ts-ignore Node/Electron fetch body is compatible with pipeline here.
        await pipeline(response.body, fs.createWriteStream(filepath))
        return filepath
    } catch {
        return null
    }
}

function getDownloadedFilePath(meta: any): string {
    // changed: yt-dlp often stores the final merged file path in requested_downloads.
    return (
        meta.requested_downloads?.[0]?.filepath ||
        meta.requested_downloads?.[0]?.filename ||
        meta.filepath ||
        meta.filename ||
        meta._filename ||
        ''
    )
}

function findExistingDownloadedFile(expectedPath: string): string | null {
    if (!expectedPath) return null
    if (fs.existsSync(expectedPath)) return expectedPath

    const directory = path.dirname(expectedPath)
    const extension = path.extname(expectedPath)
    const basename = path.basename(expectedPath, extension)

    if (!fs.existsSync(directory)) return null

    const candidates = fs
        .readdirSync(directory)
        .filter((name) => name === path.basename(expectedPath) || name.startsWith(`${basename}.`))
        .map((name) => path.join(directory, name))
        .filter((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
        .map((candidate) => ({ candidate, size: fs.statSync(candidate).size }))
        .sort((a, b) => b.size - a.size)

    return candidates[0]?.candidate ?? null
}

export function downloadYtdlp(
    url: string,
    basePath: string,
    options: DownloadOptions,
    callbacks: TaskCallbacks
): TaskHandle {
    const engineManager = EngineManager.getInstance()
    const ytdlpPath = engineManager.getRequiredBinaryPath('yt-dlp')
    const ffmpegPath = engineManager.getRequiredBinaryPath('ffmpeg')
    let proc: ChildProcess | null = null
    let aborted = false

    const promise = new Promise<DownloadResult>((resolve, reject) => {
        const args = buildYtdlpArgs(url, basePath, options, ffmpegPath)
        console.log(`[YtdlpTask] command: ${ytdlpPath} ${args.join(' ')}`)

        proc = spawn(ytdlpPath, args)

        proc.on('error', (error) => {
            // changed: report spawn failures as job failures instead of crashing main.
            callbacks.onProgress(0, { status: 'failed' })
            reject(error)
        })

        let stdoutBuffer = ''
        let stderrBuffer = ''
        const allMetadata: any[] = []

        proc.stdout?.on('data', (data: Buffer) => {
            stdoutBuffer += data.toString()
            const lines = stdoutBuffer.split('\n')
            stdoutBuffer = lines.pop() || ''

            lines.forEach((line) => {
                const trimmed = line.trim()
                if (!trimmed) return

                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(trimmed)
                        allMetadata.push(parsed)
                        callbacks.onProgress(-1, {
                            status: 'start',
                            title: parsed.title,
                            platform: parsed.extractor_key,
                            thumbnail: parsed.thumbnail,
                            itemCount: allMetadata.length
                        })
                    } catch {
                        // ignore non-metadata JSON fragments
                    }
                }
            })
        })

        proc.stderr?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n')
            lines.forEach((line) => {
                const trimmed = line.trim()
                if (!trimmed) return

                stderrBuffer += `${trimmed}\n`
                callbacks.onLog?.(trimmed, 'raw')
                console.log(`[yt-dlp stderr] ${trimmed}`)

                const progressMatch = trimmed.match(/\[download\]\s+(\d+\.?\d*)%/)
                if (progressMatch) {
                    const progress = parseFloat(progressMatch[1])
                    callbacks.onProgress(progress, { status: 'downloading' })
                }
            })
        })

        proc.on('close', async (code) => {
            if (aborted) {
                reject(new Error('Aborted'))
                return
            }

            if (stdoutBuffer.trim()) {
                const trimmed = stdoutBuffer.trim()
                if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        allMetadata.push(JSON.parse(trimmed))
                    } catch {
                        // ignore invalid trailing JSON
                    }
                }
            }

            if (code !== 0) {
                callbacks.onProgress(0, { status: 'failed' })
                reject(new Error(`yt-dlp exited with code ${code}: ${stderrBuffer}`))
                return
            }

            const results: DownloadResultItem[] = []

            for (const meta of allMetadata) {
                const expectedFile = getDownloadedFilePath(meta)
                const downloadedFile = findExistingDownloadedFile(expectedFile)

                if (!downloadedFile || !fs.existsSync(downloadedFile)) {
                    // changed: skip metadata entries that do not point to a real file.
                    console.warn('[YtdlpTask] Downloaded file not found:', expectedFile, meta.title)
                    continue
                }

                let thumbnailPath: string | null = null

                if (meta.thumbnail) {
                    const siteName = meta.extractor_key || meta.extractor || 'unknown'
                    const thumbDir = path.join(
                        ConfigManager.getInstance().getThumbnailPath(),
                        siteName
                    )
                    thumbnailPath = await downloadThumbnail(
                        meta.thumbnail,
                        meta.id,
                        meta.title,
                        thumbDir
                    )
                }

                const metadata: DownloadResultMetadata = {
                    id: meta.id,
                    title: meta.title,
                    extractor_key: meta.extractor_key || meta.extractor,
                    filename: downloadedFile,
                    filesize: meta.filesize,
                    duration: meta.duration,
                    uploader: meta.uploader,
                    uploader_id: meta.uploader_id,
                    uploader_url: meta.uploader_url,
                    channel_id: meta.channel_id,
                    channel: meta.channel,
                    webpage_url: meta.webpage_url,
                    thumbnail: meta.thumbnail
                }

                results.push({
                    metadata,
                    videoPath: downloadedFile,
                    thumbnailPath
                })
            }

            if (results.length === 0) {
                // changed: a successful yt-dlp exit without files is still a failed app job.
                callbacks.onProgress(0, { status: 'failed' })
                reject(new Error('yt-dlp completed, but downloaded files were not found.'))
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

export function fetchVideoIds(url: string): Promise<string[]> {
    const engineManager = EngineManager.getInstance()
    const ytdlpPath = engineManager.getRequiredBinaryPath('yt-dlp')

    const args = [
        url,
        '--flat-playlist',
        '--print',
        'id',
        '--no-download',
        '--no-warning',
        '--no-check-certificates'
    ]

    return new Promise((resolve, reject) => {
        const proc = spawn(ytdlpPath, args)
        let stdout = ''
        let stderr = ''

        proc.on('error', reject)
        proc.stdout?.on('data', (data: Buffer) => {
            stdout += data.toString()
        })
        proc.stderr?.on('data', (data: Buffer) => {
            stderr += data.toString()
        })

        proc.on('close', (code) => {
            if (code === 0) {
                const ids = stdout
                    .split('\n')
                    .map((l) => l.trim())
                    .filter(Boolean)
                resolve(ids)
            } else {
                reject(new Error(`yt-dlp --print id failed (code ${code}): ${stderr}`))
            }
        })
    })
}
