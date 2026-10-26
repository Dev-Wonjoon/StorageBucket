import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { beforeAll, beforeEach, afterEach, describe, it } from 'vitest'
import * as s from '../../src/database/schema-v2'
import { schemaV2Guards } from '../../src/database/schema-v2.guards'
import { MediaRepository, type V2Database } from '../../src/main/repositories/MediaRepository'
import { MediaService } from '../../src/main/services/MediaService'
import { createMediaHandlers } from '../../src/main/handlers/MediaHandler'
import { createAppApi, type IpcTransport } from '../../src/preload/api'
import { createGalleryStore } from '../../src/renderer/src/features/gallery/galleryStore'
import type { MediaResult, MediaErrorCode } from '../../src/shared/media-v2'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repository: MediaRepository
let api: ReturnType<typeof createAppApi>
let handlers: ReturnType<typeof createMediaHandlers>
let counter: number
let calls: {
    channel: string
    args: unknown[]
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

    repository = new MediaRepository(db, () => 1_800_000_000_000)

    const service = new MediaService(repository, () => {})

    handlers = createMediaHandlers(() => service)
    calls = []
    counter = 0

    const transport: IpcTransport = {
        async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
            calls.push({
                channel,
                args: structuredClone(args)
            })

            const handler = handlers[channel as keyof typeof handlers]

            assert.ok(handler)

            return structuredClone(
                await handler({} as IpcMainInvokeEvent, structuredClone(args[0]))
            ) as T
        },

        subscribe: () => () => {}
    }

    api = createAppApi(transport)
})

afterEach(() => {
    if (!sqlite?.open) return

    try {
        assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
    } finally {
        sqlite.close()
    }
})

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
}

function seed(isFavorite = false) {
    counter++

    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/' + counter,
            normalizedUrl: 'https://example.invalid/' + counter,
            normalizationVersion: 1
        })
        .returning()
        .get()

    return repository.register({
        sourceKind: 'download',
        requestUrlId: url.id,
        sourceTitle: '묶음 ' + counter,
        isFavorite,
        files: [
            {
                fileKey: 'one',
                position: 0,
                storageKind: 'app_managed',
                kind: 'image',
                filepath: 'C:/fixture/' + counter + '.png'
            }
        ]
    })
}

function masterTags() {
    return db.select().from(s.tags).all()
}

