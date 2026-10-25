import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import type { V2Database } from '../../../src/main/repositories/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError,
    parseDownloadJobOptions
} from '../../../src/main/repositories/DownloadRepository'
import { DownloadCommitRepository } from '../../../src/main/repositories/DownloadCommitRepository'
import { DownloadRecoveryRepository } from '../../../src/main/repositories/DownloadRecoveryRepository'
import { DownloadRunner, type DownloadRunnerPorts } from '../../../src/main/services/DownloadRunner'
import type { FrozenDownloadAdapter } from '../../../src/main/services/DownloadAdapter'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let commit: DownloadCommitRepository
let recovery: DownloadRecoveryRepository
let ports: DownloadRunnerPorts
let runner: DownloadRunner
let root: string
let testNumber = 0
let serial: number
let events: string[]

let discovered: {
    targetKey: string
    sourceUrl: string
    metadata: {
        kind: 'image'
        title: string
    }
}[]

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
    root = resolve('fixture-runner', String(++testNumber))
    serial = 0
    events = []

    repo = new DownloadRepository(db)
    commit = new DownloadCommitRepository(db, root)
    recovery = new DownloadRecoveryRepository(db, root)

    discovered = ['a', 'b'].map((targetKey) => ({
        targetKey,
        sourceUrl: 'https://example.invalid/item/' + targetKey,
        metadata: {
            kind: 'image',
            title: 'frozen ' + targetKey
        }
    }))

    const adapter: FrozenDownloadAdapter = {
        async discover() {
            events.push('discover')
            return discovered
        },

        async downloadFrozen(input) {
            events.push('download')

            assert.equal(Object.isFrozen(input.targets), true)
            assert.equal(Object.isFrozen(input.targets[0].metadata), true)

            return input.targets.map((target) => ({
                targetKey: target.targetKey,
                stagedPath: join(input.stagingDirectory, target.targetKey + '.bin')
            }))
        }
    }

    ports = {
        repository: repo,
        commits: commit,
        recovery,
        workspace: {
            async prepare() {
                events.push('prepare')
            }
        },
        selectAdapter: () => adapter,

        verification: {
            async verify(jobId, attemptId) {
                events.push('verify')

                const snapshot = repo.verificationSnapshot(jobId, attemptId)

                return repo.markVerified(
                    snapshot,
                    snapshot.targets.map((target, index) => ({
                        targetId: target.id,
                        stagedPath: target.stagedPath,
                        realPath: target.stagedPath,
                        size: 3,
                        mtimeNs: '1',
                        ctimeNs: '2',
                        device: '1',
                        inode: String(index + 1),
                        sha256: 'a'.repeat(64)
                    }))
                )
            }
        },

        storage: {
            async finalize(jobId, attemptId) {
                events.push('store')

                const plan = commit.prepare(jobId, attemptId)
                commit.begin(plan)

                const result = commit.complete(
                    plan,
                    plan.targets.map((target) => ({
                        ...JSON.parse(target.metadataJson).fileVerification,
                        finalPath: target.finalPath,
                        realPath: target.finalPath
                    }))
                )

                return {
                    ...result,
                    manifestFinalized: true
                }
            }
        }
    }

    runner = new DownloadRunner(ports, root)
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

function queued(replace = false) {
    const url = 'https://example.invalid/' + ++serial

    const request = db
        .insert(s.downloadUrls)
        .values({
            url,
            normalizedUrl: url,
            normalizationVersion: 1
        })
        .returning()
        .get()

    const parent = replace
        ? db
              .insert(s.medias)
              .values({
                  sourceKind: 'download',
                  requestUrlId: request.id,
                  customTitle: 'keep title'
              })
              .returning()
              .get()
        : undefined

    if (parent) {
        db.insert(s.mediaFiles)
            .values({
                mediaId: parent.id,
                fileKey: 'old',
                kind: 'image',
                position: 0,
                storageKind: 'unverified_legacy',
                filepath: join(root, 'old.png')
            })
            .run()
    }

    return repo.enqueue(
        parent
            ? {
                  requestUrlId: request.id,
                  originalUrl: url,
                  mode: 'replace',
                  mediaId: parent.id,
                  expectedRevision: parent.revision
              }
            : {
                  requestUrlId: request.id,
                  originalUrl: url,
                  mode: 'create'
              }
    )
}

function attempt(jobId: string) {
    return db
        .select()
        .from(s.downloadAttempts)
        .where(eq(s.downloadAttempts.id, repo.get(jobId)!.currentAttemptId!))
        .get()!
}

function tasks() {
    return db.select().from(s.maintenanceTasks).all()
}

