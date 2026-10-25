import { createHash, randomUUID } from 'node:crypto'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { and, asc, eq, sql } from 'drizzle-orm'
import * as s from '../../database/schema-v2'
import type { V2Database } from './MediaRepository'
import {
    DownloadRepositoryError,
    type DownloadFileVerification,
    type DownloadTargetMetadata
} from './DownloadRepository'

type Tx = Parameters<Parameters<V2Database['transaction']>[0]>[0]
type Target = typeof s.downloadTargets.$inferSelect
type Parent = typeof s.medias.$inferSelect
type File = typeof s.mediaFiles.$inferSelect

export interface DownloadCommitPlan {
    version: 1
    jobId: string
    attemptId: string
    requestUrlId: number
    mode: 'create' | 'replace'
    sourceTitle: string | null
    parent: Parent | null
    oldFiles: File[]
    manifestPath: string
    targets: (Target & {
        stagedPath: string
        finalPath: string
    })[]
}

export interface DownloadFinalFile extends Omit<DownloadFileVerification, 'stagedPath'> {
    finalPath: string
}

function fail(code: ConstructorParameters<typeof DownloadRepositoryError>[0]): never {
    throw new DownloadRepositoryError(code)
}

function pathKey(path: string) {
    const value = resolve(path)

    return process.platform === 'win32' ? value.toLowerCase() : value
}

function within(parent: string, path: string) {
    const part = relative(parent, path)

    if (
        !isAbsolute(path) ||
        !part ||
        part === '..' ||
        part.startsWith('..' + sep) ||
        isAbsolute(part) ||
        path.includes('\0')
    ) {
        fail('UNSAFE_STAGING_PATH')
    }
}

function verified(target: Target) {
    let value: DownloadTargetMetadata & {
        fileVerification: DownloadFileVerification & {
            version: number
        }
    }

    try {
        value = JSON.parse(target.metadataJson)
    } catch {
        fail('VERIFICATION_CHANGED')
    }

    const proof = value?.fileVerification

    if (
        !value ||
        !['image', 'video', 'audio', 'unknown'].includes(value.kind) ||
        proof?.version !== 1 ||
        proof.targetId !== target.id ||
        proof.stagedPath !== target.stagedPath ||
        typeof proof.realPath !== 'string' ||
        pathKey(proof.realPath) !== pathKey(proof.stagedPath) ||
        !Number.isSafeInteger(proof.size) ||
        proof.size <= 0 ||
        !/^[0-9a-f]{64}$/.test(proof.sha256) ||
        !/^\d+$/.test(proof.device) ||
        !/^[1-9]\d*$/.test(proof.inode) ||
        !/^-?\d+$/.test(proof.mtimeNs) ||
        !/^-?\d+$/.test(proof.ctimeNs)
    ) {
        fail('VERIFICATION_CHANGED')
    }

    return value
}

export class DownloadCommitRepository {
    private readonly root: string

