import assert from 'node:assert/strict'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
    appendFile,
    link,
    mkdir,
    mkdtemp,
    realpath,
    rename,
    rm,
    symlink,
    unlink,
    writeFile
} from 'node:fs/promises'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { eq } from 'drizzle-orm'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { afterEach, beforeAll, beforeEach, describe, it } from 'vitest'
import * as s from '../../../src/database/schema-v2'
import { schemaV2Guards } from '../../../src/database/schema-v2.guards'
import type { V2Database } from '../../../src/main/repositories/MediaRepository'
import { DownloadRepository, DownloadRepositoryError } from '../../../src/main/repositories/DownloadRepository'
import {
    DownloadVerificationService,
    downloadStagingDirectory,
    nodeVerificationFileSystem,
    type VerificationFileSystem
} from '../../../src/main/services/DownloadVerificationService'

let ddl: string[]
let sqlite: Database.Database
let db: V2Database
let repo: DownloadRepository
let root: string | undefined
let parent: string
let jobId: string
let attemptId: string
let staging: string
let a: string
let b: string

beforeAll(async () => {
    ddl = await generateSQLiteMigration(
        await generateSQLiteDrizzleJson({}),
        await generateSQLiteDrizzleJson(s)
    )
})

beforeEach(async () => {
    root = undefined
    parent = await realpath(tmpdir())

    root = await mkdtemp(join(parent, 'storagebucket-verification-'))

    sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')

    for (const statement of [...ddl, ...schemaV2Guards]) {
        sqlite.exec(statement)
    }

    db = drizzle(sqlite, { schema: s })
    repo = new DownloadRepository(db)

    const url = db
        .insert(s.downloadUrls)
        .values({
            url: 'https://example.invalid/one',
            normalizedUrl: 'https://example.invalid/one',
            normalizationVersion: 1
        })
        .returning()
        .get()

    const job = repo.enqueue({
        requestUrlId: url.id,
        originalUrl: url.url,
        mode: 'create'
    })

    const { attempt } = repo.startAttempt(job.id, 'manual_initial')

    jobId = job.id
    attemptId = attempt.id

    staging = downloadStagingDirectory(root, jobId, attemptId)

    await mkdir(staging, { recursive: true })

    a = join(staging, 'a.bin')
    b = join(staging, 'b.bin')

    await writeFile(a, 'abc')
    await writeFile(b, 'def')

    repo.freezeTargets(
        jobId,
        attemptId,
        ['a', 'b'].map((key) => ({
            targetKey: key,
            sourceUrl: 'https://example.invalid/' + key,
            metadata: {
                kind: 'unknown',
                title: null
            }
        }))
    )

    repo.recordResults(jobId, attemptId, [
        { targetKey: 'a', stagedPath: a },
        { targetKey: 'b', stagedPath: b }
    ])
})

afterEach(async () => {
    try {
        if (sqlite?.open) {
            assert.deepEqual(sqlite.pragma('foreign_key_check'), [])
        }
    } finally {
        if (sqlite?.open) sqlite.close()

        const owned = root
        root = undefined

        if (owned) {
            // 이번 테스트가 생성한 전용 폴더만 재귀 삭제한다.
            assert.equal(resolve(owned), owned)
            assert.equal(dirname(owned), parent)

            assert.ok(basename(owned).startsWith('storagebucket-verification-'))

            await rm(owned, {
                recursive: true,
                force: true
            })
        }
    }
})

const error = (code: string) => (value: unknown) =>
    value instanceof DownloadRepositoryError && value.code === code

function service(fs: VerificationFileSystem = nodeVerificationFileSystem) {
    return new DownloadVerificationService(repo, root!, fs)
}

function rows() {
    return repo.listTargets(jobId, attemptId).data
}

function unchanged() {
    assert.ok(
        rows().every(
            (row) =>
                row.state === 'downloaded' &&
                JSON.parse(row.metadataJson).fileVerification === undefined
        )
    )

    assert.equal(repo.get(jobId)?.state, 'running')
}

