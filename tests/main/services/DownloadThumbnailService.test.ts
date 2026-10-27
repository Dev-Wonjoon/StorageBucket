import { createHash } from 'node:crypto'
import { link, lstat, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThumbnailHandlers } from '../../../src/main/features/thumbnail/ThumbnailHandler'

import * as s from '../../../src/database/schema-v2'
import { schemaV2Sql } from '../../../src/database/schema-v2.sql'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { downloadStorageSql } from '../../../src/database/migrate'
import { MediaRepository, type V2Database } from '@features/media/MediaRepository'
import { DownloadRepository } from '@features/download/DownloadRepository'
import { DownloadCommitRepository } from '@features/download/DownloadCommitRepository'
import { DownloadRootRepository } from '@features/download/DownloadRootRepository'

import {
    DownloadThumbnailRepository,
    downloadThumbnailPaths,
    type ThumbnailFileProof,
    type ThumbnailWork
} from '@features/thumbnail/DownloadThumbnailRepository'
import {
    DownloadVerificationService,
    downloadStagingDirectory,
    inspectDownloadFile,
    nodeVerificationFileSystem
} from '@features/download/DownloadVerificationService'
import { DownloadThumbnailService } from '@features/thumbnail/DownloadThumbnailService'
import { createTestWorkspace, cleanupTestWorkspace } from '../../helpers/test-workspace.cjs'

// 이미지 코덱은 대체하고 실제 파일 저장과 DB 상태를 검증한다.
vi.mock('electron', () => ({
    nativeImage: {}
}))

vi.mock('../../../src/database/index', () => {
    throw new Error('USER_DATABASE_IMPORTED')
})

vi.mock('@features/settings/ConfigManager', () => {
    throw new Error('USER_SETTINGS_IMPORTED')
})

const VIDEO_ID = 'jNQXAC9IVRw'
const SOURCE_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

// 코덱 대체용 입력이다. 실제 이미지 디코딩 테스트용 파일은 아니다.
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0xff, 0xd9])

const VIDEO_BYTES = Buffer.from('thumbnail-test-video')

let root: string | undefined
let sqlite: Database.Database | undefined
let db: V2Database

beforeEach(async () => {
    root = createTestWorkspace('download-thumbnail')

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...schemaV2Sql, ...schemaV2Guards, ...downloadStorageSql]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
})

afterEach(() => {
    try {
        if (sqlite?.open) {
            assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
        }
    } finally {
        sqlite?.close()
        sqlite = undefined

        if (root) {
            cleanupTestWorkspace(root)
            root = undefined
        }
    }
})

function readTask(taskId: string) {
    return db.select().from(s.maintenanceTasks).where(eq(s.maintenanceTasks.id, taskId)).get()!
}

function readMediaFile(fileId: number) {
    return db.select().from(s.mediaFiles).where(eq(s.mediaFiles.id, fileId)).get()!
}

async function fixture() {
    assert.ok(root)
    const storageRoot = root

    const jobs = new DownloadRepository(db)
    const roots = new DownloadRootRepository(db)

    const requestUrl = db
        .insert(s.downloadUrls)
        .values({
            url: SOURCE_URL,
            normalizedUrl: SOURCE_URL,
            normalizationVersion: 1
        })
        .returning()
        .get()

    const job = jobs.enqueue({
        mode: 'create',
        requestUrlId: requestUrl.id,
        originalUrl: SOURCE_URL
    })

    roots.bind(job.id, storageRoot)

    const { attempt } = jobs.startAttempt(job.id, 'manual_initial')
    const targetKey = `youtube:${VIDEO_ID}`

    jobs.freezeTargets(job.id, attempt.id, [
        {
            targetKey,
            sourceUrl: SOURCE_URL,
            metadata: {
                kind: 'video',
                externalId: VIDEO_ID,
                platformName: 'Youtube',
                title: '테스트 영상'
            }
        }
    ])

    const staging = downloadStagingDirectory(storageRoot, job.id, attempt.id)

    await mkdir(staging, { recursive: true })

    const stagedVideo = join(staging, 'video.mp4')
    await writeFile(stagedVideo, VIDEO_BYTES)

    jobs.recordResults(job.id, attempt.id, [{ targetKey, stagedPath: stagedVideo }])

    await new DownloadVerificationService(jobs, storageRoot).verify(job.id, attempt.id)

    const commits = new DownloadCommitRepository(db, storageRoot)
    const plan = commits.prepare(job.id, attempt.id)

    // 테스트에서는 파일 이동과 검증을 직접 수행한다.
    commits.begin(plan)

    const target = plan.targets[0]

    await mkdir(dirname(target.finalPath), { recursive: true })
    await link(stagedVideo, target.finalPath)
    await unlink(stagedVideo)

    const inspected = await inspectDownloadFile(
        storageRoot,
        dirname(target.finalPath),
        target.finalPath,
        nodeVerificationFileSystem
    )

    const { stagedPath: _stagedPath, ...finalFile } = inspected

    const committed = commits.complete(plan, [
        {
            ...finalFile,
            targetId: target.id,
            finalPath: target.finalPath
        }
    ])

    const task = db
        .select()
        .from(s.maintenanceTasks)
        .all()
        .find((row) => row.kind === 'preview_generation')

    assert.ok(task)

    const file = db
        .select()
        .from(s.mediaFiles)
        .where(eq(s.mediaFiles.mediaId, committed.mediaId))
        .get()

    assert.ok(file)

    const work: ThumbnailWork = {
        taskId: task.id,
        attemptId: attempt.id,
        storageRoot,
        mediaId: committed.mediaId,
        fileId: file.id,
        fileKey: targetKey,
        contentHash: createHash('sha256').update(VIDEO_BYTES).digest('hex'),
        sourceUrl: SOURCE_URL,
        transformVersion: 'jpeg-v1'
    }

    const cachedPath = join(storageRoot, 'cached-preview.jpg')
    await writeFile(cachedPath, JPEG_BYTES)

    const previews = {
        get: vi.fn(async (_url: unknown): Promise<string | null> => cachedPath)
    }

    const thumbnails = new DownloadThumbnailRepository(db)
    const onChanged = vi.fn()

    const service = new DownloadThumbnailService(thumbnails, previews, {
        inspectJpeg: () => ({ width: 480, height: 270 }),
        onChanged
    })

    return {
        jobs,
        roots,
        requestUrlId: requestUrl.id,
        jobId: job.id,
        mediaId: committed.mediaId,
        fileId: file.id,
        originalPath: target.finalPath,
        cachedPath,
        work,
        thumbnails,
        previews,
        service,
        onChanged
    }
}

