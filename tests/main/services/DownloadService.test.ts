import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import type { V2Database } from '../../../src/main/repositories/MediaRepository'
import {
    DownloadRepository,
    DownloadRepositoryError
} from '../../../src/main/repositories/DownloadRepository'
import { DownloadCommitRepository } from '../../../src/main/repositories/DownloadCommitRepository'
import { DownloadRecoveryRepository } from '../../../src/main/repositories/DownloadRecoveryRepository'
import { DownloadRunner, type DownloadRunnerPorts } from '../../../src/main/services/DownloadRunner'
import { DownloadService } from '../../../src/main/services/DownloadService'
import type { DownloadResponse } from '../../../src/shared/download-api'
import { downloadStorageSql } from '../../../src/database/migrate'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let service: DownloadService

let run: ReturnType<typeof vi.fn<DownloadRunner['run']>>

let cancel: ReturnType<typeof vi.fn<DownloadRunner['cancel']>>

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards, ...downloadStorageSql]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })

    run = vi.fn<DownloadRunner['run']>(async (jobId) => ({
        status: 'blocked',
        jobId,
        reason: 'ENGINE_STATE_UNKNOWN'
    }))

    cancel = vi.fn<DownloadRunner['cancel']>()

    service = new DownloadService(db, { run, cancel }, () => resolve('service-fixture'))
})

afterEach(() => {
    if (!sqlite?.open) return

    try {
        assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
    } finally {
        sqlite.close()
    }
})

function data<T>(result: DownloadResponse<T>): T {
    assert.ok(result.ok)
    return result.data
}

function failure(result: DownloadResponse<unknown>, expected: string) {
    assert.equal(result.ok, false)

    if (result.ok) {
        throw new Error('Expected failure')
    }

    assert.equal(result.error.code, expected)

    return result.error
}

function enqueue(url = 'https://example.invalid/post') {
    return service.enqueue({
        mode: 'create',
        url
    })
}