describe('DownloadRunner', () => {
    it('준비·발견·고정 실행·검증·저장 후 DB 완료를 기준으로 성공한다', async () => {
        const job = queued()
        const result = await runner.run(job.id, 'manual_initial')

        assert.equal(result.status, 'committed')
        assert.deepEqual(events, ['prepare', 'discover', 'download', 'verify', 'store'])
        assert.equal(repo.get(job.id)!.state, 'completed')
        assert.equal(db.select().from(s.mediaFiles).all().length, 2)
    })

    it('지원 어댑터가 없으면 외부 요청 없이 실패와 정리 필요를 기록한다', async () => {
        const job = queued()
        ports.selectAdapter = () => undefined

        assert.equal((await runner.run(job.id, 'manual_initial')).status, 'cleanup_required')
        assert.deepEqual(events, [])
        assert.equal(repo.get(job.id)!.state, 'failed')
        assert.equal(repo.get(job.id)!.errorCode, 'UNSUPPORTED_TARGET_DISCOVERY')
        assert.equal(tasks()[0].kind, 'rollback_cleanup')
    })

    it('workspace 준비 실패 후에는 발견 요청을 하지 않는다', async () => {
        const job = queued()

        ports.workspace.prepare = async () => {
            throw Error('private path')
        }

        await runner.run(job.id, 'manual_initial')

        assert.deepEqual(events, [])
        assert.equal(repo.get(job.id)!.errorCode, 'FILE_IO_ERROR')
    })

    it('빈 발견 목록과 중복 키를 성공으로 처리하지 않는다', async () => {
        const first = queued()
        discovered = []

        await runner.run(first.id, 'manual_initial')

        assert.equal(repo.get(first.id)!.errorCode, 'TARGET_DISCOVERY_EMPTY')

        const second = queued()
        const item = {
            targetKey: 'a',
            sourceUrl: 'https://example.invalid/a',
            metadata: {
                kind: 'image' as const,
                title: 'a'
            }
        }

        discovered = [item, item]

        await runner.run(second.id, 'manual_initial')

        assert.equal(repo.get(second.id)!.errorCode, 'TARGET_DUPLICATE')
        assert.ok(!events.includes('download'))
    })

    it('대상이 200개를 넘더라도 DB 페이지 전체를 고정해 실행한다', async () => {
        const job = queued()

        discovered = Array.from({ length: 205 }, (_, index) => ({
            targetKey: String(index),
            sourceUrl: 'https://example.invalid/' + index,
            metadata: {
                kind: 'image',
                title: String(index)
            }
        }))

        let count = 0
        const adapter = ports.selectAdapter(job.originalUrl, {})!
        const original = adapter.downloadFrozen

        adapter.downloadFrozen = async (input) => {
            count = input.targets.length
            assert.equal(input.targets[204].position, 204)
            return original(input)
        }

        assert.equal((await runner.run(job.id, 'manual_initial')).status, 'committed')
        assert.equal(count, 205)
        assert.equal(db.select().from(s.mediaFiles).all().length, 205)
    })

    it('엔진에 전달하는 대상은 발견 배열 대신 DB에서 다시 읽은 값이다', async () => {
        const job = queued()
        const adapter = ports.selectAdapter(job.originalUrl, {})!

        adapter.downloadFrozen = async (input) => {
            discovered[0].metadata.title = 'mutated'

            assert.equal(input.targets[0].metadata.title, 'frozen a')
            assert.equal('originalUrl' in input, false)

            return input.targets.map((target) => ({
                targetKey: target.targetKey,
                stagedPath: join(input.stagingDirectory, target.targetKey + '.bin')
            }))
        }

        await runner.run(job.id, 'manual_initial')

        assert.equal(db.select().from(s.mediaFiles).get()!.title, 'frozen a')
    })

    it('필수 결과가 누락되면 검증·저장을 호출하지 않고 이전 등록을 보존한다', async () => {
        const job = queued(true)
        const before = db.select().from(s.mediaFiles).all()
        const adapter = ports.selectAdapter(job.originalUrl, {})!

        adapter.downloadFrozen = async (input) => [
            {
                targetKey: input.targets[0].targetKey,
                stagedPath: join(input.stagingDirectory, 'a.bin')
            }
        ]

        await runner.run(job.id, 'manual_initial')

        assert.equal(repo.get(job.id)!.errorCode, 'TARGET_INCOMPLETE')
        assert.ok(!events.includes('verify'))
        assert.ok(!events.includes('store'))
        assert.deepEqual(db.select().from(s.mediaFiles).all(), before)
    })

    it('엔진 예외의 원문을 DB 오류 메시지에 저장하지 않는다', async () => {
        const job = queued()

        ports.selectAdapter(job.originalUrl, {})!.discover = async () => {
            throw Error('secret cookie detail')
        }

        await runner.run(job.id, 'manual_initial')

        assert.equal(repo.get(job.id)!.state, 'failed')
        assert.equal(repo.get(job.id)!.errorCode, 'DOWNLOAD_ENGINE_FAILED')
        assert.equal(repo.get(job.id)!.errorMessage, null)
    })

    it('파일 검증 실패는 저장을 실행하지 않고 이전 부모·자식을 보존한다', async () => {
        const job = queued(true)
        const before = db.select().from(s.mediaFiles).all()

        ports.verification.verify = async () => {
            throw new DownloadRepositoryError('FILE_CHANGED')
        }

        await runner.run(job.id, 'manual_initial')

        assert.equal(repo.get(job.id)!.state, 'failed')
        assert.equal(repo.get(job.id)!.errorCode, 'FILE_CHANGED')
        assert.ok(!events.includes('store'))
        assert.deepEqual(db.select().from(s.mediaFiles).all(), before)
    })

    it('취소 기록이 실패하면 엔진을 중지하되 취소 수락으로 보고하지 않는다', async () => {
        const job = queued()
        let entered!: () => void
        let release!: () => void

        const waiting = new Promise<void>((resolve) => {
            entered = resolve
        })
        const exit = new Promise<void>((resolve) => {
            release = resolve
        })

        let signal!: AbortSignal

        ports.selectAdapter(job.originalUrl, {})!.discover = async (input) => {
            signal = input.signal
            entered()
            await exit
            throw Error('engine stopped')
        }

        ports.commits = {
            requestCancel() {
                throw new DownloadRepositoryError('DATABASE_ERROR')
            }
        }

        const running = runner.run(job.id, 'manual_initial')

        await waiting

        try {
            assert.throws(() => runner.cancel(job.id), error('DATABASE_ERROR'))
            assert.equal(signal.aborted, true)
            assert.equal(attempt(job.id).cancelRequestedAt, null)
        } finally {
            release()
        }

        await running

        assert.equal(repo.get(job.id)!.state, 'failed')

        const next = queued()

        assert.equal((await runner.run(next.id, 'manual_initial')).status, 'blocked')
    })

    it('취소 수락 뒤에도 엔진 Promise가 종료되기 전에는 시도를 끝내지 않는다', async () => {
        const job = queued()
        let entered!: () => void
        let release!: () => void

        const waiting = new Promise<void>((resolve) => {
            entered = resolve
        })
        const exit = new Promise<void>((resolve) => {
            release = resolve
        })

        let signal!: AbortSignal

        ports.selectAdapter(job.originalUrl, {})!.discover = async (input) => {
            signal = input.signal
            entered()
            await exit
            throw Error('engine exited')
        }

        const running = runner.run(job.id, 'manual_initial')

        await waiting
        runner.cancel(job.id)

        assert.equal(signal.aborted, true)
        assert.equal(repo.get(job.id)!.state, 'running')
        assert.equal(attempt(job.id).outcome, null)
        assert.equal(tasks().length, 0)

        release()

        assert.equal((await running).status, 'cleanup_required')
        assert.equal(repo.get(job.id)!.state, 'cancelled')
        assert.equal(attempt(job.id).outcome, 'cancelled')
    })

    it('committing 진입 뒤에는 취소를 거절하고 완료를 유지한다', async () => {
        const job = queued()
        let entered!: () => void
        let release!: () => void

        const waiting = new Promise<void>((resolve) => {
            entered = resolve
        })
        const wait = new Promise<void>((resolve) => {
            release = resolve
        })

        ports.storage.finalize = async (jobId, attemptId) => {
            const plan = commit.prepare(jobId, attemptId)
            commit.begin(plan)

            entered()
            await wait

            const result = commit.complete(
                plan,
                plan.targets.map((target) => ({
                    ...JSON.parse(target.metadataJson).fileVerification,
                    finalPath: target.finalPath,
                    realPath: target.finalPath
                }))
            )

            return {
                ...result,
                manifestFinalized: true
            }
        }

        const running = runner.run(job.id, 'manual_initial')

        await waiting

        try {
            assert.throws(() => runner.cancel(job.id), error('CANNOT_CANCEL_COMMITTING'))
        } finally {
            release()
        }

        assert.equal((await running).status, 'committed')
    })

    it('동일 저장소의 다른 Runner도 동시에 작업을 실행하지 않는다', async () => {
        const first = queued()
        const second = queued()
        let entered!: () => void
        let release!: () => void

        const waiting = new Promise<void>((resolve) => {
            entered = resolve
        })
        const wait = new Promise<void>((resolve) => {
            release = resolve
        })

        const adapter = ports.selectAdapter(first.originalUrl, {})!
        const original = adapter.discover

        adapter.discover = async (input) => {
            entered()
            await wait
            return original(input)
        }

        const running = runner.run(first.id, 'manual_initial')

        await waiting

        try {
            await assert.rejects(
                new DownloadRunner(ports, root).run(second.id, 'manual_initial'),
                error('ALREADY_PROCESSING')
            )
        } finally {
            release()
        }

        await running

        assert.equal(repo.get(second.id)!.state, 'pending')
    })

    it('DB 커밋 뒤 응답 유실은 DB를 다시 읽어 완료로 판정한다', async () => {
        const job = queued()
        const original = ports.storage.finalize

        ports.storage.finalize = async (...args) => {
            await original(...args)
            throw new DownloadRepositoryError('COMMIT_STATE_UNKNOWN')
        }

        assert.equal((await runner.run(job.id, 'manual_initial')).status, 'committed')
        assert.ok(tasks().every((task) => task.kind !== 'rollback_cleanup'))
    })

    it('저장 함수가 반환해도 DB 미반영이면 완료로 보고하지 않는다', async () => {
        const job = queued()

        ports.storage.finalize = async (_jobId, attemptId) => ({
            mediaId: 99,
            revision: 0,
            attemptId,
            manifestFinalized: true
        })

        assert.equal((await runner.run(job.id, 'manual_initial')).status, 'cleanup_required')
        assert.equal(repo.get(job.id)!.state, 'failed')
        assert.equal(repo.get(job.id)!.errorCode, 'INVARIANT_VIOLATION')
    })

    it('실패 종료 트랜잭션이 실패하면 보류하고 다음 작업을 실행하지 않는다', async () => {
        const job = queued()
        const next = queued()

        ports.selectAdapter = () => undefined

        sqlite.exec(`
            CREATE TRIGGER fail_finish
            BEFORE INSERT ON maintenance_task
            WHEN NEW.kind = 'rollback_cleanup'
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        assert.equal((await runner.run(job.id, 'manual_initial')).status, 'blocked')
        assert.equal(repo.get(job.id)!.state, 'running')
        assert.equal(attempt(job.id).outcome, null)

        assert.equal(
            (await new DownloadRunner(ports, root).run(next.id, 'manual_initial')).status,
            'blocked'
        )
        assert.equal(repo.get(next.id)!.currentAttemptId, null)
    })

    it('시작 응답이 유실돼 attempt ID를 받지 못해도 자동 재시작하지 않는다', async () => {
        const job = queued()
        const original = repo.startAttempt.bind(repo)

        ports.repository = {
            ...ports.repository,

            startAttempt(...args: Parameters<DownloadRepository['startAttempt']>) {
                original(...args)
                throw Error('lost response')
            },

            freezeTargets: repo.freezeTargets.bind(repo),
            listTargets: repo.listTargets.bind(repo),
            recordResults: repo.recordResults.bind(repo)
        }

        assert.equal((await runner.run(job.id, 'manual_initial')).status, 'blocked')
        assert.equal(repo.get(job.id)!.state, 'running')
        assert.equal(db.select().from(s.downloadAttempts).all().length, 1)
    })

    it('오래된 attempt 종료 요청은 새 시도에 적용하지 않는다', () => {
        const job = queued()

        const { attempt: first } = repo.startAttempt(job.id, 'manual_initial')

        const result = recovery.finishAfterEngineExit(job.id, first.id, 'DOWNLOAD_ENGINE_FAILED')

        assert.equal(result.status, 'cleanup_required')

        const task = tasks()[0]

        db.update(s.maintenanceTasks)
            .set({ state: 'completed' })
            .where(eq(s.maintenanceTasks.id, task.id))
            .run()

        db.update(s.downloadQueue)
            .set({ cleanupRequired: false })
            .where(eq(s.downloadQueue.id, job.id))
            .run()

        const { attempt: next } = repo.startAttempt(job.id, 'manual_retry')

        assert.equal(
            recovery.finishAfterEngineExit(job.id, first.id, 'DOWNLOAD_ENGINE_FAILED').status,
            'blocked'
        )
        assert.equal(attempt(job.id).id, next.id)
        assert.equal(attempt(job.id).outcome, null)
    })

    it('저장된 옵션의 허용 필드와 값만 해석한다', () => {
        assert.deepEqual(parseDownloadJobOptions('{"quality":"720","playlist":true}'), {
            quality: '720',
            playlist: true
        })

        for (const value of [
            'null',
            '[]',
            'bad json',
            '{"excludeIds":["a"]}',
            '{"quality":"invalid"}'
        ]) {
            assert.throws(() => parseDownloadJobOptions(value), error('INVALID_ARGUMENT'))
        }
    })
})
