import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as schema from '../../src/database/schema-v2'
import { schemaV2Guards } from '../../src/database/schema-v2.guards'
import { MediaRepository } from '../../src/main/repositories/MediaRepository'
import { MediaService } from '../../src/main/services/MediaService'
import { createMediaHandlers, type MediaServicePort } from '../../src/main/handlers/MediaHandler'
import type { MediaResult, MediaErrorCode } from '../../src/shared/media-v2'
import { createAppApi, type IpcTransport } from '../../src/preload/api'

let ddl: string[]
let sqlite: Database.Database
let repository: MediaRepository
let service: MediaServicePort | undefined
let calls: {
    channel: string
    args: unknown[]
}[]
let unexpected: unknown[]

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(schema)
    )
})

beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    const db = drizzle(sqlite, { schema })

    repository = new MediaRepository(db, () => 1_800_000_000_000)

    unexpected = []

    service = new MediaService(repository, (error) => {
        unexpected.push(error)
    })

    calls = []
})

afterEach(() => {
    if (!sqlite?.open) return

    try {
        assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
    } finally {
        sqlite.close()
    }
})

function fixture() {
    const handlers = createMediaHandlers(
        () => service,
        (error) => {
            unexpected.push(error)
        }
    )

    const transport: IpcTransport = {
        async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
            calls.push({
                channel,
                args: structuredClone(args)
            })

            const handler = handlers[channel as keyof typeof handlers]

            assert.ok(handler, 'Unregistered channel: ' + channel)

            const result = await handler({} as IpcMainInvokeEvent, structuredClone(args[0]))

            return structuredClone(result) as T
        },

        subscribe: () => () => {}
    }

    return {
        api: createAppApi(transport),
        handlers
    }
}

function data<T>(result: MediaResult<T>): T {
    assert.ok(result.ok)
    return result.data
}

function failure(result: MediaResult<unknown>, code: MediaErrorCode) {
    assert.equal(result.ok, false)

    if (result.ok) {
        throw new Error('Expected failure')
    }

    assert.equal(result.error.code, code)

    return result.error
}

function seed() {
    return repository.register({
        sourceKind: 'local',
        folder: {
            sourceTitle: '로컬',
            directoryPath: 'C:/fixture/images',
            directoryKey: 'images',
            keyVersion: 1
        },
        files: [0, 1].map((position) => ({
            fileKey: 'file-' + position,
            position,
            storageKind: 'external_reference',
            kind: 'image',
            filepath: 'C:/fixture/images/' + position + '.png',
            canonicalPathKey: 'images/' + position,
            relativePath: position + '.png',
            filesize: 12,
            mtimeNs: '1800000000000000000',
            hashAlgorithm: 'sha256',
            contentHash: 'a'.repeat(64),
            detectedFormat: 'PNG',
            width: 10,
            height: 10
        }))
    })
}