// Runner와 DB는 실제 구현을 사용한다.
// 파일·엔진 작업만 대역으로 처리한다.
function realRunner() {
    const root = resolve('service-fixture', randomUUID())

    const repository = new DownloadRepository(db)
    const commits = new DownloadCommitRepository(db, root)
    const recovery = new DownloadRecoveryRepository(db, root)

    const ports: DownloadRunnerPorts = {
        repository,
        commits,
        recovery,

        workspace: {
            prepare: async () => {}
        },

        selectAdapter: () => ({
            discover: async () =>
                ['a', 'b'].map((targetKey) => ({
                    targetKey,
                    sourceUrl: 'https://example.invalid/file/' + targetKey,
                    metadata: {
                        kind: 'image' as const,
                        title: targetKey
                    }
                })),

            downloadFrozen: async (input) =>
                input.targets.map((target) => ({
                    targetKey: target.targetKey,
                    stagedPath: join(input.stagingDirectory, target.targetKey + '.png')
                }))
        }),

        verification: {
            async verify(jobId, attemptId) {
                const snapshot = repository.verificationSnapshot(jobId, attemptId)

                return repository.markVerified(
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
                const plan = commits.prepare(jobId, attemptId)

                commits.begin(plan)

                return {
                    ...commits.complete(
                        plan,
                        plan.targets.map((target) => ({
                            ...JSON.parse(target.metadataJson).fileVerification,
                            finalPath: target.finalPath,
                            realPath: target.finalPath
                        }))
                    ),
                    manifestFinalized: true
                }
            }
        }
    }

    service = new DownloadService(db, new DownloadRunner(ports, root), () => root)

    return {
        ports,
        commits
    }
}

describe('DownloadService', () => {
    it('저장 경로 기록이 실패하면 URL과 작업 생성도 함께 롤백한다', async () => {
        sqlite.exec(`
            CREATE TRIGGER fail_root
            BEFORE INSERT ON download_job_storage
            BEGIN
                SELECT RAISE(ABORT, 'fixture');
            END
        `)

        failure(await enqueue(), 'DATABASE_ERROR')

        assert.equal(db.select().from(s.downloadUrls).all().length, 0)

        assert.equal(db.select().from(s.downloadQueue).all().length, 0)

        assert.equal(sqlite.prepare('SELECT count(*) FROM download_job_storage').pluck().get(), 0)
    })

    it('URL과 작업을 원자적으로 등록하고 자동 실행하지 않는다', async () => {
        const url = 'https://EXAMPLE.invalid:443/post?v=1#two'

        const job = data(await enqueue(url))

        assert.equal(job.url, url)
        assert.equal(job.state, 'pending')
        assert.equal(job.phase, null)
        assert.equal(job.progress, 0)
        assert.equal(run.mock.calls.length, 0)

        const request = db.select().from(s.downloadUrls).get()!

        assert.equal(request.normalizedUrl, 'https://example.invalid/post?v=1#two')
        assert.equal(request.normalizationVersion, 1)

        const row = db.select().from(s.downloadQueue).get()!

        assert.equal(row.recoveryEnabled, false)
        assert.equal(row.autoRunCount, 0)
    })

    it('정규화 중복을 막고 다른 콘텐츠 쿼리는 보존한다', async () => {
        data(await enqueue('https://EXAMPLE.invalid:443/post?v=1'))

        failure(await enqueue('https://example.invalid/post?v=1'), 'ALREADY_PROCESSING')

        data(await enqueue('https://example.invalid/post?v=2'))

        assert.equal(db.select().from(s.downloadUrls).all().length, 2)
        assert.equal(db.select().from(s.downloadQueue).all().length, 2)
    })

    it('작업 생성 실패 시 신규 URL도 롤백하고 DB 오류 원문을 숨긴다', async () => {
        sqlite.exec(`
      CREATE TRIGGER fail_job
      BEFORE INSERT ON download_queue
      BEGIN
        SELECT RAISE(ABORT, 'secret-path');
      END;
    `)

        const result = await enqueue()

        failure(result, 'DATABASE_ERROR')

        assert.equal(db.select().from(s.downloadUrls).all().length, 0)
        assert.equal(db.select().from(s.downloadQueue).all().length, 0)
        assert.ok(!JSON.stringify(result).includes('secret-path'))
    })

    it.each([
        {
            mode: 'create',
            url: 'file:///secret'
        },
        {
            mode: 'create',
            url: 'https://user:secret@example.invalid/post'
        },
        {
            mode: 'create',
            url: 'https://example.invalid/post\n'
        },
        {
            mode: 'create',
            url: 'https://example.invalid/post',
            options: null
        },
        {
            mode: 'create',
            url: 'https://example.invalid/post',
            options: {
                excludeIds: ['x']
            }
        },
        {
            mode: 'create',
            url: 'https://example.invalid/post',
            options: {
                quality: 'invalid'
            }
        },
        {
            mode: 'create',
            url: 'https://example.invalid/post',
            mediaId: 1
        },
        {
            mode: 'replace',
            url: 'https://example.invalid/post',
            mediaId: 1,
            expectedRevision: -1
        }
    ])('잘못된 요청은 쓰기 전에 거부한다: %j', async (request) => {
        failure(await service.enqueue(request), 'INVALID_ARGUMENT')

        assert.equal(db.select().from(s.downloadUrls).all().length, 0)
    })

    it('교체 확인과 revision을 검사하고 사용자 메타데이터를 보존한다', async () => {
        const url = 'https://example.invalid/post'

        const request = db
            .insert(s.downloadUrls)
            .values({
                url,
                normalizedUrl: url,
                normalizationVersion: 1
            })
            .returning()
            .get()

        const parent = db
            .insert(s.medias)
            .values({
                sourceKind: 'download',
                requestUrlId: request.id,
                customTitle: '내 제목',
                revision: 3
            })
            .returning()
            .get()

        const file = db
            .insert(s.mediaFiles)
            .values({
                mediaId: parent.id,
                fileKey: 'old',
                storageKind: 'unverified_legacy',
                filepath: 'C:/fixture/old.png',
                kind: 'image',
                position: 0
            })
            .returning()
            .get()

        db.update(s.medias)
            .set({
                coverMode: 'manual',
                coverFileId: file.id
            })
            .where(eq(s.medias.id, parent.id))
            .run()

        const tag = db
            .insert(s.tags)
            .values({
                name: '보존'
            })
            .returning()
            .get()

        db.insert(s.mediaTags)
            .values({
                mediaId: parent.id,
                tagId: tag.id
            })
            .run()

        db.insert(s.favorites)
            .values({
                mediaId: parent.id
            })
            .run()

        assert.equal(
            failure(await enqueue(), 'REDOWNLOAD_CONFIRMATION_REQUIRED').context.mediaId,
            parent.id
        )

        failure(
            await service.enqueue({
                mode: 'replace',
                url,
                mediaId: parent.id,
                expectedRevision: 2
            }),
            'REVISION_CONFLICT'
        )

        data(
            await service.enqueue({
                mode: 'replace',
                url,
                mediaId: parent.id,
                expectedRevision: 3
            })
        )

        const saved = db.select().from(s.medias).get()!

        assert.equal(saved.customTitle, '내 제목')
        assert.equal(saved.coverFileId, file.id)
        assert.equal(saved.revision, 3)

        assert.equal(db.select().from(s.mediaTags).all().length, 1)
        assert.equal(db.select().from(s.favorites).all().length, 1)
    })

    it('페이지 조회는 내부 로그와 오류 원문을 포함하지 않는다', async () => {
        const job = data(await enqueue())

        data(await enqueue('https://example.invalid/other'))

        db.update(s.downloadQueue)
            .set({
                log: 'secret-path',
                errorMessage: 'secret-error',
                title: '제목'
            })
            .where(eq(s.downloadQueue.id, job.id))
            .run()

        const first = data(await service.list({ limit: 1 }))

        assert.equal(first.data.length, 1)
        assert.equal(first.hasNextPage, true)

        const second = data(
            await service.list({
                limit: 1,
                offset: 1
            })
        )

        assert.equal(second.hasNextPage, false)
        assert.notEqual(first.data[0].id, second.data[0].id)

        const result = data(
            await service.get({
                jobId: job.id
            })
        )

        assert.equal(result.title, '제목')
        assert.ok(!JSON.stringify(result).includes('secret'))

        failure(await service.list({ limit: 101 }), 'INVALID_ARGUMENT')

        failure(
            await service.get({
                jobId: 'missing'
            }),
            'NOT_FOUND'
        )
    })

    it('기존 미지원 옵션의 이력은 조회하고 실행은 attempt 생성 전에 거부한다', async () => {
        const job = data(await enqueue())

        db.update(s.downloadQueue)
            .set({
                optionsJson: JSON.stringify({
                    excludeIds: ['legacy']
                })
            })
            .where(eq(s.downloadQueue.id, job.id))
            .run()

        assert.equal(
            data(
                await service.get({
                    jobId: job.id
                })
            ).options,
            null
        )

        assert.equal(data(await service.list()).data.length, 1)

        failure(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            }),
            'INVALID_ARGUMENT'
        )

        assert.equal(run.mock.calls.length, 0)

        assert.equal(db.select().from(s.downloadAttempts).all().length, 0)
    })

    it('Renderer의 자동 복구 trigger와 임의 실행 인수를 거부한다', async () => {
        const job = data(await enqueue())

        failure(
            await service.run({
                jobId: job.id,
                trigger: 'auto_recovery'
            }),
            'INVALID_ARGUMENT'
        )

        failure(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial',
                executable: 'secret'
            }),
            'INVALID_ARGUMENT'
        )

        assert.equal(run.mock.calls.length, 0)
    })

    it('대기 취소는 엔진과 attempt 없이 DB에 반영한다', async () => {
        const job = data(await enqueue())

        assert.equal(
            data(
                await service.cancel({
                    jobId: job.id
                })
            ).accepted,
            true
        )

        assert.equal(
            data(
                await service.get({
                    jobId: job.id
                })
            ).state,
            'cancelled'
        )

        assert.equal(cancel.mock.calls.length, 0)

        assert.equal(db.select().from(s.downloadAttempts).all().length, 0)
    })

    it('정리가 필요한 대기 작업을 취소로 덮어쓰지 않는다', async () => {
        const job = data(await enqueue())

        db.update(s.downloadQueue)
            .set({
                cleanupRequired: true
            })
            .where(eq(s.downloadQueue.id, job.id))
            .run()

        failure(
            await service.cancel({
                jobId: job.id
            }),
            'CLEANUP_REQUIRED'
        )

        assert.equal(
            data(
                await service.get({
                    jobId: job.id
                })
            ).state,
            'pending'
        )

        assert.equal(cancel.mock.calls.length, 0)
    })
})

