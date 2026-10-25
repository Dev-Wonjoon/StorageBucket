import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import { MediaRepository, type FileInput, type V2Database } from '../../../src/main/repositories/MediaRepository'
import type { MediaErrorCode, MediaResult } from '../../../src/shared/media-v2'
import { MediaService } from '../../../src/main/services/MediaService'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repository: MediaRepository
let service: MediaService
let reported: unknown[]

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

    reported = []

    service = new MediaService(repository, (error) => {
        reported.push(error)
    })
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

function failure<T>(result: MediaResult<T>, code: MediaErrorCode) {
    assert.equal(result.ok, false)

    if (result.ok) {
        throw new Error('Expected failure')
    }

    assert.equal(result.error.code, code)

    return result.error
}

function seed(name = 'a', count = 3) {
    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/' + name,
            normalizedUrl: 'https://example.invalid/' + name,
            normalizationVersion: 1
        })
        .returning()
        .get()

    const files: FileInput[] = Array.from({ length: count }, (_, position) => ({
        fileKey: 'file-' + position,
        position,
        kind: 'image',
        storageKind: 'app_managed',
        title: '파일 ' + position,
        filepath: 'C:/fixture/' + name + '/' + position + '.png'
    }))

    return repository.register({
        sourceKind: 'download',
        requestUrlId: url.id,
        sourceTitle: name,
        files
    })
}