    constructor(
        private readonly db: V2Database,
        storageRoot: string,
        private readonly clock: () => number = Date.now
    ) {
        if (!isAbsolute(storageRoot) || storageRoot.includes('\0')) {
            fail('INVALID_ARGUMENT')
        }

        this.root = resolve(storageRoot)

        if (db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)?.foreign_keys !== 1) {
            fail('INVARIANT_VIOLATION')
        }
    }

    // 파일 작업 없이, manifest에 기록할 계획을 조회한다.
    prepare(jobId: string, attemptId: string): DownloadCommitPlan {
        return this.db.transaction((tx) => this.readPlan(tx, jobId, attemptId, 'verifying'))
    }

    // 호출자는 이 전에 manifest의 이동 의도를 디스크에 기록해야 한다.
    begin(plan: DownloadCommitPlan) {
        return this.write((tx, now) => {
            this.match(plan, this.readPlan(tx, plan.jobId, plan.attemptId, 'verifying'))

            for (const target of plan.targets) {
                tx.update(s.downloadTargets)
                    .set({ finalPath: target.finalPath })
                    .where(eq(s.downloadTargets.id, target.id))
                    .run()
            }

            tx.update(s.downloadAttempts)
                .set({
                    phase: 'committing',
                    manifestPath: plan.manifestPath
                })
                .where(eq(s.downloadAttempts.id, plan.attemptId))
                .run()

            tx.update(s.downloadQueue)
                .set({ updatedAt: now })
                .where(eq(s.downloadQueue.id, plan.jobId))
                .run()
        })
    }

    // 최종 경로의 파일을 다시 검사한 main 서비스만 호출한다.
    // 이 메서드는 파일 I/O를 하지 않는다.
    complete(plan: DownloadCommitPlan, files: readonly DownloadFinalFile[]) {
        return this.write((tx, now) => {
            this.match(plan, this.readPlan(tx, plan.jobId, plan.attemptId, 'committing'))

            if (!Array.isArray(files) || files.length !== plan.targets.length) {
                fail('TARGET_INCOMPLETE')
            }

            const byId = new Map(files.map((file) => [file.targetId, file]))

            if (byId.size !== files.length) {
                fail('TARGET_DUPLICATE')
            }

            for (const target of plan.targets) {
                const before = verified(target).fileVerification
                const after = byId.get(target.id)

                if (
                    !after ||
                    after.finalPath !== target.finalPath ||
                    typeof after.realPath !== 'string' ||
                    pathKey(after.realPath) !== pathKey(target.finalPath) ||
                    after.size !== before.size ||
                    after.sha256 !== before.sha256 ||
                    after.device !== before.device ||
                    after.inode !== before.inode ||
                    after.mtimeNs !== before.mtimeNs ||
                    typeof after.ctimeNs !== 'string' ||
                    !/^-?\d+$/.test(after.ctimeNs)
                ) {
                    fail('FILE_CHANGED')
                }
            }

            const parent =
                plan.parent ??
                tx
                    .insert(s.medias)
                    .values({
                        sourceKind: 'download',
                        requestUrlId: plan.requestUrlId,
                        sourceTitle: plan.sourceTitle,
                        createdAt: now,
                        updatedAt: now
                    })
                    .returning()
                    .get()

            const coverKey = plan.oldFiles.find((file) => file.id === parent.coverFileId)?.fileKey

            if (plan.parent) {
                // 복합 FK 때문에 이전 자식을 제거하기 전에 표지를 해제한다.
                tx.update(s.medias)
                    .set({
                        coverMode: 'auto',
                        coverFileId: null
                    })
                    .where(eq(s.medias.id, parent.id))
                    .run()

                tx.delete(s.mediaFiles).where(eq(s.mediaFiles.mediaId, parent.id)).run()
            }

            const inserted = plan.targets.map((target) => {
                const metadata = verified(target)
                const final = byId.get(target.id)!

                const platform =
                    metadata.platformName == null
                        ? null
                        : (tx
                              .select()
                              .from(s.platforms)
                              .where(eq(s.platforms.name, metadata.platformName))
                              .get() ??
                          tx
                              .insert(s.platforms)
                              .values({
                                  name: metadata.platformName
                              })
                              .returning()
                              .get())

                let profileId: number | null = null

                if (platform && metadata.ownerId != null) {
                    profileId = tx
                        .insert(s.profiles)
                        .values({
                            ownerId: metadata.ownerId,
                            ownerName: metadata.ownerName,
                            platformId: platform.id,
                            updatedAt: now
                        })
                        .onConflictDoUpdate({
                            target: [s.profiles.ownerId, s.profiles.platformId],
                            set:
                                metadata.ownerName === undefined
                                    ? { updatedAt: now }
                                    : {
                                          ownerName: metadata.ownerName,
                                          updatedAt: now
                                      }
                        })
                        .returning()
                        .get().id
                }

                return tx
                    .insert(s.mediaFiles)
                    .values({
                        mediaId: parent.id,
                        fileKey: target.targetKey,
                        storageKind: 'app_managed',
                        sourceUrl: target.sourceUrl,
                        externalId: metadata.externalId,
                        platformId: platform?.id,
                        profileId,
                        title: metadata.title,
                        filepath: target.finalPath,
                        filesize: final.size,
                        mtimeNs: final.mtimeNs,
                        hashAlgorithm: 'sha256',
                        contentHash: final.sha256,
                        kind: metadata.kind,
                        position: target.position,
                        duration: metadata.duration,
                        createdAt: now
                    })
                    .returning()
                    .get()
            })

            const cover =
                parent.coverMode === 'manual'
                    ? inserted.find((file) => file.fileKey === coverKey)
                    : undefined

            tx.update(s.downloadAttempts)
                .set({
                    targetMediaId: parent.id,
                    targetMediaIdSnapshot: parent.id,
                    phase: 'finished',
                    outcome: 'completed',
                    committedAt: now,
                    finishedAt: now
                })
                .where(eq(s.downloadAttempts.id, plan.attemptId))
                .run()

            const revision = plan.parent ? parent.revision + 1 : parent.revision

            tx.update(s.medias)
                .set({
                    sourceTitle: plan.sourceTitle,
                    coverMode: cover ? 'manual' : 'auto',
                    coverFileId: cover?.id ?? null,
                    revision,
                    updatedAt: now,
                    lastDownloadCommitAttemptId: plan.attemptId
                })
                .where(eq(s.medias.id, parent.id))
                .run()

            tx.update(s.downloadQueue)
                .set({
                    targetMediaId: parent.id,
                    targetMediaIdSnapshot: parent.id,
                    state: 'completed',
                    progress: 100,
                    finishedAt: now,
                    updatedAt: now,
                    errorCode: null,
                    errorMessage: null,
                    cleanupRequired: false
                })
                .where(eq(s.downloadQueue.id, plan.jobId))
                .run()

            const enqueue = (
                kind: 'obsolete_file_cleanup' | 'search_reindex',
                payload: unknown
            ) => {
                tx.insert(s.maintenanceTasks)
                    .values({
                        id: randomUUID(),
                        kind,
                        state: 'pending',
                        ownerKind: 'download',
                        downloadAttemptId: plan.attemptId,
                        payloadJson: JSON.stringify(payload),
                        createdAt: now,
                        updatedAt: now
                    })
                    .run()
            }

            if (plan.oldFiles.length) {
                // 읽기 전용 스냅샷이다. 삭제 허가 목록이 아니다.
                enqueue('obsolete_file_cleanup', {
                    version: 1,
                    mediaId: parent.id,
                    files: plan.oldFiles
                })
            }

            enqueue('search_reindex', {
                scope: 'media',
                mediaId: parent.id
            })

            return {
                mediaId: parent.id,
                revision,
                attemptId: plan.attemptId
            }
        })
    }

    requestCancel(jobId: string, attemptId: string) {
        return this.write((tx, now) => {
            const { attempt } = this.current(tx, jobId, attemptId)

            if (attempt.phase === 'committing') {
                fail('CANNOT_CANCEL_COMMITTING')
            }

            if (!['discovering', 'downloading', 'verifying'].includes(attempt.phase)) {
                fail('INVALID_STATE')
            }

            if (attempt.cancelRequestedAt === null) {
                tx.update(s.downloadAttempts)
                    .set({ cancelRequestedAt: now })
                    .where(eq(s.downloadAttempts.id, attemptId))
                    .run()

                tx.update(s.downloadQueue)
                    .set({ updatedAt: now })
                    .where(eq(s.downloadQueue.id, jobId))
                    .run()
            }
        })
    }

    private current(tx: Tx, jobId: string, attemptId: string) {
        if (
            typeof jobId !== 'string' ||
            !jobId.trim() ||
            typeof attemptId !== 'string' ||
            !attemptId.trim()
        ) {
            fail('INVALID_ARGUMENT')
        }

        const job = tx.select().from(s.downloadQueue).where(eq(s.downloadQueue.id, jobId)).get()

        const attempt = tx
            .select()
            .from(s.downloadAttempts)
            .where(and(eq(s.downloadAttempts.id, attemptId), eq(s.downloadAttempts.jobId, jobId)))
            .get()

        if (!job || !attempt) {
            fail('NOT_FOUND')
        }

        if (job.cleanupRequired) {
            fail('CLEANUP_REQUIRED')
        }

        if (
            job.state !== 'running' ||
            job.currentAttemptId !== attemptId ||
            attempt.outcome !== null ||
            attempt.committedAt !== null ||
            job.targetMediaId !== attempt.targetMediaId
        ) {
            fail('INVALID_STATE')
        }

        return { job, attempt }
    }

    private readPlan(
        tx: Tx,
        jobId: string,
        attemptId: string,
        phase: 'verifying' | 'committing'
    ): DownloadCommitPlan {
        const { job, attempt } = this.current(tx, jobId, attemptId)

        if (attempt.phase !== phase) {
            fail('INVALID_STATE')
        }

        if (attempt.cancelRequestedAt !== null) {
            fail('CANCEL_REQUESTED')
        }

        const parent =
            tx.select().from(s.medias).where(eq(s.medias.requestUrlId, job.requestUrlId)).get() ??
            null

        if (
            job.mode === 'create'
                ? parent !== null || job.targetMediaId !== null
                : !parent || parent.id !== job.targetMediaId || parent.sourceKind !== 'download'
        ) {
            fail('INVALID_STATE')
        }

        if (
            parent &&
            (!Number.isSafeInteger(parent.revision) ||
                parent.revision < 0 ||
                parent.revision === Number.MAX_SAFE_INTEGER)
        ) {
            fail('INVARIANT_VIOLATION')
        }

        const owner = createHash('sha256')
            .update(JSON.stringify([jobId, attemptId]))
            .digest('hex')

        const base = join(this.root, '.storagebucket')
        const staging = join(base, 'staging', owner)
        const manifestPath = join(base, 'manifests', owner + '.json')

        if (
            phase === 'verifying'
                ? attempt.manifestPath !== null
                : attempt.manifestPath !== manifestPath
        ) {
            fail('VERIFICATION_CHANGED')
        }

        const rows = tx
            .select()
            .from(s.downloadTargets)
            .where(eq(s.downloadTargets.attemptId, attemptId))
            .orderBy(asc(s.downloadTargets.position), asc(s.downloadTargets.id))
            .all()

        if (!rows.length) {
            fail('TARGET_INCOMPLETE')
        }

        const targets = rows.map((row) => {
            if (row.state !== 'verified' || !row.stagedPath) {
                fail('INVALID_STATE')
            }

            within(staging, row.stagedPath)
            verified(row)

            const extension = extname(row.stagedPath).toLowerCase()

            const name =
                createHash('sha256').update(row.targetKey).digest('hex') +
                (/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin')

            const finalPath = join(base, 'files', owner, name)

            if (phase === 'verifying' ? row.finalPath !== null : row.finalPath !== finalPath) {
                fail('VERIFICATION_CHANGED')
            }

            const referenced = tx.get<{ id: number }>(
                process.platform === 'win32'
                    ? sql`
                        SELECT id FROM media_file
                        WHERE filepath = ${finalPath} COLLATE NOCASE
                        LIMIT 1
                      `
                    : sql`
                        SELECT id FROM media_file
                        WHERE filepath = ${finalPath}
                        LIMIT 1
                      `
            )

            if (referenced) {
                fail('TARGET_PATH_COLLISION')
            }

            return {
                ...row,
                stagedPath: row.stagedPath,
                finalPath
            }
        })

        const oldFiles = parent
            ? tx
                  .select()
                  .from(s.mediaFiles)
                  .where(eq(s.mediaFiles.mediaId, parent.id))
                  .orderBy(asc(s.mediaFiles.position), asc(s.mediaFiles.id))
                  .all()
            : []

        return {
            version: 1,
            jobId,
            attemptId,
            requestUrlId: job.requestUrlId,
            mode: job.mode,
            sourceTitle: job.title ?? verified(targets[0]).title ?? parent?.sourceTitle ?? null,
            parent,
            oldFiles,
            manifestPath,
            targets
        }
    }

    private match(expected: DownloadCommitPlan, current: DownloadCommitPlan) {
        if (expected.parent?.revision !== current.parent?.revision) {
            fail('REVISION_CONFLICT')
        }

        if (!isDeepStrictEqual(expected, current)) {
            fail('VERIFICATION_CHANGED')
        }
    }

    private write<T>(action: (tx: Tx, now: number) => T): T {
        return this.db.transaction(
            (tx) => {
                const now = this.clock()

                if (!Number.isSafeInteger(now) || now < 0) {
                    fail('INVARIANT_VIOLATION')
                }

                return action(tx, now)
            },
            { behavior: 'immediate' }
        )
    }
}
