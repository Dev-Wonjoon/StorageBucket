import assert from 'node:assert/strict'
import type { IpcMainInvokeEvent } from 'electron'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { MediaRepository, type FileInput, type V2Database } from '@features/media/MediaRepository'
import { MediaService } from '@features/media/MediaService'
import { createMediaHandlers } from '@features/media/MediaHandler'
import { createAppApi, type IpcTransport } from '../../../src/preload/api'
import type { MediaFilter, MediaResult } from '../../../src/shared/media-v2'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: MediaRepository
let service: MediaService
let api: ReturnType<typeof createAppApi>
let serial: number

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

    repo = new MediaRepository(db, () => 1_800_000_000_000)

    service = new MediaService(repo, () => {})
    serial = 0

    const handlers = createMediaHandlers(() => service)

    const transport: IpcTransport = {
        async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
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

function file(position = 0, extra: Partial<FileInput> = {}): FileInput {
    return {
        fileKey: 'file-' + position,
        position,
        storageKind: 'app_managed',
        kind: 'image',
        filepath: 'C:/fixture/' + position + '.png',
        ...extra
    }
}

function seed(title = '기본 제목', files = [file()], isFavorite = false) {
    const name = ++serial

    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/request-' + name,
            normalizedUrl: 'https://example.invalid/canonical-' + name,
            normalizationVersion: 1
        })
        .returning()
        .get()

    return repo.register({
        sourceKind: 'download',
        requestUrlId: url.id,
        sourceTitle: title,
        files,
        isFavorite
    })
}

function profile(platformName: string, ownerName: string, ownerId: string) {
    const platform = db.insert(s.platforms).values({ name: platformName }).returning().get()

    const author = db
        .insert(s.profiles)
        .values({
            ownerId,
            ownerName,
            platformId: platform.id
        })
        .returning()
        .get()

    return {
        platformId: platform.id,
        profileId: author.id
    }
}

async function found(filter: MediaFilter) {
    return data(await api.media.list({ filter })).data.map((row) => row.id)
}