function hooked(onRead: (path: string) => void | Promise<void>) {
    let closed = 0

    const fs: VerificationFileSystem = {
        ...nodeVerificationFileSystem,

        async open(path) {
            const handle = await nodeVerificationFileSystem.open(path)

            let first = true

            return {
                ...handle,

                async read(buffer) {
                    const count = await handle.read(buffer)

                    if (count > 0 && first) {
                        first = false
                        await onRead(path)
                    }

                    return count
                },

                async close() {
                    closed++
                    await handle.close()
                }
            }
        }
    }

    return {
        fs,
        closed: () => closed
    }
}

describe('DownloadVerificationService', () => {
    it('모든 파일을 검사해 크기·식별자·해시를 함께 기록하고 작업은 아직 완료하지 않는다', async () => {
        const tracked = hooked(() => {})

        assert.deepEqual(await service(tracked.fs).verify(jobId, attemptId), {
            attemptId,
            total: 2
        })

        assert.equal(tracked.closed(), 2)

        assert.ok(rows().every((row) => row.state === 'verified' && row.finalPath === null))

        const metadata = JSON.parse(rows()[0].metadataJson)

        assert.equal(metadata.kind, 'unknown')
        assert.equal(metadata.title, null)
        assert.equal(metadata.fileVerification.version, 1)
        assert.equal(metadata.fileVerification.size, 3)

        assert.equal(
            metadata.fileVerification.sha256,
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        )

        assert.equal(metadata.fileVerification.stagedPath, a)

        const attempt = db
            .select()
            .from(s.downloadAttempts)
            .where(eq(s.downloadAttempts.id, attemptId))
            .get()!

        assert.equal(attempt.phase, 'verifying')
        assert.equal(attempt.outcome, null)
        assert.equal(attempt.committedAt, null)
        assert.equal(repo.get(jobId)?.state, 'running')
        assert.equal(db.select().from(s.medias).all().length, 0)
    })

    it('두 번째 파일이 없어도 첫 대상만 verified로 반영하지 않는다', async () => {
        await unlink(b)
        const tracked = hooked(() => {})

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId),
            error('FILE_NOT_FOUND')
        )

        assert.equal(tracked.closed(), 1)
        unchanged()
    })

    it('0바이트 파일을 거부한다', async () => {
        await writeFile(a, '')

        await assert.rejects(() => service().verify(jobId, attemptId), error('FILE_EMPTY'))

        unchanged()
    })

    it('일반 파일 대신 디렉터리가 있으면 거부한다', async () => {
        await unlink(a)
        await mkdir(a)

        await assert.rejects(() => service().verify(jobId, attemptId), error('FILE_NOT_REGULAR'))

        unchanged()
    })

    it('해당 시도의 staging 밖 경로는 파일을 읽기 전에 거부한다', async () => {
        const outside = join(root!, 'outside.bin')
        await writeFile(outside, 'outside')

        db.update(s.downloadTargets)
            .set({ stagedPath: outside })
            .where(eq(s.downloadTargets.targetKey, 'a'))
            .run()

        let reads = 0

        const fs: VerificationFileSystem = {
            ...nodeVerificationFileSystem,

            async lstat(path) {
                reads++
                return nodeVerificationFileSystem.lstat(path)
            }
        }

        await assert.rejects(
            () => service(fs).verify(jobId, attemptId),
            error('UNSAFE_STAGING_PATH')
        )

        assert.equal(reads, 0)
        unchanged()
    })

    it('중간 폴더의 Windows 정션 또는 디렉터리 링크를 거부한다', async () => {
        const outside = join(root!, 'outside')
        await mkdir(outside)
        await writeFile(join(outside, 'a.bin'), 'abc')

        const alias = join(staging, 'alias')

        await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir')

        db.update(s.downloadTargets)
            .set({
                stagedPath: join(alias, 'a.bin')
            })
            .where(eq(s.downloadTargets.targetKey, 'a'))
            .run()

        await assert.rejects(() => service().verify(jobId, attemptId), error('UNSAFE_STAGING_PATH'))

        unchanged()
    })

    it('외부 파일을 가리키는 하드 링크를 앱 소유 staging 파일로 인정하지 않는다', async () => {
        const outside = join(root!, 'outside.bin')

        await writeFile(outside, 'abc')
        await unlink(a)
        await link(outside, a)

        await assert.rejects(() => service().verify(jobId, attemptId), error('UNSAFE_STAGING_PATH'))

        unchanged()
    })

    it('읽는 도중 크기가 바뀌면 거부하고 파일 핸들을 닫는다', async () => {
        const tracked = hooked(async (path) => {
            if (path === a) {
                await appendFile(a, 'changed')
            }
        })

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId),
            error('FILE_CHANGED')
        )

        assert.equal(tracked.closed(), 1)
        unchanged()
    })

    it('읽는 도중 경로의 파일이 교체돼도 거부한다', async () => {
        const tracked = hooked(async (path) => {
            if (path === a) {
                await rename(a, join(staging, 'old-a.bin'))

                await writeFile(a, 'abc')
            }
        })

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId),
            error('FILE_CHANGED')
        )

        unchanged()
    })

    it('파일 검사 중 들어온 DB 취소 요청은 최종 반영 전에 다시 검사한다', async () => {
        const tracked = hooked((path) => {
            if (path === a) {
                db.update(s.downloadAttempts)
                    .set({ cancelRequestedAt: 0 })
                    .where(eq(s.downloadAttempts.id, attemptId))
                    .run()
            }
        })

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId),
            error('CANCEL_REQUESTED')
        )

        unchanged()
    })

    it('AbortSignal 취소는 추가 파일 처리를 멈추고 verified를 남기지 않는다', async () => {
        const controller = new AbortController()
        const tracked = hooked(() => controller.abort())

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId, controller.signal),
            error('CANCEL_REQUESTED')
        )

        assert.equal(tracked.closed(), 1)
        unchanged()
    })

    it('검사 중 DB 후보 경로가 바뀌면 이전 검사 결과를 반영하지 않는다', async () => {
        const tracked = hooked((path) => {
            if (path === a) {
                db.update(s.downloadTargets)
                    .set({
                        stagedPath: join(staging, 'changed.bin')
                    })
                    .where(eq(s.downloadTargets.targetKey, 'a'))
                    .run()
            }
        })

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId),
            error('VERIFICATION_CHANGED')
        )

        unchanged()
    })

    it('두 번째 verified 갱신 실패는 첫 대상의 상태와 검사 정보도 롤백한다', async () => {
        sqlite.exec(`
            CREATE TRIGGER reject_verified
            BEFORE UPDATE OF state ON download_target
            WHEN NEW.target_key = 'b'
              AND NEW.state = 'verified'
            BEGIN
                SELECT RAISE(ABORT, 'fixture failure');
            END;
        `)

        await assert.rejects(() => service().verify(jobId, attemptId), error('DATABASE_ERROR'))

        unchanged()
    })

    it('같은 서비스의 동시 검증을 차단하고 진행 중 검증은 정상 마친다', async () => {
        let release!: () => void
        let started!: () => void

        const gate = new Promise<void>((yes) => {
            release = yes
        })

        const entered = new Promise<void>((yes) => {
            started = yes
        })

        const tracked = hooked(async (path) => {
            if (path === a) {
                started()
                await gate
            }
        })

        const worker = service(tracked.fs)
        const first = worker.verify(jobId, attemptId)

        await entered

        try {
            await assert.rejects(() => worker.verify(jobId, attemptId), error('ALREADY_PROCESSING'))
        } finally {
            release()
        }

        await first

        assert.ok(rows().every((row) => row.state === 'verified'))

        await assert.rejects(() => worker.verify(jobId, attemptId), error('INVALID_STATE'))
    })

    it('읽기 실패 시 핸들을 닫고 내부 경로를 오류에 노출하지 않는다', async () => {
        const tracked = hooked(() => {
            throw Object.assign(new Error('private path'), { code: 'EACCES' })
        })

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId),
            (value: unknown) =>
                value instanceof DownloadRepositoryError &&
                value.code === 'FILE_IO_ERROR' &&
                !value.message.includes('private')
        )

        assert.equal(tracked.closed(), 1)
        unchanged()
    })

    it('검증 시작 전 취소된 요청은 파일을 열지 않는다', async () => {
        const controller = new AbortController()
        controller.abort()

        const tracked = hooked(() => {})

        await assert.rejects(
            () => service(tracked.fs).verify(jobId, attemptId, controller.signal),
            error('CANCEL_REQUESTED')
        )

        assert.equal(tracked.closed(), 0)
        unchanged()
    })
})
