import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it, vi } from 'vitest'
import * as schema from '../../src/database/schema-v2'
import { schemaV2Guards } from '../../src/database/schema-v2.guards'
import { createDownloadHandlers } from '../../src/main/features/download/DownloadHandler'
import { DownloadService } from '@features/download/DownloadService'
import type { DownloadRunner } from '@features/download/DownloadRunner'
import { DownloadRepositoryError } from '@features/download/DownloadRepository'
import {
    downloadFailure,
    type DownloadResponse,
    type DownloadRunDto,
    type DownloadServicePort
} from '../../src/shared/download-api'
import { createAppApi, type IpcTransport } from '../../src/preload/api'
import { resolve } from 'node:path'
import { downloadStorageSql } from '../../src/database/migrate'

vi.mock('../../src/database/index', () => {
    throw new Error('USER_DATABASE_IMPORTED')
})

let ddl: string[]
let sqlite: Database.Database
let service: DownloadServicePort | undefined
let unexpected: unknown[]

let run: ReturnType<typeof vi.fn<DownloadRunner['run']>>

let cancel: ReturnType<typeof vi.fn<DownloadRunner['cancel']>>

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(schema)
    )
})

beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards, ...downloadStorageSql]) {
        sqlite.exec(statement)
    }

    run = vi.fn<DownloadRunner['run']>(async (jobId) => ({
        status: 'blocked',
        jobId,
        reason: 'ENGINE_STATE_UNKNOWN'
    }))

    cancel = vi.fn<DownloadRunner['cancel']>()

    service = new DownloadService(drizzle(sqlite, { schema }), { run, cancel }, () =>
        resolve('api-fixture')
    )

    unexpected = []
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

function failure(result: DownloadResponse<unknown>, code: string) {
    assert.equal(result.ok, false)

    if (result.ok) {
        throw new Error('Expected failure')
    }

    assert.equal(result.error.code, code)
}

function fixture(
    resolveService = () => service,
    reportUnexpected: (error: unknown) => void = (error) => {
        unexpected.push(error)
    }
) {
    const handlers = createDownloadHandlers(resolveService, reportUnexpected)

    const calls: {
        channel: string
        args: unknown[]
    }[] = []

    const transport: IpcTransport = {
        async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
            calls.push({
                channel,
                args: structuredClone(args)
            })

            const handler = handlers[channel as keyof typeof handlers]

            assert.ok(handler, channel)

            return structuredClone(
                await handler({} as IpcMainInvokeEvent, structuredClone(args[0]))
            ) as T
        },

        subscribe: () => () => {}
    }

    return {
        api: createAppApi(transport).downloads,
        handlers,
        calls
    }
}