describe('DownloadService + 실제 Runner / DB', () => {
    it('전체 DB 커밋 증거가 확인된 뒤 완료를 반환한다', async () => {
        realRunner()

        const job = data(await enqueue())

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        assert.equal(result.status, 'committed')

        const saved = data(
            await service.get({
                jobId: job.id
            })
        )

        assert.equal(saved.state, 'completed')
        assert.equal(saved.phase, 'finished')
        assert.equal(saved.progress, 100)

        assert.equal(db.select().from(s.medias).all().length, 1)
        assert.equal(db.select().from(s.mediaFiles).all().length, 2)
    })

    it('검증 실패는 일부 등록 없이 정리 필요로 반환하고 재실행을 막는다', async () => {
        const { ports } = realRunner()

        ports.verification = {
            verify: async () => {
                throw new DownloadRepositoryError('FILE_EMPTY')
            }
        }

        const job = data(await enqueue())

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        assert.equal(result.status, 'cleanup_required')

        assert.equal(db.select().from(s.medias).all().length, 0)

        const saved = data(
            await service.get({
                jobId: job.id
            })
        )

        assert.equal(saved.state, 'failed')
        assert.equal(saved.cleanupRequired, true)
        assert.equal(saved.errorCode, 'FILE_EMPTY')

        failure(
            await service.run({
                jobId: job.id,
                trigger: 'manual_retry'
            }),
            'CLEANUP_REQUIRED'
        )
    })

    it('실행 중 취소 요청과 최종 취소 상태를 구분한다', async () => {
        const { ports } = realRunner()

        let entered!: () => void

        const ready = new Promise<void>((done) => {
            entered = done
        })

        ports.selectAdapter = () => ({
            discover: async ({ signal }) =>
                new Promise<never>((_, reject) => {
                    signal.addEventListener(
                        'abort',
                        () => {
                            reject(new DownloadRepositoryError('CANCEL_REQUESTED'))
                        },
                        { once: true }
                    )

                    entered()
                }),

            downloadFrozen: async () => []
        })

        const job = data(await enqueue())

        const running = service.run({
            jobId: job.id,
            trigger: 'manual_initial'
        })

        await Promise.race([
            ready,
            running.then(() => {
                throw new Error('Discovery did not start')
            })
        ])

        assert.equal(
            data(
                await service.cancel({
                    jobId: job.id
                })
            ).accepted,
            true
        )

        assert.equal(data(await running).status, 'cleanup_required')

        const saved = data(
            await service.get({
                jobId: job.id
            })
        )

        assert.equal(saved.state, 'cancelled')
        assert.equal(saved.cleanupRequired, true)
    })

    it('committing 진입 후 취소를 거절하고 완료를 유지한다', async () => {
        const { ports, commits } = realRunner()

        let entered!: () => void
        let release!: () => void

        const ready = new Promise<void>((done) => {
            entered = done
        })

        const resume = new Promise<void>((done) => {
            release = done
        })

        ports.storage = {
            async finalize(jobId, attemptId) {
                const plan = commits.prepare(jobId, attemptId)

                commits.begin(plan)
                entered()

                await resume

                return {
                    ...commits.complete(
                        plan,
                        plan.targets.map((target) => ({
                            ...JSON.parse(target.metadataJson).fileVerification,
                            finalPath: target.finalPath,
                            realPath: target.finalPath
                        }))
                    ),
                    manifestFinalized: true
                }
            }
        }

        const job = data(await enqueue())

        const running = service.run({
            jobId: job.id,
            trigger: 'manual_initial'
        })

        let result: Awaited<typeof running>

        try {
            await Promise.race([
                ready,
                running.then(() => {
                    throw new Error('Commit did not start')
                })
            ])

            failure(
                await service.cancel({
                    jobId: job.id
                }),
                'CANNOT_CANCEL_COMMITTING'
            )

            assert.equal(
                data(
                    await service.get({
                        jobId: job.id
                    })
                ).phase,
                'committing'
            )
        } finally {
            release()
            result = await running
        }

        assert.equal(data(result).status, 'committed')

        assert.equal(
            data(
                await service.get({
                    jobId: job.id
                })
            ).state,
            'completed'
        )
    })

    it('엔진 종료 미확인은 실패 처리하지 않고 후속 실행을 보류한다', async () => {
        const { ports } = realRunner()

        ports.selectAdapter = () => ({
            discover: async () => {
                throw new DownloadRepositoryError('ENGINE_STOP_UNCONFIRMED')
            },
            downloadFrozen: async () => []
        })

        const job = data(await enqueue())

        const result = data(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            })
        )

        assert.deepEqual(result, {
            status: 'blocked',
            jobId: job.id,
            reason: 'ENGINE_STATE_UNKNOWN'
        })

        const saved = data(
            await service.get({
                jobId: job.id
            })
        )

        assert.equal(saved.state, 'running')
        assert.equal(saved.cleanupRequired, false)

        assert.equal(db.select().from(s.downloadAttempts).get()!.outcome, null)

        const next = data(await enqueue('https://example.invalid/next'))

        assert.equal(
            data(
                await service.run({
                    jobId: next.id,
                    trigger: 'manual_initial'
                })
            ).status,
            'blocked'
        )

        assert.equal(
            data(
                await service.get({
                    jobId: next.id
                })
            ).currentAttemptId,
            null
        )
    })
})