describe('parent media search', () => {
    it('여러 자식이 일치해도 부모 개수와 페이지를 중복 계산하지 않는다', async () => {
        const a = seed('a', [file(0, { title: 'match' }), file(1, { title: 'match' })])

        const b = seed('b', [file(0, { title: 'match' })])

        seed('other')

        const first = data(
            await api.media.list({
                filter: { keyword: 'MATCH' },
                limit: 1
            })
        )

        assert.equal(first.total, 2)
        assert.equal(first.hasNextPage, true)
        assert.equal(first.data[0].id, b.media.id)

        const second = data(
            await api.media.list({
                filter: { keyword: 'match' },
                limit: 1,
                offset: 1
            })
        )

        assert.equal(second.total, 2)
        assert.equal(second.hasNextPage, false)
        assert.equal(second.data[0].id, a.media.id)
        assert.equal(second.data[0].fileCount, 2)
    })

    it('부모 제목·사용자 제목·요청 URL·정규화 URL을 검색한다', async () => {
        const a = seed('원본제목')

        repo.edit(a.media.id, a.media.revision, { customTitle: '사용자제목' })

        for (const keyword of ['원본제목', '사용자제목', 'request-1', 'canonical-1']) {
            assert.deepEqual(await found({ keyword }), [a.media.id])
        }
    })

    it('자식 제목·원본 URL·외부 ID·작성자 이름/ID·플랫폼을 검색한다', async () => {
        const author = profile('SamplePlatform', '작가명', 'creator-123')

        const a = seed('a', [
            file(0, {
                ...author,
                title: 'child-title',
                sourceUrl: 'https://source.invalid/item',
                externalId: 'external-456'
            })
        ])

        for (const keyword of [
            'child-title',
            'source.invalid',
            'external-456',
            '작가명',
            'creator-123',
            'sampleplatform'
        ]) {
            assert.deepEqual(await found({ keyword }), [a.media.id])
        }
    })

    it('legacy 부모에 남은 자식의 옛 URL도 검색한다', async () => {
        const url = db
            .insert(s.downloadUrls)
            .values({
                url: 'https://legacy.invalid/original',
                normalizedUrl: 'https://legacy.invalid/normalized',
                normalizationVersion: 1
            })
            .returning()
            .get()

        const parent = db
            .insert(s.medias)
            .values({
                sourceKind: 'legacy'
            })
            .returning()
            .get()

        db.insert(s.mediaFiles)
            .values({
                ...file(0),
                mediaId: parent.id,
                legacyUrlId: url.id,
                storageKind: 'unverified_legacy'
            })
            .run()

        assert.deepEqual(
            await found({
                keyword: 'legacy.invalid/original'
            }),
            [parent.id]
        )

        assert.deepEqual(
            await found({
                keyword: 'legacy.invalid/normalized'
            }),
            [parent.id]
        )
    })

    it('태그는 정확히 비교하고 AND/OR 및 중복 입력을 처리한다', async () => {
        const a = seed('a')
        const b = seed('b')

        repo.edit(a.media.id, 0, {
            tagChange: {
                addNames: ['red', 'blue']
            }
        })

        repo.edit(b.media.id, 0, {
            tagChange: {
                addNames: ['red']
            }
        })

        assert.deepEqual(
            await found({
                tags: ['red', 'blue', 'red']
            }),
            [a.media.id]
        )

        assert.deepEqual(
            await found({
                tags: ['red', 'blue'],
                tagMode: 'or'
            }),
            [b.media.id, a.media.id]
        )

        assert.deepEqual(await found({ tags: ['re'] }), [])

        assert.deepEqual(await found({ keyword: 'blue' }), [a.media.id])
    })

    it('기존 태그 이름의 앞뒤 공백을 보존한다', async () => {
        const a = seed()

        const tag = db.insert(s.tags).values({ name: ' old ' }).returning().get()

        db.insert(s.mediaTags)
            .values({
                mediaId: a.media.id,
                tagId: tag.id
            })
            .run()

        assert.deepEqual(await found({ tags: [' old '] }), [a.media.id])

        assert.deepEqual(await found({ tags: ['old'] }), [])
    })

    it('작성자와 플랫폼은 같은 자식에서 일치해야 한다', async () => {
        const alice = profile('Alpha', 'Alice', 'alice-id')

        const bob = profile('Beta', 'Bob', 'bob-id')

        const a = seed('a', [file(0, alice), file(1, bob)])

        assert.deepEqual(
            await found({
                platforms: ['Alpha'],
                authors: ['Bob']
            }),
            []
        )

        assert.deepEqual(
            await found({
                platforms: ['Alpha'],
                authors: ['ali']
            }),
            [a.media.id]
        )

        assert.deepEqual(
            await found({
                platforms: ['Beta'],
                authors: ['missing', 'bob-id']
            }),
            [a.media.id]
        )
    })

    it('즐겨찾기와 검색을 함께 적용하고 즐겨찾기 순서를 유지한다', async () => {
        const a = seed('match', [file()], true)

        const b = seed('match', [file()], true)

        seed('match')

        sqlite.prepare('UPDATE favorite SET created_at = ? WHERE media_id = ?').run(3, a.media.id)

        sqlite.prepare('UPDATE favorite SET created_at = ? WHERE media_id = ?').run(2, b.media.id)

        const result = data(
            await api.media.list({
                favoritesOnly: true,
                filter: { keyword: 'match' },
                limit: 1
            })
        )

        assert.equal(result.total, 2)
        assert.equal(result.data[0].id, a.media.id)
        assert.equal(result.hasNextPage, true)
    })

    it('날짜는 밀리초 경계를 포함하고 0도 필터로 적용한다', async () => {
        const a = seed('a')
        const b = seed('b')

        sqlite.prepare('UPDATE media SET created_at = ? WHERE id = ?').run(0, a.media.id)

        sqlite.prepare('UPDATE media SET created_at = ? WHERE id = ?').run(1000, b.media.id)

        assert.deepEqual(
            await found({
                createdFrom: 0,
                createdTo: 0
            }),
            [a.media.id]
        )

        assert.deepEqual(
            await found({
                createdFrom: 1000,
                createdTo: 1000
            }),
            [b.media.id]
        )

        assert.deepEqual(
            await found({
                createdFrom: 1,
                createdTo: 999
            }),
            []
        )
    })

    it('와일드카드·인용부호·검색 문법을 일반 문자열로 처리한다', async () => {
        const a = seed('literal %_ \' OR 1=1 -- "quoted"')

        seed('ordinary')

        for (const keyword of ['%_', "' OR 1=1 --", '"quoted"']) {
            assert.deepEqual(await found({ keyword }), [a.media.id])
        }

        assert.deepEqual(
            await found({
                keyword: 'ordinary OR literal'
            }),
            []
        )
    })

    it('FTS가 없거나 비어 있어도 조회하고 편집 직후 검색한다', async () => {
        const a = seed('before')

        assert.deepEqual(await found({ keyword: 'before' }), [a.media.id])

        sqlite.exec('CREATE VIRTUAL TABLE media_fts USING fts5(title)')

        assert.deepEqual(await found({ keyword: 'before' }), [a.media.id])

        repo.edit(a.media.id, 0, {
            customTitle: 'after'
        })

        assert.deepEqual(await found({ keyword: 'after' }), [a.media.id])

        assert.ok(db.select().from(s.maintenanceTasks).all().length > 0)

        sqlite.exec("INSERT INTO media_fts(title) VALUES ('obsolete-only')")

        assert.deepEqual(
            await found({
                keyword: 'obsolete-only'
            }),
            []
        )
    })

    it('빈 검색은 전체 조회이고 잘못된 입력은 INVALID_ARGUMENT다', async () => {
        seed()

        assert.equal(
            data(
                await api.media.list({
                    filter: {
                        keyword: '  ',
                        tags: []
                    }
                })
            ).total,
            1
        )

        const filters: unknown[] = [
            null,
            [],
            'text',
            { unknown: 1 },
            { keyword: 1 },
            { keyword: 'x'.repeat(1001) },
            { tags: 'red' },
            { tags: [''] },
            { tags: [null] },
            { tags: Array(101).fill('red') },
            { platforms: [1] },
            { authors: [' '] },
            { tagMode: 'xor' },
            { createdFrom: '0' },
            { createdTo: NaN },
            { createdTo: 1.5 },
            {
                createdFrom: 2,
                createdTo: 1
            }
        ]

        for (const filter of filters) {
            const result = await service.list({
                filter
            })

            assert.equal(result.ok, false)

            if (!result.ok) {
                assert.equal(result.error.code, 'INVALID_ARGUMENT')
            }
        }
    })

    describe('media suggestions', () => {
        it('등록된 묶음의 태그·플랫폼·작성자 이름과 ID를 중복 없이 반환한다', async () => {
            const author = profile('Example', 'Alice', 'alice-id')

            const a = seed('a', [file(0, author), file(1, author)])

            const b = seed('b')

            repo.edit(a.media.id, 0, {
                tagChange: {
                    addNames: ['red']
                }
            })

            repo.edit(b.media.id, 0, {
                tagChange: {
                    addNames: ['red']
                }
            })

            db.insert(s.tags).values({ name: 'unused-red' }).run()

            db.insert(s.platforms).values({ name: 'UnusedExample' }).run()

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'tag',
                        text: 're'
                    })
                ),
                ['red']
            )

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'platform',
                        text: 'EXAM'
                    })
                ),
                ['Example']
            )

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'author',
                        text: 'ali'
                    })
                ),
                ['Alice', 'alice-id']
            )
        })

        it('따옴표·와일드카드는 문자열로 비교하며 기존 이름의 공백을 보존한다', async () => {
            const a = seed()

            const tag = db
                .insert(s.tags)
                .values({
                    name: " old %_' "
                })
                .returning()
                .get()

            db.insert(s.mediaTags)
                .values({
                    mediaId: a.media.id,
                    tagId: tag.id
                })
                .run()

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'tag',
                        text: "%_'"
                    })
                ),
                [" old %_' "]
            )

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'tag',
                        text: "' OR 1=1 --"
                    })
                ),
                []
            )
        })

        it('정렬·개수 제한·빈 입력을 처리한다', async () => {
            const a = seed()

            for (const name of ['zeta', 'alpha', 'beta']) {
                const tag = db.insert(s.tags).values({ name }).returning().get()

                db.insert(s.mediaTags)
                    .values({
                        mediaId: a.media.id,
                        tagId: tag.id
                    })
                    .run()
            }

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'tag',
                        text: 'a',
                        limit: 2
                    })
                ),
                ['alpha', 'beta']
            )

            assert.deepEqual(
                data(
                    await api.media.suggest({
                        kind: 'tag',
                        text: '  '
                    })
                ),
                []
            )
        })

        it('직접 IPC로 전달한 잘못된 자동완성 요청도 거부한다', async () => {
            const handlers = createMediaHandlers(() => service)

            for (const request of [
                null,
                [],
                {},
                { kind: 'file', text: 'a' },
                { kind: 'tag', text: 1 },
                {
                    kind: 'tag',
                    text: 'x'.repeat(201)
                },
                {
                    kind: 'tag',
                    text: 'a',
                    limit: 0
                },
                {
                    kind: 'tag',
                    text: 'a',
                    limit: 21
                },
                {
                    kind: 'tag',
                    text: 'a',
                    limit: 1.5
                },
                {
                    kind: 'tag',
                    text: 'a',
                    other: true
                }
            ]) {
                const result = await handlers['media:suggest'](
                    {} as IpcMainInvokeEvent,
                    structuredClone(request)
                )

                assert.equal(result.ok, false)

                if (!result.ok) {
                    assert.equal(result.error.code, 'INVALID_ARGUMENT')
                }
            }
        })

        it('연결 전에는 자동완성도 NOT_READY를 반환한다', async () => {
            const handlers = createMediaHandlers(() => undefined)

            const result = await handlers['media:suggest']({} as IpcMainInvokeEvent, {
                kind: 'tag',
                text: 'a'
            })

            assert.equal(result.ok, false)

            if (!result.ok) {
                assert.equal(result.error.code, 'NOT_READY')
            }
        })
    })
})
