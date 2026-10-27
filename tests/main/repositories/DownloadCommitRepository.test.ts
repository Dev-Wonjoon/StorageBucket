import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { MediaRepository, type V2Database } from '@features/media/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError
} from '@features/download/DownloadRepository'
import {
    DownloadCommitRepository,
    type DownloadCommitPlan,
    type DownloadFinalFile
} from '@features/download/DownloadCommitRepository'
import { downloadStagingDirectory } from '@features/download/DownloadVerificationService'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let commit: DownloadCommitRepository
let time: number

const root = resolve('fixture-storage')

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    time = 1_800_000_000_000
    repo = new DownloadRepository(db, () => time)
    commit = new DownloadCommitRepository(db, root, () => time)
})

afterEach(() => {
    if (!sqlite?.open) return

    try {
        assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
    } finally {
        sqlite.close()
    }
})

const error = (code: string) => (value: unknown) =>
    value instanceof DownloadRepositoryError && value.code === code

// 메모리 DB와 합성 검사 결과만 사용하며 실제 파일은 만들지 않는다.
function ready(replace = false) {
    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/set',
            normalizedUrl: 'https://example.invalid/set',
            normalizationVersion: 1
        })
        .returning()
        .get()

    let parent: typeof s.medias.$inferSelect | undefined

    if (replace) {
        parent = db
            .insert(s.medias)
            .values({
                sourceKind: 'download',
                requestUrlId: url.id,
                sourceTitle: 'old source',
                customTitle: 'my title',
                revision: 7,
                createdAt: 123
            })
            .returning()
            .get()

        const old = ['a', 'b'].map((key, position) =>
            db
                .insert(s.mediaFiles)
                .values({
                    mediaId: parent!.id,
                    fileKey: key,
                    kind: 'image',
                    position,
                    filepath: join(root, 'old-' + key + '.png'),
                    storageKind: position === 0 ? 'app_managed' : 'unverified_legacy',
                    thumbnailOrigin: position === 0 ? 'app_generated' : 'unverified_legacy',
                    thumbnailPath: join(root, 'old-thumb-' + key + '.png')
                })
                .returning()
                .get()
        )

        db.update(s.medias)
            .set({
                coverMode: 'manual',
                coverFileId: old[0].id
            })
            .where(eq(s.medias.id, parent.id))
            .run()

        const tag = db.insert(s.tags).values({ name: 'keep' }).returning().get()

        db.insert(s.mediaTags)
            .values({
                mediaId: parent.id,
                tagId: tag.id
            })
            .run()

        db.insert(s.favorites)
            .values({
                mediaId: parent.id,
                createdAt: 456
            })
            .run()
    }

    const job = repo.enqueue(
        parent
            ? {
                  requestUrlId: url.id,
                  originalUrl: url.url,
                  mode: 'replace',
                  mediaId: parent.id,
                  expectedRevision: parent.revision
              }
            : {
                  requestUrlId: url.id,
                  originalUrl: url.url,
                  mode: 'create'
              }
    )

    const { attempt } = repo.startAttempt(job.id, 'manual_initial')

    repo.freezeTargets(
        job.id,
        attempt.id,
        ['a', 'b'].map((targetKey) => ({
            targetKey,
            sourceUrl: url.url + '/' + targetKey,
            metadata: {
                kind: 'image',
                title: 'new ' + targetKey,
                platformName: 'fixture',
                ownerId: 'owner',
                ownerName: 'owner name'
            }
        }))
    )

    const staging = downloadStagingDirectory(root, job.id, attempt.id)

    repo.recordResults(
        job.id,
        attempt.id,
        ['a', 'b'].map((targetKey) => ({
            targetKey,
            stagedPath: join(staging, targetKey + '.png')
        }))
    )

    const snapshot = repo.verificationSnapshot(job.id, attempt.id)

    repo.markVerified(
        snapshot,
        snapshot.targets.map((target, index) => ({
            targetId: target.id,
            stagedPath: target.stagedPath,
            realPath: target.stagedPath,
            size: 3,
            device: '1',
            inode: String(index + 1),
            mtimeNs: '100',
            ctimeNs: '101',
            sha256: (index === 0 ? 'a' : 'b').repeat(64)
        }))
    )

    return {
        jobId: job.id,
        attemptId: attempt.id,
        parentId: parent?.id
    }
}