describe('DownloadService 순차 실행', () => {
    it('다른 작업은 앞선 실행이 끝난 뒤 Runner에 전달한다', async () => {
        const first = data(await enqueue('https://example.invalid/first'))
        const second = data(await enqueue('https://example.invalid/second'))

        let release!: (value: Awaited<ReturnType<DownloadRunner['run']>>) => void

        let entered!: () => void

        const ready = new Promise<void>((done) => {
            entered = done
        })

        run.mockImplementationOnce(async () => {
            entered()

            return new Promise((done) => {
                release = done
            })
        })

        const a = service.run({
            jobId: first.id,
            trigger: 'manual_initial'
        })

        await ready

        const b = service.run({
            jobId: second.id,
            trigger: 'manual_initial'
        })

        await Promise.resolve()

        assert.equal(run.mock.calls.length, 1)

        release({
            status: 'committed',
            jobId: first.id,
            attemptId: 'a',
            mediaIdSnapshot: 1
        })

        assert.equal(data(await a).status, 'committed')
        assert.equal(data(await b).status, 'blocked')

        assert.deepEqual(
            run.mock.calls.map(([id]) => id),
            [first.id, second.id]
        )
    })

    it('같은 작업의 중복 실행 요청을 큐에 넣지 않는다', async () => {
        const job = data(await enqueue())

        let release!: (value: Awaited<ReturnType<DownloadRunner['run']>>) => void

        run.mockImplementationOnce(
            async () =>
                new Promise((done) => {
                    release = done
                })
        )

        const active = service.run({
            jobId: job.id,
            trigger: 'manual_initial'
        })

        await Promise.resolve()

        failure(
            await service.run({
                jobId: job.id,
                trigger: 'manual_initial'
            }),
            'ALREADY_PROCESSING'
        )

        release({
            status: 'committed',
            jobId: job.id,
            attemptId: 'a',
            mediaIdSnapshot: 1
        })

        await active

        assert.equal(run.mock.calls.length, 1)
    })

    it('예상하지 못한 실행 예외 뒤에는 대기 작업을 보류한다', async () => {
        const first = data(await enqueue('https://example.invalid/first'))
        const second = data(await enqueue('https://example.invalid/second'))

        run.mockRejectedValueOnce(new Error('secret-path'))

        failure(
            await service.run({
                jobId: first.id,
                trigger: 'manual_initial'
            }),
            'INTERNAL_ERROR'
        )

        assert.deepEqual(
            data(
                await service.run({
                    jobId: second.id,
                    trigger: 'manual_initial'
                })
            ),
            {
                status: 'blocked',
                jobId: second.id,
                reason: 'INCONSISTENT_STATE'
            }
        )

        assert.equal(run.mock.calls.length, 1)
    })
})
