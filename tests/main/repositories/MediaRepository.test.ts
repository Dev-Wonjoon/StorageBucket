import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import {
  generateSQLiteDrizzleJson,
  generateSQLiteMigration
} from 'drizzle-kit/api'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it
} from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import {
  MediaRepository,
  MediaRepositoryError,
  type DeletionCleanupPayload,
  type FileInput,
  type V2Database
} from '@features/media/MediaRepository'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: MediaRepository

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
  repo = new MediaRepository(
    db,
    () => 1_800_000_000_000
  )
})

afterEach(() => {
  if (!sqlite?.open) return

  try {
    assert.deepEqual(
      sqlite.pragma('foreign_key_check'),
      []
    )
  } finally {
    sqlite.close()
  }
})

function error(code: string) {
  return (value: unknown) =>
    value instanceof MediaRepositoryError &&
    value.code === code
}

function file(
  position = 0,
  extra: Partial<FileInput> = {}
): FileInput {
  return {
    fileKey: 'file-' + position,
    position,
    storageKind: 'app_managed',
    kind: 'image',
    filepath:
      'C:/fixture/managed/' + position + '.png',
    title: '파일 ' + position,
    ...extra
  }
}

function request(name: string) {
  return db
    .insert(s.downloadUrls)
    .values({
      url: 'https://example.invalid/' + name,
      normalizedUrl:
        'https://example.invalid/' + name,
      normalizationVersion: 1
    })
    .returning()
    .get()
}

function downloaded(
  name = 'a',
  files = [file()]
) {
  return repo.register({
    sourceKind: 'download',
    requestUrlId: request(name).id,
    sourceTitle: '원본 ' + name,
    files
  })
}

function localInput(
  name: string,
  pathKey = name + '/a'
) {
  return {
    sourceKind: 'local' as const,
    folder: {
      sourceTitle: name,
      directoryPath: 'C:/fixture/' + name,
      directoryKey: name,
      keyVersion: 1
    },
    files: [
      file(0, {
        storageKind: 'external_reference',
        filepath:
          'C:/fixture/' + pathKey + '.png',
        canonicalPathKey: pathKey,
        relativePath: 'a.png',
        filesize: 12,
        mtimeNs: '1800000000000000000',
        hashAlgorithm: 'sha256',
        contentHash: 'a'.repeat(64),
        detectedFormat: 'PNG',
        width: 10,
        height: 10
      })
    ]
  }
}

function tasks() {
  return db
    .select()
    .from(s.maintenanceTasks)
    .all()
}

function cleanup(taskId: string | null) {
  assert.ok(taskId)

  const task = db
    .select()
    .from(s.maintenanceTasks)
    .where(eq(s.maintenanceTasks.id, taskId))
    .get()!

  return JSON.parse(
    task.payloadJson
  ) as DeletionCleanupPayload
}

function downloadJob(
  mediaId: number,
  urlId: number
) {
  db.insert(s.downloadQueue)
    .values({
      id: 'job',
      requestUrlId: urlId,
      originalUrl: 'https://example.invalid/job',
      mode: 'replace',
      targetMediaId: mediaId,
      targetMediaIdSnapshot: mediaId,
      state: 'running',
      optionsJson: '{}'
    })
    .run()

  db.insert(s.downloadAttempts)
    .values({
      id: 'attempt',
      jobId: 'job',
      attemptNo: 1,
      targetMediaId: mediaId,
      targetMediaIdSnapshot: mediaId,
      trigger: 'manual_initial',
      phase: 'downloading',
      startedAt: 1000
    })
    .run()

  sqlite.exec(`
    UPDATE download_queue
    SET current_attempt_id = 'attempt'
  `)
}

function localJob(
  directoryKey: string,
  localFolderId: number | null
) {
  db.insert(s.localImportJobs)
    .values({
      id: 'import',
      rootPath: 'C:/fixture',
      rootKey: 'root',
      state: 'running',
      countsJson: '{}'
    })
    .run()

  db.insert(s.localImportFolders)
    .values({
      id: 'folder',
      jobId: 'import',
      directoryPath:
        'C:/fixture/' + directoryKey,
      directoryKey,
      relativePath: directoryKey,
      localFolderId,
      state: 'running'
    })
    .run()

  db.insert(s.localImportAttempts)
    .values({
      id: 'local-attempt',
      importFolderId: 'folder',
      attemptNo: 1,
      phase: 'inspecting',
      commitToken: 'token',
      startedAt: 1000
    })
    .run()

  sqlite.exec(`
    UPDATE local_import_folder
    SET current_attempt_id = 'local-attempt'
  `)
}