describe('download IPC / preload', () => {
    it('다섯 명령을 새 핸들러·서비스·메모리 DB로 전달한다', async () => {
        const { api, calls } = fixture()

        const request = {
            mode: 'create' as const,
            url: 'https://example.invalid/post',
            options: {
                quality: '720' as const,
                playlist: true
            }
        }

        const job = data(await api.enqueue(request))

        assert.equal(job.state, 'pending')

        assert.equal(data(await api.list()).data[0].id, job.id)

        assert.equal(data(await api.get({ jobId: job.id })).id, job.id)

        assert.equal(
            data(
                await api.run({
                    jobId: job.id,
                    trigger: 'manual_initial'
                })
            ).status,
            'blocked'
        )

        assert.equal(data(await api.cancel({ jobId: job.id })).accepted, true)

        assert.deepEqual(calls, [
            {
                channel: 'download:enqueue',
                args: [request]
            },
            {
                channel: 'download:list',
                args: [{}]
            },
            {
                channel: 'download:get',
                args: [{ jobId: job.id }]
            },
            {
                channel: 'download:run',
                args: [
                    {
                        jobId: job.id,
                        trigger: 'manual_initial'
                    }
                ]
            },
            {
                channel: 'download:cancel',
                args: [{ jobId: job.id }]
            }
        ])

        assert.deepEqual(run.mock.calls, [[job.id, 'manual_initial']])

        assert.deepEqual(unexpected, [])
    })

    it('교체 대상·revision·옵션을 그대로 전달한다', async () => {
        const request = {
            mode: 'replace' as const,
            url: 'https://example.invalid/post',
            mediaId: 42,
            expectedRevision: 7,
            options: {
                type: 'audio' as const,
                extension: 'mp3' as const
            }
        }

        const enqueue = vi.fn(async (_request: unknown) => downloadFailure('REVISION_CONFLICT'))

        service = {
            enqueue
        } as unknown as DownloadServicePort

        const { api } = fixture()

        failure(await api.enqueue(request), 'REVISION_CONFLICT')

        assert.deepEqual(enqueue.mock.calls, [[request]])
    })

    it('서비스 미주입 시 모든 새 명령은 NOT_READY를 반환한다', async () => {
        service = undefined

        const { api } = fixture()

        const results = await Promise.all([
            api.enqueue({
                mode: 'create',
                url: 'https://example.invalid/post'
            }),
            api.list(),
            api.get({ jobId: 'job' }),
            api.run({
                jobId: 'job',
                trigger: 'manual_initial'
            }),
            api.cancel({ jobId: 'job' })
        ])

        for (const result of results) {
            failure(result, 'NOT_READY')
        }

        assert.deepEqual(unexpected, [])
    })

    it('같은 핸들러도 각 요청에서 현재 서비스를 다시 확인한다', async () => {
        const current = service
        const { api } = fixture()

        service = undefined
        failure(await api.list(), 'NOT_READY')

        service = current

        assert.equal(data(await api.list()).data.length, 0)

        service = undefined
        failure(await api.list(), 'NOT_READY')
    })

    it('서비스 해결 단계의 예외 원문을 응답에 포함하지 않는다', async () => {
        const { api } = fixture(() => {
            throw new Error('secret-path')
        })

        const result = await api.list()

        failure(result, 'INTERNAL_ERROR')

        assert.ok(!JSON.stringify(result).includes('secret-path'))

        assert.equal(unexpected.length, 1)
    })

    it.each(['sync', 'async'])('서비스의 %s 예외와 로깅 실패를 안전하게 처리한다', async (mode) => {
        service = {
            list:
                mode === 'sync'
                    ? () => {
                          throw new Error('secret-path')
                      }
                    : async () => {
                          throw new Error('secret-path')
                      }
        } as unknown as DownloadServicePort

        const { api } = fixture(
            () => service,
            () => {
                throw new Error('logger-secret')
            }
        )

        const result = await api.list()

        failure(result, 'INTERNAL_ERROR')

        assert.ok(!JSON.stringify(result).includes('secret'))
    })

    it('직접 IPC로 전달한 잘못된 요청도 서비스가 검증한다', async () => {
        const { handlers } = fixture()
        const event = {} as IpcMainInvokeEvent

        failure(
            await handlers['download:enqueue'](event, {
                mode: 'create',
                url: 'file:///secret'
            }),
            'INVALID_ARGUMENT'
        )

        failure(
            await handlers['download:run'](event, {
                jobId: 'job',
                trigger: 'auto_recovery'
            }),
            'INVALID_ARGUMENT'
        )

        failure(
            await handlers['download:list'](event, {
                limit: 201
            }),
            'INVALID_ARGUMENT'
        )

        assert.equal(sqlite.prepare('SELECT count(*) FROM download_queue').pluck().get(), 0)

        assert.equal(run.mock.calls.length, 0)
    })

    it('DB 오류는 일반 객체로 전달하고 신규 URL을 남기지 않는다', async () => {
        sqlite.exec(`
      CREATE TRIGGER fail_job
      BEFORE INSERT ON download_queue
      BEGIN
        SELECT RAISE(ABORT, 'secret-path');
      END;
    `)

        const { api } = fixture()

        const result = await api.enqueue({
            mode: 'create',
            url: 'https://example.invalid/post'
        })

        failure(result, 'DATABASE_ERROR')

        assert.ok(!JSON.stringify(result).includes('secret-path'))

        assert.equal(sqlite.prepare('SELECT count(*) FROM download_urls').pluck().get(), 0)

        assert.deepEqual(unexpected, [])
    })

    it.each(['committed', 'cleanup_required', 'blocked'] as const)(
        'Runner의 %s 결과를 그대로 전달한다',
        async (status) => {
            const { api } = fixture()

            const job = data(
                await api.enqueue({
                    mode: 'create',
                    url: 'https://example.invalid/post'
                })
            )

            const decision: DownloadRunDto =
                status === 'committed'
                    ? {
                          status,
                          jobId: job.id,
                          attemptId: 'attempt',
                          mediaIdSnapshot: 42
                      }
                    : status === 'cleanup_required'
                      ? {
                            status,
                            jobId: job.id,
                            attemptId: 'attempt',
                            taskId: 'cleanup'
                        }
                      : {
                            status,
                            jobId: job.id,
                            reason: 'ENGINE_STATE_UNKNOWN'
                        }

            run.mockResolvedValueOnce(decision as Awaited<ReturnType<DownloadRunner['run']>>)

            assert.deepEqual(
                data(
                    await api.run({
                        jobId: job.id,
                        trigger: 'manual_initial'
                    })
                ),
                decision
            )
        }
    )

    it('committing 취소 거절을 성공 응답으로 바꾸지 않는다', async () => {
        const { api } = fixture()

        const job = data(
            await api.enqueue({
                mode: 'create',
                url: 'https://example.invalid/post'
            })
        )

        const db = drizzle(sqlite, { schema })

        db.update(schema.downloadQueue)
            .set({
                state: 'running'
            })
            .where(eq(schema.downloadQueue.id, job.id))
            .run()

        cancel.mockImplementation(() => {
            throw new DownloadRepositoryError('CANNOT_CANCEL_COMMITTING')
        })

        failure(
            await api.cancel({
                jobId: job.id
            }),
            'CANNOT_CANCEL_COMMITTING'
        )

        assert.equal(
            data(
                await api.get({
                    jobId: job.id
                })
            ).state,
            'running'
        )
    })

    it('transport 자체의 통신 실패는 호출자에게 전달한다', async () => {
        const api = createAppApi({
            invoke: async () => {
                throw new Error('TRANSPORT_DOWN')
            },
            subscribe: () => () => {}
        }).downloads

        await assert.rejects(api.list(), /TRANSPORT_DOWN/)
    })
})
