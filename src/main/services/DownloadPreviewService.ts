import { createHash, randomUUID } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises'
import { isAbsolute, join, resolve, toNamespacedPath } from 'node:path'
import { createThumbnailJpeg, inspectThumbnailJpeg } from './ThumbnailImageService'

function youtubeVideoId(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) {
        return null
    }

    try {
        const url = new URL(value)

        if (
            url.protocol !== 'https:' ||
            url.username ||
            url.password ||
            url.port ||
            url.searchParams.has('list')
        ) {
            return null
        }

        let id: string | undefined

        if (url.hostname === 'youtu.be') {
            id = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
        } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) {
            if (url.pathname === '/watch') {
                if (url.searchParams.getAll('v').length !== 1) return null
                id = url.searchParams.get('v') ?? undefined
            } else {
                id = /^\/shorts\/([A-Za-z0-9_-]{11})\/?$/.exec(url.pathname)?.[1]
            }
        }

        return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
    } catch {
        return null
    }
}

interface PreviewIndex {
    version: 1
    videoId: string
    transformVersion: 'jpeg-v1'
    file: string
    sha256: string
    size: number
    width: number
    height: number
}

interface CachedJpeg {
    buffer: Buffer
    sha256: string
    width: number
    height: number
}

function pathKey(value: string): string {
    const absolute = resolve(value)

    return process.platform === 'win32' ? toNamespacedPath(absolute).toLowerCase() : absolute
}

function fileStamp(info: BigIntStats): string {
    return [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs, info.nlink].join(':')
}

async function readRegularFile(path: string, maximumBytes: number): Promise<Buffer> {
    const before = await lstat(path, { bigint: true })

    if (
        !before.isFile() ||
        before.nlink !== 1n ||
        before.size <= 0n ||
        before.size > BigInt(maximumBytes) ||
        pathKey(await realpath(path)) !== pathKey(path)
    ) {
        throw new Error('PREVIEW_FILE_INVALID')
    }

    const handle = await open(path, 'r')

    try {
        if (fileStamp(before) !== fileStamp(await handle.stat({ bigint: true }))) {
            throw new Error('PREVIEW_FILE_CHANGED')
        }

        const expectedSize = Number(before.size)
        const buffer = Buffer.alloc(expectedSize + 1)
        let total = 0

        while (total < buffer.length) {
            const { bytesRead } = await handle.read(buffer, total, buffer.length - total, total)

            if (bytesRead === 0) break
            total += bytesRead
        }

        if (
            total !== expectedSize ||
            fileStamp(before) !== fileStamp(await handle.stat({ bigint: true })) ||
            fileStamp(before) !== fileStamp(await lstat(path, { bigint: true })) ||
            pathKey(await realpath(path)) !== pathKey(path)
        ) {
            throw new Error('PREVIEW_FILE_CHANGED')
        }

        return buffer.subarray(0, total)
    } finally {
        await handle.close()
    }
}

export class DownloadPreviewService {
    private readonly pending = new Map<string, Promise<string | null>>()
    private readonly waiting: Array<() => void> = []
    private active = 0

    constructor(
        private readonly cacheDirectory: string,
        private readonly fetcher: typeof fetch = globalThis.fetch,
        private readonly encode = createThumbnailJpeg,
        private readonly inspectJpeg = inspectThumbnailJpeg
    ) {
        if (!isAbsolute(cacheDirectory) || cacheDirectory.includes('\0')) {
            throw new Error('PREVIEW_DIRECTORY_INVALID')
        }
    }

    get(value: unknown): Promise<string | null> {
        const id = youtubeVideoId(value)

        if (!id) return Promise.resolve(null)

        const previous = this.pending.get(id)
        if (previous) return previous

        if (this.pending.size >= 64) return Promise.resolve(null)

        const task = this.withSlot(() => this.load(id))
            .catch(() => null)
            .finally(() => {
                this.pending.delete(id)
            })

        this.pending.set(id, task)
        return task
    }

    private async withSlot<T>(action: () => Promise<T>): Promise<T> {
        if (this.active >= 4) {
            await new Promise<void>((resolve) => {
                this.waiting.push(resolve)
            })
        } else {
            this.active++
        }

        try {
            return await action()
        } finally {
            const next = this.waiting.shift()

            if (next) next()
            else this.active--
        }
    }

    private async readJpeg(path: string): Promise<CachedJpeg | null> {
        try {
            const buffer = await readRegularFile(path, 8 * 1024 * 1024)

            const dimensions = this.inspectJpeg(buffer)

            return {
                buffer,
                sha256: createHash('sha256').update(buffer).digest('hex'),
                ...dimensions
            }
        } catch {
            return null
        }
    }