function finals(plan: DownloadCommitPlan): DownloadFinalFile[] {
    return plan.targets.map((target) => {
        const {
            stagedPath: _stagedPath,
            version: _version,
            ...proof
        } = JSON.parse(target.metadataJson).fileVerification

        return {
            ...proof,
            finalPath: target.finalPath,
            realPath: target.finalPath,
            ctimeNs: '102'
        }
    })
}

function attempt(id: string) {
    return db.select().from(s.downloadAttempts).where(eq(s.downloadAttempts.id, id)).get()!
}

function planFor(value: ReturnType<typeof ready>) {
    return commit.prepare(value.jobId, value.attemptId)
}

function assertUncommitted(plan: DownloadCommitPlan) {
    assert.equal(repo.get(plan.jobId)!.state, 'running')
    assert.equal(attempt(plan.attemptId).phase, 'committing')
    assert.equal(attempt(plan.attemptId).committedAt, null)
    assert.equal(db.select().from(s.maintenanceTasks).all().length, 0)
}

describe('DownloadCommitRepository', () => {
    it('계획 조회는 상태를 바꾸지 않고 시도별 경로와 모든 대상을 확정한다', () => {
        const value = ready()
        const plan = planFor(value)

        assert.deepEqual(planFor(value), plan)
        assert.equal(plan.targets.length, 2)
        assert.equal(plan.sourceTitle, 'new a')
        assert.equal(plan.parent, null)
        assert.equal(attempt(value.attemptId).phase, 'verifying')
        assert.equal(attempt(value.attemptId).manifestPath, null)

        assert.ok(
            repo
                .listTargets(value.jobId, value.attemptId)
                .data.every((row) => row.finalPath === null)
        )

        assert.equal(new Set(plan.targets.map((row) => row.finalPath)).size, 2)

        assert.ok(plan.targets.every((row) => row.finalPath.endsWith('.png')))
    })

    it('전부 검증되기 전에는 저장 계획을 만들지 않는다', () => {
        const value = ready()
        const target = repo.listTargets(value.jobId, value.attemptId).data[1]

        db.update(s.downloadTargets)
            .set({ state: 'downloaded' })
            .where(eq(s.downloadTargets.id, target.id))
            .run()

        assert.throws(() => planFor(value), error('INVALID_STATE'))
    })

    it('검증 후 파일 식별 증명이 바뀌면 계획을 거절한다', () => {
        const value = ready()
        const target = repo.listTargets(value.jobId, value.attemptId).data[0]

        db.update(s.downloadTargets)
            .set({ metadataJson: '{"kind":"image"}' })
            .where(eq(s.downloadTargets.id, target.id))
            .run()

        assert.throws(() => planFor(value), error('VERIFICATION_CHANGED'))
    })

    it('manifest 경로나 대상 스냅샷을 바꾼 계획은 진입하지 못한다', () => {
        const value = ready()
        const plan = planFor(value)

        assert.throws(
            () =>
                commit.begin({
                    ...plan,
                    manifestPath: join(root, 'other.json')
                }),
            error('VERIFICATION_CHANGED')
        )

        const changed = structuredClone(plan)
        changed.targets[0].sourceUrl += '/changed'

        assert.throws(() => commit.begin(changed), error('VERIFICATION_CHANGED'))

        assert.equal(attempt(value.attemptId).phase, 'verifying')
    })

    it('계획 조회 뒤 사용자 편집이 있으면 최신 revision으로 다시 조회해야 한다', () => {
        const value = ready(true)
        const plan = planFor(value)

        db.update(s.medias)
            .set({
                customTitle: 'edited',
                revision: 8
            })
            .where(eq(s.medias.id, value.parentId!))
            .run()

        assert.throws(() => commit.begin(plan), error('REVISION_CONFLICT'))

        const fresh = planFor(value)

        commit.begin(fresh)
        commit.complete(fresh, finals(fresh))

        assert.equal(db.select().from(s.medias).get()!.customTitle, 'edited')
    })

    it('취소가 먼저 수락되면 시각이 0이어도 커밋에 들어가지 않는다', () => {
        const value = ready()
        const plan = planFor(value)

        time = 0
        commit.requestCancel(value.jobId, value.attemptId)

        assert.equal(attempt(value.attemptId).cancelRequestedAt, 0)

        assert.throws(() => commit.begin(plan), error('CANCEL_REQUESTED'))
    })

    it('committing 진입이 먼저면 취소를 거절하고 완료를 뒤집지 않는다', () => {
        const value = ready()
        const plan = planFor(value)

        commit.begin(plan)

        assert.throws(
            () => commit.requestCancel(value.jobId, value.attemptId),
            error('CANNOT_CANCEL_COMMITTING')
        )

        assert.equal(attempt(value.attemptId).cancelRequestedAt, null)

        commit.complete(plan, finals(plan))

        assert.equal(repo.get(value.jobId)!.state, 'completed')
    })

    it('진입 중 마지막 대상 갱신이 실패하면 경로와 단계도 모두 롤백한다', () => {
        const value = ready()
        const plan = planFor(value)

        sqlite.exec(`
            CREATE TRIGGER fail_plan
            BEFORE UPDATE OF final_path ON download_target
            WHEN OLD.position = 1
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        assert.throws(() => commit.begin(plan))

        assert.equal(attempt(value.attemptId).phase, 'verifying')
        assert.equal(attempt(value.attemptId).manifestPath, null)

        assert.ok(
            repo
                .listTargets(value.jobId, value.attemptId)
                .data.every((row) => row.finalPath === null)
        )
    })

    it('필수 파일 누락과 중복은 일부 등록 없이 거절한다', () => {
        const plan = planFor(ready())

        commit.begin(plan)

        const files = finals(plan)

        assert.throws(() => commit.complete(plan, files.slice(0, 1)), error('TARGET_INCOMPLETE'))

        assert.throws(() => commit.complete(plan, [files[0], files[0]]), error('TARGET_DUPLICATE'))

        assertUncommitted(plan)

        assert.equal(db.select().from(s.medias).all().length, 0)
    })

    it('이동 후 내용·경로·파일 식별자가 달라지면 완료하지 않는다', () => {
        const plan = planFor(ready())

        commit.begin(plan)

        for (const change of [
            { sha256: 'c'.repeat(64) },
            { size: 4 },
            { inode: '99' },
            { finalPath: join(root, 'unexpected.png') },
            { mtimeNs: '999' }
        ]) {
            const files = finals(plan)

            Object.assign(files[0], change)

            assert.throws(() => commit.complete(plan, files), error('FILE_CHANGED'))
        }

        assertUncommitted(plan)
    })

    it('신규 부모·전체 자식·커밋 표식·완료·검색 유지보수를 함께 반영한다', () => {
        const value = ready()
        const plan = planFor(value)

        commit.begin(plan)

        const result = commit.complete(plan, finals(plan))
        const parent = db.select().from(s.medias).get()!
        const files = db.select().from(s.mediaFiles).all()

        assert.equal(parent.id, result.mediaId)
        assert.equal(parent.revision, 0)

        assert.equal(parent.lastDownloadCommitAttemptId, value.attemptId)

        assert.deepEqual(
            files.map((file) => file.fileKey),
            ['a', 'b']
        )

        assert.ok(
            files.every(
                (file) =>
                    file.storageKind === 'app_managed' &&
                    file.filesize === 3 &&
                    file.hashAlgorithm === 'sha256' &&
                    file.thumbnailOrigin === 'none'
            )
        )

        assert.equal(files[0].contentHash, 'a'.repeat(64))
        assert.equal(db.select().from(s.profiles).all().length, 1)

        assert.equal(attempt(value.attemptId).targetMediaId, parent.id)

        assert.equal(attempt(value.attemptId).outcome, 'completed')

        assert.equal(attempt(value.attemptId).committedAt, time)

        assert.equal(repo.get(value.jobId)!.progress, 100)

        const tasks = db.select().from(s.maintenanceTasks).all()

        assert.equal(tasks.length, 1)
        assert.equal(tasks[0].kind, 'search_reindex')
        assert.equal(tasks[0].downloadAttemptId, value.attemptId)
    })

    it('재다운로드는 부모 ID·제목·태그·즐겨찾기를 보존하고 같은 키의 표지를 연결한다', () => {
        const value = ready(true)
        const plan = planFor(value)
        const oldCover = plan.parent!.coverFileId

        commit.begin(plan)

        const result = commit.complete(plan, finals(plan))
        const parent = db.select().from(s.medias).get()!

        assert.equal(result.mediaId, value.parentId)
        assert.equal(parent.customTitle, 'my title')
        assert.equal(parent.sourceTitle, 'new a')
        assert.equal(parent.createdAt, 123)
        assert.equal(parent.revision, 8)
        assert.equal(parent.coverMode, 'manual')
        assert.notEqual(parent.coverFileId, oldCover)

        const cover = db
            .select()
            .from(s.mediaFiles)
            .where(eq(s.mediaFiles.id, parent.coverFileId!))
            .get()!

        assert.equal(cover.fileKey, 'a')
        assert.equal(db.select().from(s.mediaTags).all().length, 1)

        assert.equal(db.select().from(s.favorites).get()!.createdAt, 456)

        const task = db
            .select()
            .from(s.maintenanceTasks)
            .all()
            .find((row) => row.kind === 'obsolete_file_cleanup')!

        const payload = JSON.parse(task.payloadJson)

        assert.deepEqual(payload.files, plan.oldFiles)
        assert.equal(payload.files[1].storageKind, 'unverified_legacy')
        assert.equal(payload.files[1].thumbnailOrigin, 'unverified_legacy')
    })

    it('이전 수동 표지의 키가 사라지면 자동 표지로 돌아간다', () => {
        const value = ready(true)

        db.update(s.mediaFiles)
            .set({ fileKey: 'removed' })
            .where(eq(s.mediaFiles.position, 0))
            .run()

        const plan = planFor(value)

        commit.begin(plan)
        commit.complete(plan, finals(plan))

        const parent = db.select().from(s.medias).get()!

        assert.equal(parent.coverMode, 'auto')
        assert.equal(parent.coverFileId, null)
    })

    it('committing 중 메타데이터 편집은 기존 MediaRepository에서도 거절한다', () => {
        const value = ready(true)
        const plan = planFor(value)

        commit.begin(plan)

        assert.throws(
            () =>
                new MediaRepository(db).edit(value.parentId!, 7, {
                    customTitle: 'cannot edit'
                }),
            /JOB_ACTIVE/
        )
    })

    it('커밋 직전 revision이 달라져도 이전 자식을 보존한다', () => {
        const value = ready(true)
        const plan = planFor(value)

        commit.begin(plan)

        db.update(s.medias).set({ revision: 8 }).where(eq(s.medias.id, value.parentId!)).run()

        assert.throws(() => commit.complete(plan, finals(plan)), error('REVISION_CONFLICT'))

        assert.deepEqual(db.select().from(s.mediaFiles).all(), plan.oldFiles)

        assertUncommitted(plan)
    })

    it('마지막 자식 삽입 실패는 이전 표지·자식·프로필·완료를 함께 롤백한다', () => {
        const value = ready(true)
        const plan = planFor(value)

        commit.begin(plan)

        sqlite.exec(`
            CREATE TRIGGER fail_file
            BEFORE INSERT ON media_file
            WHEN NEW.position = 1
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        assert.throws(() => commit.complete(plan, finals(plan)))

        assert.deepEqual(db.select().from(s.medias).get(), plan.parent)

        assert.deepEqual(db.select().from(s.mediaFiles).all(), plan.oldFiles)

        assert.equal(db.select().from(s.profiles).all().length, 0)

        assertUncommitted(plan)
    })

    it('유지보수 예약 기록까지 실패하면 완료와 신규 부모도 함께 롤백한다', () => {
        const plan = planFor(ready())

        commit.begin(plan)

        sqlite.exec(`
            CREATE TRIGGER fail_task
            BEFORE INSERT ON maintenance_task
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        assert.throws(() => commit.complete(plan, finals(plan)))

        assert.equal(db.select().from(s.medias).all().length, 0)

        assert.equal(db.select().from(s.mediaFiles).all().length, 0)

        assertUncommitted(plan)
    })

    it('완료 뒤 인덱스 실행 실패는 완료를 유지하며 재커밋은 거절한다', () => {
        const value = ready()
        const plan = planFor(value)

        commit.begin(plan)
        commit.complete(plan, finals(plan))

        db.update(s.maintenanceTasks)
            .set({
                state: 'failed',
                lastError: 'fixture'
            })
            .run()

        assert.equal(repo.get(value.jobId)!.state, 'completed')

        assert.throws(() => commit.complete(plan, finals(plan)), error('INVALID_STATE'))

        assert.equal(db.select().from(s.mediaFiles).all().length, 2)
    })

    it('YouTube 커밋 시 영구 썸네일 작업을 함께 등록한다', () => {
        const videoId = 'jNQXAC9IVRw'
        const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`
        const targetKey = `youtube:${videoId}`

        const requestUrl = db
            .insert(s.downloadUrls)
            .values({
                url: sourceUrl,
                normalizedUrl: sourceUrl,
                normalizationVersion: 1
            })
            .returning()
            .get()

        const job = repo.enqueue({
            requestUrlId: requestUrl.id,
            originalUrl: sourceUrl,
            mode: 'create'
        })

        const { attempt: currentAttempt } = repo.startAttempt(job.id, 'manual_initial')

        repo.freezeTargets(job.id, currentAttempt.id, [
            {
                targetKey,
                sourceUrl,
                metadata: {
                    kind: 'video',
                    externalId: videoId,
                    platformName: 'Youtube'
                }
            }
        ])

        const staging = downloadStagingDirectory(root, job.id, currentAttempt.id)

        repo.recordResults(job.id, currentAttempt.id, [
            {
                targetKey,
                stagedPath: join(staging, 'video.mp4')
            }
        ])

        const snapshot = repo.verificationSnapshot(job.id, currentAttempt.id)

        repo.markVerified(
            snapshot,
            snapshot.targets.map((target) => ({
                targetId: target.id,
                stagedPath: target.stagedPath,
                realPath: target.stagedPath,
                size: 3,
                device: '1',
                inode: '1',
                mtimeNs: '100',
                ctimeNs: '101',
                sha256: 'a'.repeat(64)
            }))
        )

        const plan = commit.prepare(job.id, currentAttempt.id)

        commit.begin(plan)
        const result = commit.complete(plan, finals(plan))

        const file = db
            .select()
            .from(s.mediaFiles)
            .where(eq(s.mediaFiles.mediaId, result.mediaId))
            .get()!

        const tasks = db
            .select()
            .from(s.maintenanceTasks)
            .all()
            .filter((task) => task.kind === 'preview_generation')

        assert.equal(tasks.length, 1)
        assert.equal(tasks[0].state, 'pending')
        assert.equal(tasks[0].ownerKind, 'download')
        assert.equal(tasks[0].downloadAttemptId, currentAttempt.id)

        assert.deepEqual(JSON.parse(tasks[0].payloadJson), {
            version: 1,
            purpose: 'download_thumbnail',
            mediaId: result.mediaId,
            fileId: file.id,
            fileKey: targetKey,
            contentHash: 'a'.repeat(64),
            transformVersion: 'jpeg-v1'
        })

        assert.equal(repo.get(job.id)!.state, 'completed')
    })
})