describe('MediaRepository v2', () => {
  it('부모 기준으로 집계·페이지를 만들고 자식은 position 순서로 반환한다', () => {
    const a = downloaded(
      'a',
      [file(3), file(0), file(1)]
    )
    const b = downloaded('b')

    const page = repo.list({ limit: 1 })

    assert.equal(page.total, 2)
    assert.equal(page.data[0].media.id, b.media.id)
    assert.equal(page.hasNextPage, true)

    const next = repo.list({
      limit: 1,
      offset: 1
    })

    assert.equal(next.data[0].fileCount, 3)
    assert.deepEqual(
      repo.get(a.media.id)!.files.map(f => f.position),
      [0, 1, 3]
    )
    assert.equal(next.hasNextPage, false)
    assert.equal(repo.get(999), undefined)
  })

  it('제목과 자동 표지는 부모·자식 규칙을 적용한다', () => {
    const value = repo.register({
      sourceKind: 'download',
      requestUrlId: request('cover').id,
      files: [
        file(0, { title: '첫 제목' }),
        file(1, {
          kind: 'video',
          thumbnailPath: 'C:/fixture/video.webp',
          thumbnailOrigin: 'app_generated'
        })
      ]
    })

    assert.equal(value.displayTitle, '첫 제목')
    assert.equal(
      value.cover!.fileId,
      value.files[1].id
    )

    const manual = repo.edit(
      value.media.id,
      0,
      {
        customTitle: '사용자 제목',
        cover: {
          mode: 'manual',
          fileId: value.files[0].id
        }
      }
    )

    assert.equal(manual.displayTitle, '사용자 제목')
    assert.equal(
      manual.cover!.fileId,
      value.files[0].id
    )

    const auto = repo.edit(
      value.media.id,
      1,
      {
        customTitle: null,
        cover: { mode: 'auto' }
      }
    )

    assert.equal(auto.displayTitle, '첫 제목')
    assert.equal(
      auto.cover!.fileId,
      value.files[1].id
    )
  })

  it('다른 부모의 표지는 거부하고 제목 변경도 함께 롤백한다', () => {
    const a = downloaded('a')
    const b = downloaded('b')

    assert.throws(
      () =>
        repo.edit(a.media.id, 0, {
          customTitle: '변경',
          cover: {
            mode: 'manual',
            fileId: b.files[0].id
          }
        }),
      error('INVALID_COVER')
    )

    assert.deepEqual(repo.get(a.media.id), a)
  })

  it('빈 목록과 잘못된 페이지·revision을 거부한다', () => {
    const url = request('empty')

    assert.throws(
      () =>
        repo.register({
          sourceKind: 'download',
          requestUrlId: url.id,
          files: []
        }),
      error('INVALID_ARGUMENT')
    )

    assert.throws(
      () => repo.list({ limit: 0 }),
      error('INVALID_ARGUMENT')
    )

    const a = downloaded()

    assert.throws(
      () =>
        repo.edit(a.media.id, -1, {
          customTitle: 'x'
        }),
      error('INVALID_ARGUMENT')
    )

    assert.throws(
      () => repo.edit(a.media.id, 0, {}),
      error('INVALID_ARGUMENT')
    )

    assert.equal(repo.list().total, 1)
  })

  it('중간 자식 삽입 실패는 부모·자식·유지보수를 모두 롤백한다', () => {
    const url = request('duplicate')

    assert.throws(() =>
      repo.register({
        sourceKind: 'download',
        requestUrlId: url.id,
        files: [file(), file()],
        isFavorite: true
      })
    )

    assert.equal(repo.list().total, 0)
    assert.deepEqual(
      db.select().from(s.mediaFiles).all(),
      []
    )
    assert.deepEqual(tasks(), [])
  })

  it('잘못된 태그의 FK 실패도 등록 전체를 롤백한다', () => {
    assert.throws(() =>
      repo.register({
        sourceKind: 'download',
        requestUrlId: request('tag').id,
        files: [file()],
        tagIds: [999],
        isFavorite: true
      })
    )

    assert.equal(repo.list().total, 0)
    assert.deepEqual(tasks(), [])
  })

  it('같은 요청 URL의 부모를 중복 생성하거나 자동 병합하지 않는다', () => {
    const a = downloaded()

    assert.throws(() =>
      repo.register({
        sourceKind: 'download',
        requestUrlId: a.media.requestUrlId!,
        files: [file(1)]
      })
    )

    assert.deepEqual(repo.get(a.media.id), a)
    assert.equal(repo.list().total, 1)
  })

  it('추가·편집 시 ID·수동 표지·태그·즐겨찾기 ID를 보존한다', () => {
    const a = downloaded()

    const tag = db
      .insert(s.tags)
      .values({ name: '보존' })
      .returning()
      .get()

    const edited = repo.edit(
      a.media.id,
      0,
      {
        customTitle: '사용자',
        tagIds: [tag.id, tag.id],
        isFavorite: true,
        cover: {
          mode: 'manual',
          fileId: a.files[0].id
        }
      }
    )

    const appended = repo.addFiles(
      a.media.id,
      1,
      [file(1)]
    )

    const again = repo.edit(
      a.media.id,
      2,
      {
        tagIds: [tag.id],
        isFavorite: true
      }
    )

    assert.equal(
      appended.media.customTitle,
      '사용자'
    )
    assert.equal(
      appended.media.coverFileId,
      a.files[0].id
    )
    assert.equal(
      appended.files[0].id,
      a.files[0].id
    )
    assert.equal(
      again.favorite!.id,
      edited.favorite!.id
    )
    assert.deepEqual(again.tags, edited.tags)
    assert.equal(again.media.revision, 3)

    const removed = repo.edit(
      a.media.id,
      3,
      {
        tagIds: [],
        isFavorite: false
      }
    )

    assert.deepEqual(removed.tags, [])
    assert.equal(removed.favorite, null)
    assert.equal(
      db.select().from(s.tags).all().length,
      1
    )
  })

  it('오래된 revision의 편집·추가·삭제는 아무 결과도 반영하지 않는다', () => {
    const a = downloaded()

    repo.edit(a.media.id, 0, {
      customTitle: '최신'
    })

    const before = repo.get(a.media.id)
    const pending = tasks()

    for (const action of [
      () =>
        repo.edit(a.media.id, 0, {
          customTitle: '과거'
        }),
      () =>
        repo.addFiles(
          a.media.id,
          0,
          [file(1)]
        ),
      () =>
        repo.unregisterFiles(
          a.media.id,
          0,
          [a.files[0].id]
        ),
      () => repo.unregisterMedia(a.media.id, 0)
    ]) {
      assert.throws(
        action,
        error('REVISION_CONFLICT')
      )
    }

    assert.deepEqual(repo.get(a.media.id), before)
    assert.deepEqual(tasks(), pending)
  })

  it('로컬 폴더 단위로 등록하고 동일 내용의 다른 경로를 허용한다', () => {
    const a = repo.register(localInput('a'))
    const b = repo.register(localInput('b'))

    assert.ok(
      a.localFolder &&
      a.locations.length === 1
    )

    assert.equal(
      a.files[0].localFolderLocationId,
      a.locations[0].id
    )
    assert.equal(
      a.files[0].contentHash,
      b.files[0].contentHash
    )

    assert.throws(() =>
      repo.register(localInput('c', 'a/a'))
    )

    assert.throws(() =>
      repo.register(localInput('a', 'a/other'))
    )

    assert.equal(repo.list().total, 2)
    assert.equal(
      db.select().from(s.localFolders).all().length,
      2
    )
    assert.deepEqual(repo.get(a.media.id), a)
  })

  it('다른 부모의 로컬 위치 또는 불완전한 검사 정보로 추가하지 않는다', () => {
    const a = repo.register(localInput('a'))
    const b = repo.register(localInput('b'))

    const extra = {
      ...localInput('c').files[0],
      position: 1,
      fileKey: 'new'
    }

    assert.throws(
      () =>
        repo.addFiles(
          a.media.id,
          0,
          [extra],
          b.locations[0].id
        ),
      error('INVALID_LOCATION')
    )

    assert.throws(() =>
      repo.addFiles(
        a.media.id,
        0,
        [{ ...extra, width: null }],
        a.locations[0].id
      )
    )

    assert.deepEqual(repo.get(a.media.id), a)
  })

  it('추가 도중 중복이면 앞서 추가한 자식과 revision도 롤백한다', () => {
    const a = downloaded()

    assert.throws(() =>
      repo.addFiles(
        a.media.id,
        0,
        [file(1), file(0)]
      )
    )

    assert.deepEqual(repo.get(a.media.id), a)
  })

  it('선택 표지 제거 시 자동으로 복귀하고 남은 파일·관계는 보존한다', () => {
    const a = downloaded(
      'a',
      [file(0), file(1)]
    )

    const edited = repo.edit(
      a.media.id,
      0,
      {
        cover: {
          mode: 'manual',
          fileId: a.files[1].id
        },
        isFavorite: true
      }
    )

    const result = repo.unregisterFiles(
      a.media.id,
      1,
      [a.files[1].id]
    )

    assert.equal(result.parentRemoved, false)

    const after = repo.get(a.media.id)!

    assert.equal(after.media.coverMode, 'auto')
    assert.equal(after.media.coverFileId, null)
    assert.equal(
      after.files[0].id,
      a.files[0].id
    )
    assert.equal(
      after.favorite!.id,
      edited.favorite!.id
    )
    assert.equal(after.media.revision, 2)
  })

  it('다른 부모 파일이 섞인 제거는 부분 적용하지 않는다', () => {
    const a = downloaded(
      'a',
      [file(0), file(1)]
    )
    const b = downloaded('b')

    assert.throws(
      () =>
        repo.unregisterFiles(
          a.media.id,
          0,
          [a.files[0].id, b.files[0].id]
        ),
      error('FILE_NOT_FOUND')
    )

    assert.deepEqual(repo.get(a.media.id), a)
  })

  it('마지막 로컬 자식 제거는 부모·폴더·관계도 같은 커밋에서 제거한다', () => {
    const a = repo.register(localInput('a'))

    const tag = db
      .insert(s.tags)
      .values({ name: '마스터' })
      .returning()
      .get()

    repo.edit(a.media.id, 0, {
      tagIds: [tag.id],
      isFavorite: true,
      cover: {
        mode: 'manual',
        fileId: a.files[0].id
      }
    })

    const result = repo.unregisterFiles(
      a.media.id,
      1,
      [a.files[0].id]
    )

    assert.equal(result.parentRemoved, true)
    assert.equal(result.revision, null)
    assert.equal(result.cleanupTaskId, null)
    assert.equal(repo.get(a.media.id), undefined)

    for (const table of [
      s.mediaFiles,
      s.localFolders,
      s.localFolderLocations,
      s.mediaTags,
      s.favorites
    ]) {
      assert.deepEqual(
        db.select().from(table).all(),
        []
      )
    }

    assert.equal(
      db.select().from(s.tags).all().length,
      1
    )
  })

  it('앱 원본·생성 썸네일만 정리 후보로 기록하고 preview는 보호한다', () => {
    const a = downloaded('a', [
      file(0, {
        thumbnailPath:
          'C:/fixture/cache/thumb.webp',
        thumbnailOrigin: 'app_generated',
        previewPath:
          'C:/fixture/cache/preview.png'
      })
    ])

    const result = repo.unregisterMedia(
      a.media.id,
      0
    )

    const payload = cleanup(result.cleanupTaskId)

    assert.deepEqual(
      payload.candidates.map(c => c.role),
      ['original', 'thumbnail']
    )

    assert.deepEqual(
      payload.unverifiedPreviews,
      [
        {
          fileId: a.files[0].id,
          path: 'C:/fixture/cache/preview.png'
        }
      ]
    )

    assert.ok(
      payload.protectedPaths.includes(
        'C:/fixture/cache/preview.png'
      )
    )

    assert.equal(repo.get(a.media.id), undefined)
  })

  it('외부 원본과 소유 미확인 원본·썸네일은 삭제 후보에서 제외한다', () => {
    const input = localInput('local')

    input.files[0].thumbnailPath =
      'C:/fixture/cache/local.webp'
    input.files[0].thumbnailOrigin =
      'app_generated'

    const a = repo.register(input)

    const payload = cleanup(
      repo.unregisterMedia(
        a.media.id,
        0
      ).cleanupTaskId
    )

    assert.deepEqual(
      payload.candidates.map(c => c.role),
      ['thumbnail']
    )

    assert.ok(
      payload.protectedPaths.includes(
        a.files[0].filepath
      )
    )

    const parent = db
      .insert(s.medias)
      .values({
        sourceKind: 'legacy',
        customTitle: '기존'
      })
      .returning()
      .get()

    db.insert(s.mediaFiles)
      .values({
        mediaId: parent.id,
        fileKey: 'old',
        kind: 'unknown',
        position: 0,
        storageKind: 'unverified_legacy',
        filepath: 'C:/fixture/old',
        thumbnailPath: 'C:/fixture/old-thumb',
        thumbnailOrigin: 'unverified_legacy'
      })
      .run()

    assert.equal(
      repo.unregisterMedia(
        parent.id,
        0
      ).cleanupTaskId,
      null
    )
  })

  it('생성 썸네일 경로가 제거되는 외부 원본과 같아도 삭제 후보로 남기지 않는다', () => {
    const input = localInput('same')

    input.files[0].thumbnailPath =
      input.files[0].filepath
    input.files[0].thumbnailOrigin =
      'app_generated'

    const a = repo.register(input)

    assert.equal(
      repo.unregisterMedia(
        a.media.id,
        0
      ).cleanupTaskId,
      null
    )
  })

  it('정리 기록 실패는 마지막 자식·부모·표지·태그·즐겨찾기까지 롤백한다', () => {
    const a = downloaded()

    const tag = db
      .insert(s.tags)
      .values({ name: '유지' })
      .returning()
      .get()

    const before = repo.edit(
      a.media.id,
      0,
      {
        isFavorite: true,
        tagIds: [tag.id],
        cover: {
          mode: 'manual',
          fileId: a.files[0].id
        }
      }
    )

    const pending = tasks()

    sqlite.exec(`
      CREATE TRIGGER fail_cleanup
      BEFORE INSERT ON maintenance_task
      WHEN NEW.kind = 'deletion_cleanup'
      BEGIN
        SELECT RAISE(ABORT, 'injected cleanup failure');
      END
    `)

    assert.throws(() =>
      repo.unregisterFiles(
        a.media.id,
        1,
        [a.files[0].id]
      )
    )

    assert.deepEqual(repo.get(a.media.id), before)
    assert.deepEqual(tasks(), pending)
  })

  it('검색 작업 기록 실패는 편집을 롤백하고 FTS 자체는 요구하지 않는다', () => {
    const a = downloaded()

    assert.equal(tasks()[0].state, 'pending')
    assert.equal(tasks()[0].kind, 'search_reindex')

    sqlite.exec(`
      CREATE TRIGGER fail_search
      BEFORE INSERT ON maintenance_task
      WHEN NEW.kind = 'search_reindex'
      BEGIN
        SELECT RAISE(ABORT, 'injected search failure');
      END
    `)

    assert.throws(() =>
      repo.edit(a.media.id, 0, {
        customTitle: '실패'
      })
    )

    assert.deepEqual(repo.get(a.media.id), a)
  })

  it('다운로드 중 메타데이터는 revision으로 편집하고 구조 변경은 막는다', () => {
    const a = downloaded()

    downloadJob(
      a.media.id,
      a.media.requestUrlId!
    )

    repo.edit(a.media.id, 0, {
      customTitle: '다운로드 중 편집'
    })

    assert.throws(
      () =>
        repo.addFiles(
          a.media.id,
          1,
          [file(1)]
        ),
      error('JOB_ACTIVE')
    )

    assert.throws(
      () =>
        repo.unregisterFiles(
          a.media.id,
          1,
          [a.files[0].id]
        ),
      error('JOB_ACTIVE')
    )

    assert.throws(
      () =>
        repo.unregisterMedia(
          a.media.id,
          1
        ),
      error('JOB_ACTIVE')
    )

    sqlite.exec(`
      UPDATE download_attempt
      SET phase = 'committing'
    `)

    assert.throws(
      () =>
        repo.edit(a.media.id, 1, {
          customTitle: '충돌'
        }),
      error('JOB_ACTIVE')
    )

    sqlite.exec(`
      UPDATE download_attempt
      SET phase = 'rolling_back'
    `)

    assert.throws(
      () =>
        repo.edit(a.media.id, 1, {
          isFavorite: true
        }),
      error('JOB_ACTIVE')
    )
  })

  it('현재 시도가 아니어도 미완료 실행과 cleanup은 편집·삭제를 막는다', () => {
    const a = downloaded()

    downloadJob(
      a.media.id,
      a.media.requestUrlId!
    )

    sqlite.exec(`
      UPDATE download_queue
      SET state = 'interrupted',
          current_attempt_id = NULL;

      UPDATE download_attempt
      SET phase = 'committing';
    `)

    assert.throws(
      () =>
        repo.edit(a.media.id, 0, {
          customTitle: '충돌'
        }),
      error('JOB_ACTIVE')
    )

    sqlite.exec(`
      UPDATE download_attempt
      SET phase = 'finished',
          outcome = 'interrupted';

      UPDATE download_queue
      SET cleanup_required = 1;
    `)

    assert.throws(
      () =>
        repo.edit(a.media.id, 0, {
          isFavorite: true
        }),
      error('JOB_ACTIVE')
    )

    assert.throws(
      () =>
        repo.unregisterMedia(
          a.media.id,
          0
        ),
      error('JOB_ACTIVE')
    )
  })

  it('target이 비어 있어도 같은 URL의 대기 작업과 구조 변경이 충돌한다', () => {
    const a = downloaded()

    db.insert(s.downloadQueue)
      .values({
        id: 'unlinked',
        requestUrlId: a.media.requestUrlId!,
        originalUrl: 'https://example.invalid/a',
        mode: 'create',
        state: 'pending',
        optionsJson: '{}'
      })
      .run()

    assert.throws(
      () =>
        repo.unregisterMedia(
          a.media.id,
          0
        ),
      error('JOB_ACTIVE')
    )
  })

  it('완료된 다운로드 이력과 ID 스냅샷은 부모 제거 후에도 보존한다', () => {
    const a = downloaded()

    downloadJob(
      a.media.id,
      a.media.requestUrlId!
    )

    sqlite.exec(`
      UPDATE download_attempt
      SET phase = 'finished',
          outcome = 'completed',
          committed_at = 2000;

      UPDATE download_queue
      SET state = 'completed';
    `)

    db.update(s.medias)
      .set({
        lastDownloadCommitAttemptId: 'attempt',
        coverMode: 'manual',
        coverFileId: a.files[0].id
      })
      .where(eq(s.medias.id, a.media.id))
      .run()

    repo.unregisterMedia(a.media.id, 0)

    const job = db
      .select()
      .from(s.downloadQueue)
      .get()!

    const attempt = db
      .select()
      .from(s.downloadAttempts)
      .get()!

    assert.equal(job.targetMediaId, null)
    assert.equal(attempt.targetMediaId, null)

    assert.equal(
      job.targetMediaIdSnapshot,
      a.media.id
    )
    assert.equal(
      attempt.targetMediaIdSnapshot,
      a.media.id
    )
    assert.equal(
      job.currentAttemptId,
      attempt.id
    )
  })

  it('폴더 연결 전이라도 directory_key가 같으면 로컬 작업 충돌을 검사한다', () => {
    const a = repo.register(
      localInput('local')
    )

    localJob('local', null)

    repo.edit(a.media.id, 0, {
      customTitle: '검사 중 편집'
    })

    assert.throws(
      () =>
        repo.unregisterMedia(
          a.media.id,
          1
        ),
      error('JOB_ACTIVE')
    )

    sqlite.exec(`
      UPDATE local_import_attempt
      SET phase = 'committing'
    `)

    assert.throws(
      () =>
        repo.edit(a.media.id, 1, {
          isFavorite: true
        }),
      error('JOB_ACTIVE')
    )

    sqlite.exec(`
      UPDATE local_import_attempt
      SET phase = 'finished',
          outcome = 'completed';

      UPDATE local_import_folder
      SET state = 'completed';

      UPDATE local_import_job
      SET cleanup_required = 1;
    `)

    assert.throws(
      () =>
        repo.edit(a.media.id, 1, {
          isFavorite: true
        }),
      error('JOB_ACTIVE')
    )
  })

  it('완료된 로컬 폴더 이력은 보존하며 다음 폴더의 running은 제거를 막지 않는다', () => {
    const a = repo.register(
      localInput('local')
    )

    localJob(
      'local',
      a.localFolder!.id
    )

    sqlite.exec(`
      UPDATE local_import_attempt
      SET phase = 'finished',
          outcome = 'completed',
          committed_at = 2000;

      UPDATE local_import_folder
      SET state = 'completed';
    `)

    repo.unregisterMedia(a.media.id, 0)

    assert.equal(
      db.select()
        .from(s.localImportJobs)
        .get()!.state,
      'running'
    )

    assert.equal(
      db.select()
        .from(s.localImportFolders)
        .get()!.localFolderId,
      null
    )

    assert.equal(
      db.select()
        .from(s.localImportAttempts)
        .all().length,
      1
    )
  })
})