describe('media IPC contract', () => {
    it('preload·Handler·서비스·메모리 DB를 거쳐 목록과 자식 페이지를 조회한다', async () => {
        const media = seed()
        const { api } = fixture()

        const list = data(await api.media.list())

        assert.equal(list.total, 1)
        assert.equal(list.data[0].id, media.media.id)
        assert.equal(list.data[0].fileCount, 2)

        const detail = data(
            await api.media.get({
                mediaId: media.media.id,
                fileLimit: 1,
                fileOffset: 1
            })
        )

        assert.equal(detail.files.data[0].id, media.files[1].id)
        assert.equal(detail.files.total, 2)
        assert.equal(detail.files.hasNextPage, false)
        assert.equal(detail.createdAt, 1_800_000_000_000)

        assert.deepEqual(calls, [
            {
                channel: 'media:list',
                args: [{}]
            },
            {
                channel: 'media:get',
                args: [
                    {
                        mediaId: media.media.id,
                        fileLimit: 1,
                        fileOffset: 1
                    }
                ]
            }
        ])
    })

    it('편집 요청의 revision·표지·빈 제목 복귀 값을 그대로 전달한다', async () => {
        const media = seed()
        const { api } = fixture()

        const request = {
            mediaId: media.media.id,
            expectedRevision: 0,
            customTitle: '사용자',
            cover: {
                mode: 'manual' as const,
                fileId: media.files[1].id
            },
            isFavorite: true
        }

        const edited = data(await api.media.edit(request))

        assert.equal(edited.revision, 1)
        assert.equal(edited.title, '사용자')
        assert.equal(edited.cover!.fileId, media.files[1].id)
        assert.equal(edited.isFavorite, true)

        assert.deepEqual(calls[0], {
            channel: 'media:edit',
            args: [request]
        })

        const reset = data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 1,
                customTitle: null,
                cover: { mode: 'auto' }
            })
        )

        assert.equal(reset.title, '로컬')
        assert.equal(reset.revision, 2)
    })

    it('충돌 오류를 일반 객체로 전달하고 최신 revision으로 자동 재시도하지 않는다', async () => {
        const media = seed()
        const { api } = fixture()

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                customTitle: '최신'
            })
        )

        const error = failure(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                customTitle: '과거'
            }),
            'REVISION_CONFLICT'
        )

        assert.deepEqual(error.context, {
            mediaId: media.media.id,
            expectedRevision: 0,
            actualRevision: 1
        })

        assert.equal(calls.length, 2)
        assert.equal(repository.get(media.media.id)!.displayTitle, '최신')
    })

    it('일부 제거와 마지막 제거의 결과를 전달하고 외부 원본 정리를 예약하지 않는다', async () => {
        const media = seed()
        const { api } = fixture()

        const request = {
            mediaId: media.media.id,
            expectedRevision: 0,
            fileIds: [media.files[0].id]
        }

        const partial = data(await api.media.unregisterFiles(request))

        assert.equal(partial.parentRemoved, false)
        assert.equal(partial.revision, 1)
        assert.equal(partial.cleanupTaskId, null)

        assert.deepEqual(calls[0], {
            channel: 'media:unregister-files',
            args: [request]
        })

        const last = data(
            await api.media.unregisterFiles({
                mediaId: media.media.id,
                expectedRevision: 1,
                fileIds: [media.files[1].id]
            })
        )

        assert.equal(last.parentRemoved, true)
        assert.equal(last.revision, null)
        assert.equal(last.cleanupTaskId, null)
        assert.equal(repository.get(media.media.id), undefined)
    })

    it('묶음 등록 해제는 별도 명령으로 전달한다', async () => {
        const media = seed()
        const { api } = fixture()

        const request = {
            mediaId: media.media.id,
            expectedRevision: 0
        }

        const result = data(await api.media.unregisterMedia(request))

        assert.equal(result.parentRemoved, true)

        assert.deepEqual(calls, [
            {
                channel: 'media:unregister',
                args: [request]
            }
        ])

        assert.equal(repository.get(media.media.id), undefined)
    })

    it('직접 IPC로 들어온 잘못된 요청도 서비스에서 검증한다', async () => {
        const media = seed()
        const { handlers } = fixture()

        for (const request of [
            null,
            {
                mediaId: media.media.id,
                customTitle: 'revision 없음'
            },
            {
                mediaId: media.media.id,
                expectedRevision: 0,
                sourceKind: 'download'
            }
        ]) {
            failure(
                await handlers['media:edit']({} as IpcMainInvokeEvent, request),
                'INVALID_ARGUMENT'
            )
        }

        assert.deepEqual(repository.get(media.media.id), media)
    })

    it('서비스 연결 전에는 다섯 명령 모두 NOT_READY이며 기존 DB 경로로 우회하지 않는다', async () => {
        const media = seed()
        service = undefined

        const { api } = fixture()

        const reference = {
            mediaId: media.media.id,
            expectedRevision: 0
        }

        for (const result of [
            await api.media.list(),
            await api.media.get({
                mediaId: media.media.id
            }),
            await api.media.edit({
                ...reference,
                customTitle: '변경'
            }),
            await api.media.unregisterFiles({
                ...reference,
                fileIds: [media.files[0].id]
            }),
            await api.media.unregisterMedia(reference)
        ]) {
            failure(result, 'NOT_READY')
        }

        assert.deepEqual(repository.get(media.media.id), media)
        assert.deepEqual(unexpected, [])
    })

    it('Handler 생성 시 DB를 요구하지 않고 각 호출에서 현재 서비스를 확인한다', async () => {
        let resolutions = 0

        const bound = service
        service = undefined

        const handlers = createMediaHandlers(() => {
            resolutions++
            return service
        })

        assert.equal(resolutions, 0)

        failure(await handlers['media:list']({} as IpcMainInvokeEvent), 'NOT_READY')

        service = bound

        data(await handlers['media:list']({} as IpcMainInvokeEvent))

        assert.equal(resolutions, 2)
    })

    it('서비스 해결 단계의 예외도 내부 정보 없는 오류 응답으로 바꾼다', async () => {
        const handlers = createMediaHandlers(
            () => {
                throw new Error('private C:/secret/example.db')
            },
            () => {
                throw new Error('logger failure')
            }
        )

        const result = await handlers['media:list']({} as IpcMainInvokeEvent)

        failure(result, 'INTERNAL_ERROR')

        assert.equal(JSON.stringify(result).includes('C:/secret'), false)
    })

    it('정식 편집·등록 해제·다운로드 인자를 전달한다', async () => {
        const calls: { channel: string; args: unknown[] }[] = []

        const transport: IpcTransport = {
            invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
                calls.push({ channel, args })
                return Promise.resolve(undefined as T)
            },
            subscribe: () => () => {}
        }

        const api = createAppApi(transport)

        await api.media.edit({
            mediaId: 42,
            expectedRevision: 7,
            isFavorite: true,
            tagChange: { addNames: ['tag'] }
        })

        await api.media.unregisterMedia({
            mediaId: 42,
            expectedRevision: 8
        })

        await api.downloads.enqueue({
            mode: 'create',
            url: 'https://example.invalid/post'
        })

        assert.deepEqual(calls, [
            {
                channel: 'media:edit',
                args: [
                    {
                        mediaId: 42,
                        expectedRevision: 7,
                        isFavorite: true,
                        tagChange: { addNames: ['tag'] }
                    }
                ]
            },
            {
                channel: 'media:unregister',
                args: [{ mediaId: 42, expectedRevision: 8 }]
            },
            {
                channel: 'download:enqueue',
                args: [
                    {
                        mode: 'create',
                        url: 'https://example.invalid/post'
                    }
                ]
            }
        ])
    })
})