async function preparedProof(work: ThumbnailWork, path: string): Promise<ThumbnailFileProof> {
    const paths = downloadThumbnailPaths(work)

    const inspected = await inspectDownloadFile(
        work.storageRoot,
        paths.directory,
        path,
        nodeVerificationFileSystem
    )

    return {
        path,
        realPath: inspected.realPath,
        size: inspected.size,
        sha256: inspected.sha256,
        device: inspected.device,
        inode: inspected.inode,
        mtimeNs: inspected.mtimeNs,
        ctimeNs: inspected.ctimeNs,
        width: 480,
        height: 270
    }
}

describe('DownloadThumbnailService', () => {
    it('JPG를 영구 저장하고 갤러리 표지로 등록한다', async () => {
        const f = await fixture()
        const paths = downloadThumbnailPaths(f.work)

        const before = db.select().from(s.medias).where(eq(s.medias.id, f.mediaId)).get()!

        await f.service.runPending()

        const file = readMediaFile(f.fileId)

        expect(file.thumbnailPath).toBe(paths.finalPath)
        expect(file.thumbnailOrigin).toBe('app_generated')
        expect(file.transformVersion).toBe('jpeg-v1')
        expect(readTask(f.work.taskId).state).toBe('completed')

        expect(await readFile(paths.finalPath)).toEqual(JPEG_BYTES)
        expect(await readFile(f.cachedPath)).toEqual(JPEG_BYTES)
        expect(await readFile(f.originalPath)).toEqual(VIDEO_BYTES)

        await expect(lstat(paths.stagedPath)).rejects.toMatchObject({
            code: 'ENOENT'
        })

        const after = db.select().from(s.medias).where(eq(s.medias.id, f.mediaId)).get()!

        expect(after.revision).toBe(before.revision)

        const media = new MediaRepository(db).get(f.mediaId)
        expect(media?.cover?.path).toBe(paths.finalPath)

        expect(f.onChanged).toHaveBeenCalledWith(f.mediaId)
    })

    it('검증 후 중단되어 두 링크가 남아도 재처리한다', async () => {
        const f = await fixture()
        const work = f.thumbnails.claim(f.work.taskId)

        assert.ok(work)

        const paths = downloadThumbnailPaths(work)

        await mkdir(paths.directory, { recursive: true })
        await writeFile(paths.stagedPath, JPEG_BYTES)

        f.thumbnails.recordPrepared(work, await preparedProof(work, paths.stagedPath))

        // 최종 링크 생성 직후 중단된 상황을 만든다.
        await link(paths.stagedPath, paths.finalPath)

        f.thumbnails.recoverAtStartup()
        await f.service.runPending()

        expect(f.previews.get).not.toHaveBeenCalled()
        expect(readTask(work.taskId).state).toBe('completed')
        expect(readMediaFile(f.fileId).thumbnailPath).toBe(paths.finalPath)

        expect((await lstat(paths.finalPath)).nlink).toBe(1)

        await expect(lstat(paths.stagedPath)).rejects.toMatchObject({
            code: 'ENOENT'
        })
    })

    it('검증 기록이 없는 기존 파일은 보존한다', async () => {
        const f = await fixture()
        const paths = downloadThumbnailPaths(f.work)
        const unknown = Buffer.from('확인되지 않은 파일')

        await mkdir(paths.directory, { recursive: true })
        await writeFile(paths.stagedPath, unknown)

        await f.service.runPending()

        expect(await readFile(paths.stagedPath)).toEqual(unknown)
        expect(readMediaFile(f.fileId).thumbnailPath).toBeNull()

        const task = readTask(f.work.taskId)
        expect(task.state).toBe('failed')
        expect(task.lastError).toBe('THUMBNAIL_UNVERIFIED_FILE')

        expect(f.previews.get).not.toHaveBeenCalled()
        expect(f.jobs.get(f.jobId)?.state).toBe('completed')
    })

    it('같은 미디어를 재다운로드하는 동안 작업을 미룬다', async () => {
        const f = await fixture()

        const media = db.select().from(s.medias).where(eq(s.medias.id, f.mediaId)).get()!

        const replacement = f.jobs.enqueue({
            mode: 'replace',
            requestUrlId: f.requestUrlId,
            originalUrl: SOURCE_URL,
            mediaId: f.mediaId,
            expectedRevision: media.revision
        })

        f.roots.bind(replacement.id, f.work.storageRoot)
        f.jobs.startAttempt(replacement.id, 'manual_initial')

        await f.service.runPending()

        const task = readTask(f.work.taskId)

        expect(task.state).toBe('pending')
        expect(task.lastError).toBe('THUMBNAIL_SOURCE_BUSY')
        expect(readMediaFile(f.fileId).thumbnailPath).toBeNull()

        expect(f.previews.get).not.toHaveBeenCalled()
        expect(f.jobs.get(f.jobId)?.state).toBe('completed')
    })

    it('썸네일 조회에 실패해도 완료된 영상은 유지한다', async () => {
        const f = await fixture()
        f.previews.get.mockResolvedValueOnce(null)

        await f.service.runPending()

        expect(readTask(f.work.taskId).state).toBe('failed')
        expect(readMediaFile(f.fileId).thumbnailPath).toBeNull()
        expect(f.jobs.get(f.jobId)?.state).toBe('completed')
        expect(await readFile(f.originalPath)).toEqual(VIDEO_BYTES)
    })

    it('누락된 작업을 등록하고 중복 등록하지 않는다', async () => {
        const f = await fixture()

        // 기존 작업이 있으면 추가하지 않는다.
        expect(f.thumbnails.enqueueMissing()).toBe(0)

        // 메모리 DB에서 작업 누락 상황을 만든다.
        db.delete(s.maintenanceTasks).where(eq(s.maintenanceTasks.id, f.work.taskId)).run()

        expect(f.thumbnails.enqueueMissing()).toBe(1)
        expect(f.thumbnails.enqueueMissing()).toBe(0)

        await f.service.runPending()

        const file = readMediaFile(f.fileId)

        expect(file.thumbnailOrigin).toBe('app_generated')
        expect(file.thumbnailPath).not.toBeNull()
        expect(await readFile(file.thumbnailPath!)).toEqual(JPEG_BYTES)
    })

    it('조회 실패 작업을 수동 재시도하여 영구 썸네일을 등록한다', async () => {
        const f = await fixture()
        const paths = downloadThumbnailPaths(f.work)

        f.previews.get.mockResolvedValueOnce(null)

        await f.service.runPending()

        const failed = readTask(f.work.taskId)

        expect(failed.state).toBe('failed')
        expect(failed.lastError).toBe('THUMBNAIL_UNAVAILABLE')

        // 실패 작업은 실행기를 다시 호출하는 것만으로 재시도하지 않는다.
        await f.service.runPending()
        expect(f.previews.get).toHaveBeenCalledTimes(1)

        expect(f.thumbnails.retryFailed(f.work.taskId)).toEqual({
            accepted: true
        })

        const queued = readTask(f.work.taskId)

        expect(queued.state).toBe('pending')
        expect(queued.lastError).toBeNull()
        expect(queued.tryCount).toBe(failed.tryCount)
        expect(queued.payloadJson).toBe(failed.payloadJson)

        // 연속 클릭으로 같은 작업을 중복 접수하지 않는다.
        expect(f.thumbnails.retryFailed(f.work.taskId)).toEqual({
            accepted: false,
            reason: 'not_retryable'
        })

        await f.service.runPending()

        expect(f.previews.get).toHaveBeenCalledTimes(2)
        expect(readTask(f.work.taskId).state).toBe('completed')
        expect(readTask(f.work.taskId).tryCount).toBe(failed.tryCount + 1)
        expect(readMediaFile(f.fileId).thumbnailPath).toBe(paths.finalPath)

        expect(await readFile(paths.finalPath)).toEqual(JPEG_BYTES)
        expect(await readFile(f.originalPath)).toEqual(VIDEO_BYTES)
        expect(f.jobs.get(f.jobId)?.state).toBe('completed')
    })

    it('검증되지 않은 파일이 남은 작업은 재시도 대상으로 허용하지 않는다', async () => {
        const f = await fixture()
        const paths = downloadThumbnailPaths(f.work)
        const unknown = Buffer.from('확인되지 않은 파일')

        await mkdir(paths.directory, { recursive: true })
        await writeFile(paths.stagedPath, unknown)

        await f.service.runPending()

        const before = readTask(f.work.taskId)

        expect(before.lastError).toBe('THUMBNAIL_UNVERIFIED_FILE')

        expect(f.thumbnails.retryFailed(f.work.taskId)).toEqual({
            accepted: false,
            reason: 'not_retryable'
        })

        expect(readTask(f.work.taskId)).toEqual(before)
        expect(await readFile(paths.stagedPath)).toEqual(unknown)
        expect(f.previews.get).not.toHaveBeenCalled()
    })

    it('완료된 썸네일 작업은 재시도하지 않는다', async () => {
        const f = await fixture()

        await f.service.runPending()

        const before = readTask(f.work.taskId)
        const thumbnailPath = readMediaFile(f.fileId).thumbnailPath

        expect(f.thumbnails.retryFailed(f.work.taskId)).toEqual({
            accepted: false,
            reason: 'not_retryable'
        })

        expect(readTask(f.work.taskId)).toEqual(before)
        expect(readMediaFile(f.fileId).thumbnailPath).toBe(thumbnailPath)
        expect(f.previews.get).toHaveBeenCalledTimes(1)
    })

    it('IPC를 통해 실패 상태를 조회하고 재시도한다', async () => {
        const f = await fixture()
        const handlers = createThumbnailHandlers(() => f.thumbnails)

        const event = {} as Parameters<(typeof handlers)['thumbnail:get']>[0]

        const request = {
            mediaId: f.mediaId,
            fileId: f.fileId
        }

        expect(await handlers['thumbnail:get'](event, request)).toEqual({
            ok: true,
            data: {
                state: 'pending',
                taskId: f.work.taskId,
                canRetry: false
            }
        })

        f.previews.get.mockResolvedValueOnce(null)
        await f.service.runPending()

        expect(await handlers['thumbnail:get'](event, request)).toEqual({
            ok: true,
            data: {
                state: 'failed',
                taskId: f.work.taskId,
                canRetry: true
            }
        })

        expect(await handlers['thumbnail:retry'](event, request)).toEqual({
            ok: true,
            data: {
                state: 'pending',
                taskId: f.work.taskId,
                canRetry: false
            }
        })

        const duplicate = await handlers['thumbnail:retry'](event, request)

        expect(duplicate).toMatchObject({
            ok: false,
            error: { code: 'NOT_RETRYABLE' }
        })

        await f.service.runPending()

        expect(await handlers['thumbnail:get'](event, request)).toEqual({
            ok: true,
            data: {
                state: 'registered',
                taskId: null,
                canRetry: false
            }
        })

        expect(await readFile(f.originalPath)).toEqual(VIDEO_BYTES)
    })

    it('잘못된 IPC 요청은 저장소에 전달하지 않는다', async () => {
        const f = await fixture()
        const resolveRepository = vi.fn(() => f.thumbnails)
        const handlers = createThumbnailHandlers(resolveRepository)

        const event = {} as Parameters<(typeof handlers)['thumbnail:get']>[0]

        const invalidRequests = [
            null,
            [],
            {},
            { mediaId: 1, fileId: 0 },
            { mediaId: '1', fileId: 2 },
            { mediaId: 1.5, fileId: 2 },
            { mediaId: 1, fileId: 2, taskId: f.work.taskId }
        ]

        for (const request of invalidRequests) {
            for (const handler of Object.values(handlers)) {
                expect(await handler(event, request)).toMatchObject({
                    ok: false,
                    error: { code: 'INVALID_ARGUMENT' }
                })
            }
        }

        expect(resolveRepository).not.toHaveBeenCalled()
    })

    it('다른 미디어나 없는 파일을 지정하면 작업을 반환하지 않는다', async () => {
        const f = await fixture()

        expect(f.thumbnails.getStatus(f.mediaId, f.fileId + 100000)).toBeNull()

        expect(f.thumbnails.getStatus(f.mediaId + 100000, f.fileId)).toBeNull()

        expect(readTask(f.work.taskId).state).toBe('pending')
        expect(f.previews.get).not.toHaveBeenCalled()
    })
})