describe('MediaServiceV2', () => {
    it('부모 목록을 독립 DTO로 반환하고 부모 단위로 페이지화한다', () => {
        seed('a')
        const b = seed('b')

        const result = data(service.list({ limit: 1 }))

        assert.equal(result.total, 2)
        assert.equal(result.hasNextPage, true)
        assert.equal(result.data[0].id, b.media.id)
        assert.equal(result.data[0].title, 'b')
        assert.equal(result.data[0].fileCount, 3)
        assert.equal(result.data[0].createdAt, 1_800_000_000_000)
        assert.equal('media' in result.data[0], false)
        assert.deepEqual(structuredClone(result), result)
    })

    it('자식 상세를 position 순서로 DB에서 페이지화한다', () => {
        const a = seed()

        const first = data(
            service.get({
                mediaId: a.media.id,
                fileLimit: 2
            })
        )

        assert.deepEqual(
            first.files.data.map((f) => f.position),
            [0, 1]
        )
        assert.equal(first.files.total, 3)
        assert.equal(first.files.hasNextPage, true)

        const last = data(
            service.get({
                mediaId: a.media.id,
                fileLimit: 2,
                fileOffset: 2
            })
        )

        assert.deepEqual(
            last.files.data.map((f) => f.position),
            [2]
        )
        assert.equal(last.files.hasNextPage, false)

        const empty = data(
            service.get({
                mediaId: a.media.id,
                fileOffset: 99
            })
        )

        assert.deepEqual(empty.files.data, [])
        assert.equal(empty.files.total, 3)
        assert.equal(empty.files.hasNextPage, false)
    })

    it('기존 get의 전체 상세 반환을 유지한다', () => {
        const a = seed()

        assert.equal(repository.get(a.media.id)!.files.length, 3)
        assert.equal(repository.getPage(999), undefined)
    })

    it('숫자 시각과 NULL을 보존하고 내부 이관·해시 정보는 DTO에 노출하지 않는다', () => {
        const a = seed()

        sqlite.prepare('UPDATE media SET updated_at = NULL WHERE id = ?').run(a.media.id)

        const result = data(
            service.get({
                mediaId: a.media.id
            })
        )

        assert.equal(result.updatedAt, null)
        assert.equal(result.files.data[0].filesize, null)
        assert.equal(result.files.data[0].duration, null)
        assert.equal('legacyUrlId' in result.files.data[0], false)
        assert.equal('canonicalPathKey' in result.files.data[0], false)
        assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
        assert.deepEqual(structuredClone(result), result)
    })

    it('잘못된 목록·상세 요청을 저장소 호출 전에 거부한다', () => {
        for (const request of [
            null,
            [],
            new Date(),
            { limit: 0 },
            { limit: 201 },
            { offset: -1 },
            { limit: 2.5 },
            { offset: Number.MAX_SAFE_INTEGER },
            { unknown: 1 }
        ]) {
            failure(service.list(request), 'INVALID_ARGUMENT')
        }

        for (const request of [
            null,
            1,
            {},
            { mediaId: '1' },
            { mediaId: NaN },
            { mediaId: 1, fileLimit: 201 },
            { mediaId: 1, fileOffset: -1 }
        ]) {
            failure(service.get(request), 'INVALID_ARGUMENT')
        }

        assert.deepEqual(reported, [])
    })

    it('없는 부모는 명시적인 NOT_FOUND 응답을 반환한다', () => {
        const result = failure(service.get({ mediaId: 999 }), 'NOT_FOUND')

        assert.deepEqual(result.context, { mediaId: 999 })

        failure(
            service.edit({
                mediaId: 999,
                expectedRevision: 0,
                customTitle: 'x'
            }),
            'NOT_FOUND'
        )

        failure(
            service.unregisterMedia({
                mediaId: 999,
                expectedRevision: 0
            }),
            'NOT_FOUND'
        )
    })

    it('제목·표지·태그·즐겨찾기를 한 번에 편집하고 새 revision을 반환한다', () => {
        const a = seed()

        const tag = db.insert(s.tags).values({ name: '태그' }).returning().get()

        const result = data(
            service.edit({
                mediaId: a.media.id,
                expectedRevision: 0,
                customTitle: '사용자 제목',
                cover: {
                    mode: 'manual',
                    fileId: a.files[2].id
                },
                tagIds: [tag.id, tag.id],
                isFavorite: true
            })
        )

        assert.equal(result.title, '사용자 제목')
        assert.equal(result.revision, 1)
        assert.equal(result.cover!.fileId, a.files[2].id)

        const detail = data(
            service.get({
                mediaId: a.media.id
            })
        )

        assert.deepEqual(detail.tags, [{ id: tag.id, name: tag.name }])
        assert.equal(detail.isFavorite, true)
        assert.ok(detail.favorite)

        const reset = data(
            service.edit({
                mediaId: a.media.id,
                expectedRevision: 1,
                customTitle: null,
                cover: { mode: 'auto' },
                tagIds: [],
                isFavorite: false
            })
        )

        assert.equal(reset.title, 'a')
        assert.equal(reset.revision, 2)
        assert.equal(reset.coverMode, 'auto')
        assert.equal(reset.isFavorite, false)
    })

    it('revision 생략·형식 오류·알 수 없는 필드·빈 편집을 거부한다', () => {
        const a = seed()

        for (const request of [
            {
                mediaId: a.media.id,
                customTitle: 'x'
            },
            {
                mediaId: a.media.id,
                expectedRevision: '0',
                customTitle: 'x'
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                sourceTitle: '변조'
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                customTitle: false
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                tagIds: ['1']
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                tagIds: new Array(1)
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                isFavorite: 1
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                cover: {
                    mode: 'auto',
                    fileId: 1
                }
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                cover: { mode: 'manual' }
            }
        ]) {
            failure(service.edit(request), 'INVALID_ARGUMENT')
        }

        assert.deepEqual(repository.get(a.media.id), a)
    })

    it('오래된 revision을 최신값으로 대체하지 않고 충돌 정보를 반환한다', () => {
        const a = seed()

        data(
            service.edit({
                mediaId: a.media.id,
                expectedRevision: 0,
                customTitle: '최신'
            })
        )

        const result = failure(
            service.edit({
                mediaId: a.media.id,
                expectedRevision: 0,
                customTitle: '과거'
            }),
            'REVISION_CONFLICT'
        )

        assert.deepEqual(result.context, {
            mediaId: a.media.id,
            expectedRevision: 0,
            actualRevision: 1
        })

        assert.deepEqual(structuredClone(result), result)

        assert.equal(repository.get(a.media.id)!.displayTitle, '최신')

        failure(
            service.unregisterFiles({
                mediaId: a.media.id,
                expectedRevision: 0,
                fileIds: [a.files[0].id]
            }),
            'REVISION_CONFLICT'
        )

        failure(
            service.unregisterMedia({
                mediaId: a.media.id,
                expectedRevision: 0
            }),
            'REVISION_CONFLICT'
        )
    })

    it('다른 부모 표지 오류는 구조화해서 전달한다', () => {
        const a = seed('a')
        const b = seed('b')

        failure(
            service.edit({
                mediaId: a.media.id,
                expectedRevision: 0,
                cover: {
                    mode: 'manual',
                    fileId: b.files[0].id
                }
            }),
            'INVALID_COVER'
        )

        assert.deepEqual(repository.get(a.media.id), a)
    })

    it('등록 해제에는 revision과 명시적인 파일 목록이 필요하다', () => {
        const a = seed()

        for (const request of [
            {
                mediaId: a.media.id,
                fileIds: [a.files[0].id]
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                fileIds: []
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                fileIds: ['1']
            },
            {
                mediaId: a.media.id,
                expectedRevision: 0,
                fileIds: [NaN]
            }
        ]) {
            failure(service.unregisterFiles(request), 'INVALID_ARGUMENT')
        }

        failure(
            service.unregisterMedia({
                mediaId: a.media.id
            }),
            'INVALID_ARGUMENT'
        )

        assert.deepEqual(repository.get(a.media.id), a)
    })

    it('일부 자식 제거와 마지막 자식 제거를 구분하고 정리 작업 ID를 반환한다', () => {
        const a = seed('a', 2)

        const partial = data(
            service.unregisterFiles({
                mediaId: a.media.id,
                expectedRevision: 0,
                fileIds: [a.files[0].id, a.files[0].id]
            })
        )

        assert.equal(partial.parentRemoved, false)
        assert.equal(partial.revision, 1)
        assert.ok(partial.cleanupTaskId)

        const last = data(
            service.unregisterFiles({
                mediaId: a.media.id,
                expectedRevision: 1,
                fileIds: [a.files[1].id]
            })
        )

        assert.equal(last.parentRemoved, true)
        assert.equal(last.revision, null)
        assert.ok(last.cleanupTaskId)

        failure(
            service.get({
                mediaId: a.media.id
            }),
            'NOT_FOUND'
        )
    })

    it('묶음 등록 해제 결과도 직렬화할 수 있다', () => {
        const a = seed()

        const result = service.unregisterMedia({
            mediaId: a.media.id,
            expectedRevision: 0
        })

        assert.equal(data(result).parentRemoved, true)
        assert.deepEqual(structuredClone(result), result)
        assert.equal(repository.get(a.media.id), undefined)
    })

    it('실행 중 삭제 오류를 전달하고 부모를 보존한다', () => {
        const a = seed()

        db.insert(s.downloadQueue)
            .values({
                id: 'job',
                requestUrlId: a.media.requestUrlId!,
                originalUrl: 'https://example.invalid/a',
                mode: 'replace',
                targetMediaId: a.media.id,
                targetMediaIdSnapshot: a.media.id,
                state: 'running',
                optionsJson: '{}'
            })
            .run()

        failure(
            service.unregisterMedia({
                mediaId: a.media.id,
                expectedRevision: 0
            }),
            'JOB_ACTIVE'
        )

        assert.deepEqual(repository.get(a.media.id), a)
    })

    it('예상하지 못한 DB 오류는 내부에 기록하고 SQL·경로를 응답에 노출하지 않는다', () => {
        const a = seed()

        sqlite.exec(`
      CREATE TRIGGER injected_failure
      BEFORE UPDATE ON media
      BEGIN
        SELECT RAISE(
          ABORT,
          'private C:/secret/example.db'
        );
      END
    `)

        const result = service.edit({
            mediaId: a.media.id,
            expectedRevision: 0,
            customTitle: '실패'
        })

        failure(result, 'INTERNAL_ERROR')

        assert.equal(reported.length, 1)
        assert.equal(JSON.stringify(result).includes('C:/secret'), false)
        assert.deepEqual(repository.get(a.media.id), a)

        const brokenLogger = new MediaService(repository, () => {
            throw new Error('logger')
        })

        failure(
            brokenLogger.edit({
                mediaId: a.media.id,
                expectedRevision: 0,
                customTitle: '실패'
            }),
            'INTERNAL_ERROR'
        )
    })
})