    private async readIndex(id: string): Promise<PreviewIndex | null> {
        try {
            const buffer = await readRegularFile(
                join(this.cacheDirectory, `${id}.preview.json`),
                16 * 1024
            )

            const record = JSON.parse(buffer.toString('utf8')) as PreviewIndex

            const filenamePattern = new RegExp(
                `^${id}\\.` +
                    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-' +
                    '[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$'
            )

            if (
                !record ||
                record.version !== 1 ||
                record.videoId !== id ||
                record.transformVersion !== 'jpeg-v1' ||
                typeof record.file !== 'string' ||
                !filenamePattern.test(record.file) ||
                typeof record.sha256 !== 'string' ||
                !/^[0-9a-f]{64}$/.test(record.sha256) ||
                !Number.isSafeInteger(record.size) ||
                record.size <= 0 ||
                record.size > 8 * 1024 * 1024 ||
                !Number.isSafeInteger(record.width) ||
                !Number.isSafeInteger(record.height) ||
                record.width < 1 ||
                record.height < 1 ||
                Math.max(record.width, record.height) > 480
            ) {
                return null
            }

            return record
        } catch {
            return null
        }
    }

    private async findCached(id: string): Promise<string | null> {
        const index = await this.readIndex(id)

        if (index) {
            const path = join(this.cacheDirectory, index.file)
            const jpeg = await this.readJpeg(path)

            if (
                jpeg &&
                jpeg.sha256 === index.sha256 &&
                jpeg.buffer.length === index.size &&
                jpeg.width === index.width &&
                jpeg.height === index.height
            ) {
                return path
            }
        }

        // 이전 형식의 정상 JPG도 온라인 조회 없이 재사용한다.
        const legacyPath = join(this.cacheDirectory, `${id}.jpg`)

        return (await this.readJpeg(legacyPath)) ? legacyPath : null
    }

    private async saveIndex(id: string, record: PreviewIndex): Promise<void> {
        const temporary = join(this.cacheDirectory, `${id}.${randomUUID()}.preview.tmp`)

        const destination = join(this.cacheDirectory, `${id}.preview.json`)

        const handle = await open(temporary, 'wx')

        try {
            try {
                await handle.writeFile(JSON.stringify(record), 'utf8')
                await handle.sync()
            } finally {
                await handle.close()
            }

            await rename(temporary, destination)
        } finally {
            await unlink(temporary).catch(() => {})
        }
    }

    private async load(id: string): Promise<string | null> {
        await mkdir(this.cacheDirectory, { recursive: true })

        const cached = await this.findCached(id)
        if (cached) return cached

        try {
            const response = await this.fetcher(`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, {
                signal: AbortSignal.timeout(10_000),
                redirect: 'error',
                credentials: 'omit',
                headers: { Accept: 'image/jpeg' }
            })

            if (!response.ok || !response.body) return null

            const contentType = response.headers
                .get('content-type')
                ?.split(';', 1)[0]
                .trim()
                .toLowerCase()

            if (contentType !== 'image/jpeg' && contentType !== 'image/png') {
                return null
            }

            const reader = response.body.getReader()
            const chunks: Buffer[] = []
            let total = 0

            try {
                for (;;) {
                    const { done, value } = await reader.read()
                    if (done) break

                    total += value.byteLength

                    if (total > 8 * 1024 * 1024) {
                        throw new Error('THUMBNAIL_INPUT_TOO_LARGE')
                    }

                    chunks.push(Buffer.from(value))
                }
            } finally {
                await reader.cancel().catch(() => {})
                reader.releaseLock()
            }

            const jpeg = this.encode(Buffer.concat(chunks))
            const dimensions = this.inspectJpeg(jpeg.buffer)

            const expectedHash = createHash('sha256').update(jpeg.buffer).digest('hex')

            // 손상된 기존 JPG를 덮어쓰지 않는다.
            const filename = `${id}.${randomUUID()}.jpg`
            const destination = join(this.cacheDirectory, filename)
            const handle = await open(destination, 'wx')

            try {
                await handle.writeFile(jpeg.buffer)
                await handle.sync()
            } finally {
                await handle.close()
            }

            const saved = await this.readJpeg(destination)

            if (
                !saved ||
                saved.sha256 !== expectedHash ||
                saved.width !== dimensions.width ||
                saved.height !== dimensions.height
            ) {
                throw new Error('THUMBNAIL_FILE_CHANGED')
            }

            // 완성된 JPG를 검사한 후 현재 캐시로 등록한다.
            await this.saveIndex(id, {
                version: 1,
                videoId: id,
                transformVersion: 'jpeg-v1',
                file: filename,
                sha256: saved.sha256,
                size: saved.buffer.length,
                width: saved.width,
                height: saved.height
            })

            return destination
        } catch {
            return null
        }
    }
}