describe('favorites and tag changes', () => {
    it('DB에서 즐겨찾기를 필터링하고 추가 시각 순으로 페이지·전체 개수를 계산한다', async () => {
        const a = seed(true)
        const b = seed(true)
        seed(false)

        sqlite
            .prepare('UPDATE favorite SET created_at = ? WHERE media_id = ?')
            .run(3000, a.media.id)

        sqlite
            .prepare('UPDATE favorite SET created_at = ? WHERE media_id = ?')
            .run(2000, b.media.id)

        const first = data(
            await api.media.list({
                favoritesOnly: true,
                limit: 1
            })
        )

        assert.equal(first.total, 2)
        assert.equal(first.data[0].id, a.media.id)
        assert.equal(first.hasNextPage, true)

        const second = data(
            await api.media.list({
                favoritesOnly: true,
                limit: 1,
                offset: 1
            })
        )

        assert.equal(second.data[0].id, b.media.id)
        assert.equal(second.hasNextPage, false)
        assert.equal(data(await api.media.list()).total, 3)

        assert.deepEqual(calls[0].args, [
            {
                favoritesOnly: true,
                limit: 1
            }
        ])
    })

    it('잘못된 즐겨찾기 필터는 거부한다', async () => {
        failure(
            await handlers['media:list']({} as IpcMainInvokeEvent, { favoritesOnly: 'true' }),
            'INVALID_ARGUMENT'
        )
    })

    it('즐겨찾기 해제는 부모·자식을 보존하며 재설정은 기존 즐겨찾기 ID를 유지한다', async () => {
        const media = seed(true)
        const favoriteId = media.favorite!.id

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                isFavorite: true
            })
        )

        assert.equal(repository.get(media.media.id)!.favorite!.id, favoriteId)

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 1,
                isFavorite: false
            })
        )

        assert.equal(
            data(
                await api.media.list({
                    favoritesOnly: true
                })
            ).total,
            0
        )

        assert.equal(repository.get(media.media.id)!.files[0].id, media.files[0].id)
    })

    it('태그 추가 이름만 정리하고 중복 태그·연결을 만들지 않는다', async () => {
        const media = seed(true)

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                tagChange: {
                    addNames: [' 여행 ', '여행', '풍경']
                }
            })
        )

        const detail = data(
            await api.media.get({
                mediaId: media.media.id
            })
        )

        assert.deepEqual(
            detail.tags.map((tag) => tag.name),
            ['여행', '풍경']
        )
        assert.equal(detail.revision, 1)
        assert.equal(detail.favorite!.id, media.favorite!.id)

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 1,
                tagChange: {
                    addNames: ['여행']
                }
            })
        )

        assert.equal(masterTags().length, 2)
        assert.equal(repository.get(media.media.id)!.tags.length, 2)
    })

    it('태그 연결 해제는 마스터와 다른 부모의 연결을 보존한다', async () => {
        const a = seed()
        const b = seed()

        for (const media of [a, b]) {
            data(
                await api.media.edit({
                    mediaId: media.media.id,
                    expectedRevision: 0,
                    tagChange: {
                        addNames: ['공통']
                    }
                })
            )
        }

        const tagId = repository.get(a.media.id)!.tags[0].id

        data(
            await api.media.edit({
                mediaId: a.media.id,
                expectedRevision: 1,
                tagChange: {
                    removeIds: [tagId]
                }
            })
        )

        assert.deepEqual(repository.get(a.media.id)!.tags, [])
        assert.equal(repository.get(b.media.id)!.tags[0].id, tagId)
        assert.equal(masterTags()[0].id, tagId)
    })

    it('추가·연결 해제·제목·즐겨찾기를 한 트랜잭션과 revision으로 반영한다', async () => {
        const media = seed()

        const tag = db.insert(s.tags).values({ name: '이전' }).returning().get()

        repository.edit(media.media.id, 0, { tagIds: [tag.id] })

        const taskCount = db.select().from(s.maintenanceTasks).all().length

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 1,
                customTitle: '사용자 제목',
                isFavorite: true,
                tagChange: {
                    removeIds: [tag.id],
                    addNames: ['새 태그']
                }
            })
        )

        const detail = repository.get(media.media.id)!

        assert.equal(detail.media.revision, 2)
        assert.equal(detail.displayTitle, '사용자 제목')
        assert.deepEqual(
            detail.tags.map((tag) => tag.name),
            ['새 태그']
        )
        assert.ok(detail.favorite)

        assert.equal(db.select().from(s.maintenanceTasks).all().length, taskCount + 1)
    })

    it('빈 작업·잘못된 이름·모호한 태그 요청을 거부한다', async () => {
        const media = seed()

        for (const changes of [
            { tagChange: {} },
            { tagChange: { addNames: [] } },
            { tagChange: { addNames: ['   '] } },
            { tagChange: { addNames: [1] } },
            {
                tagChange: {
                    addNames: new Array(1)
                }
            },
            {
                tagChange: {
                    removeIds: ['1']
                }
            },
            { tagChange: { unknown: 1 } },
            {
                tagIds: [],
                tagChange: {
                    addNames: ['새 태그']
                }
            }
        ]) {
            failure(
                await handlers['media:edit']({} as IpcMainInvokeEvent, {
                    mediaId: media.media.id,
                    expectedRevision: 0,
                    ...changes
                }),
                'INVALID_ARGUMENT'
            )
        }

        assert.deepEqual(repository.get(media.media.id), media)
        assert.deepEqual(masterTags(), [])
    })

    it('오래된 revision은 새 태그를 생성하지 않는다', async () => {
        const media = seed()

        repository.edit(media.media.id, 0, { customTitle: '최신' })

        failure(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                tagChange: {
                    addNames: ['생성 금지']
                }
            }),
            'REVISION_CONFLICT'
        )

        assert.deepEqual(masterTags(), [])
    })

    it('연결되지 않은 태그 제거가 섞이면 신규 태그도 반영하지 않는다', async () => {
        const media = seed()

        failure(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                customTitle: '반영 금지',
                tagChange: {
                    removeIds: [999],
                    addNames: ['반영 금지']
                }
            }),
            'INVALID_ARGUMENT'
        )

        assert.deepEqual(masterTags(), [])
        assert.deepEqual(repository.get(media.media.id), media)
    })

    it('기존 태그의 공백·빈 이름·ID를 임의로 정규화하지 않는다', async () => {
        const media = seed()

        const old = db
            .insert(s.tags)
            .values({
                id: -7,
                name: ' 기존 '
            })
            .returning()
            .get()

        const empty = db.insert(s.tags).values({ name: '' }).returning().get()

        repository.edit(media.media.id, 0, { tagIds: [old.id, empty.id] })

        data(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 1,
                tagChange: {
                    addNames: ['추가']
                }
            })
        )

        const tags = repository.get(media.media.id)!.tags

        assert.ok(tags.some((tag) => tag.id === old.id && tag.name === ' 기존 '))
        assert.ok(tags.some((tag) => tag.id === empty.id && tag.name === ''))
    })

    it('검색 작업 기록 실패는 태그 생성·연결·제목·즐겨찾기까지 롤백한다', async () => {
        const media = seed(true)

        sqlite.exec(`
            CREATE TRIGGER injected_failure
            BEFORE INSERT ON maintenance_task
            WHEN NEW.kind = 'search_reindex'
            BEGIN
                SELECT RAISE(ABORT, 'injected');
            END
        `)

        failure(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                customTitle: '반영 금지',
                isFavorite: false,
                tagChange: {
                    addNames: ['반영 금지']
                }
            }),
            'INTERNAL_ERROR'
        )

        assert.deepEqual(masterTags(), [])
        assert.deepEqual(repository.get(media.media.id), media)
    })

    it('커밋 중에는 태그 편집을 막는다', async () => {
        const media = seed()

        db.insert(s.downloadQueue)
            .values({
                id: 'job',
                requestUrlId: media.media.requestUrlId!,
                originalUrl: 'https://example.invalid/job',
                mode: 'replace',
                targetMediaId: media.media.id,
                state: 'running',
                optionsJson: '{}'
            })
            .run()

        db.insert(s.downloadAttempts)
            .values({
                id: 'attempt',
                jobId: 'job',
                targetMediaId: media.media.id,
                attemptNo: 1,
                trigger: 'manual_initial',
                phase: 'committing',
                startedAt: 1000
            })
            .run()

        failure(
            await api.media.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                tagChange: {
                    addNames: ['반영 금지']
                }
            }),
            'JOB_ACTIVE'
        )

        assert.deepEqual(masterTags(), [])
    })

    it('즐겨찾기 저장소는 서버 필터를 사용하며 해제한 항목의 상세는 유지한다', async () => {
        const media = seed(true)
        seed(false)

        const store = createGalleryStore(api.media, { favoritesOnly: true })

        await store.refresh()

        assert.equal(store.getSnapshot().list.page.total, 1)

        await store.openDetail(media.media.id)

        assert.equal(
            await store.edit({
                mediaId: media.media.id,
                expectedRevision: 0,
                isFavorite: false
            }),
            true
        )

        assert.equal(store.getSnapshot().list.page.total, 0)
        assert.deepEqual(store.getSnapshot().list.page.data, [])
        assert.equal(store.getSnapshot().detail.data!.isFavorite, false)

        assert.ok(
            calls
                .filter((call) => call.channel === 'media:list')
                .every(
                    (call) =>
                        (
                            call.args[0] as {
                                favoritesOnly: boolean
                            }
                        ).favoritesOnly
                )
        )

        await store.unregisterMedia({
            mediaId: media.media.id,
            expectedRevision: 1
        })

        assert.equal(store.getSnapshot().list.page.total, 0)
    })

    it('추가 로드 후 즐겨찾기를 해제해도 나머지 목록과 상세를 유지한다', async () => {
        for (let i = 0; i < 51; i++) {
            seed(true)
        }

        const store = createGalleryStore(api.media, {
            favoritesOnly: true
        })

        // 첫 50개 조회
        await store.refresh()
        assert.equal(store.getSnapshot().list.page.data.length, 50)

        // 나머지 1개 추가 조회
        await store.loadMore()
        assert.equal(store.getSnapshot().list.page.data.length, 51)
        assert.equal(store.getSnapshot().list.nextOffset, 51)

        const media = store.getSnapshot().list.page.data.at(-1)!

        await store.openDetail(media.id)

        assert.equal(
            await store.edit({
                mediaId: media.id,
                expectedRevision: media.revision,
                isFavorite: false
            }),
            true
        )

        const state = store.getSnapshot()

        assert.equal(state.list.page.total, 50)
        assert.equal(state.list.page.data.length, 50)
        assert.equal(state.list.nextOffset, 50)
        assert.equal(state.list.page.hasNextPage, false)

        assert.equal(
            state.list.page.data.some((item) => item.id === media.id),
            false
        )

        // 목록에서 빠져도 열린 상세는 유지
        assert.equal(state.detail.data?.id, media.id)
        assert.equal(state.detail.data?.isFavorite, false)
    })

    it('화면 저장소의 태그 변경도 기존 태그를 보존하며 IPC를 통과한다', async () => {
        const media = seed()
        const store = createGalleryStore(api.media)

        await store.openDetail(media.media.id)

        await store.edit({
            mediaId: media.media.id,
            expectedRevision: 0,
            tagChange: {
                addNames: ['첫 태그']
            }
        })

        await store.edit({
            mediaId: media.media.id,
            expectedRevision: 1,
            tagChange: {
                addNames: ['둘째 태그']
            }
        })

        assert.deepEqual(
            store.getSnapshot().detail.data!.tags.map((tag) => tag.name),
            ['첫 태그', '둘째 태그']
        )
    })
})
