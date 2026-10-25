import { randomUUID } from 'node:crypto'
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import * as s from '../../database/schema-v2'
import type { MediaSuggestionRequest } from '../../shared/media-v2'

export type V2Database = BetterSQLite3Database<typeof s>

type Store = Pick<V2Database, 'select' | 'insert' | 'update' | 'delete' | 'get'>

type Tx = Parameters<Parameters<V2Database['transaction']>[0]>[0]

export type FileInput = Omit<
    s.NewMediaFile,
    'id' | 'mediaId' | 'localFolderLocationId' | 'createdAt'
>

export type RegisterInput = {
    sourceTitle?: string | null
    customTitle?: string | null
    files: FileInput[]
    coverFileKey?: string
    tagIds?: number[]
    isFavorite?: boolean
} & (
    | {
          sourceKind: 'download'
          requestUrlId: number
      }
    | {
          sourceKind: 'local'
          folder: {
              sourceTitle: string
              directoryPath: string
              directoryKey: string
              keyVersion: number
          }
      }
)

export interface EditInput {
    customTitle?: string | null
    cover?: { mode: 'auto' } | { mode: 'manual'; fileId: number }
    tagIds?: number[]
    isFavorite?: boolean
    tagChange?: {
        addNames?: string[]
        removeIds?: number[]
    }
}

export type RepositoryErrorCode =
    | 'INVALID_ARGUMENT'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT'
    | 'JOB_ACTIVE'
    | 'INVALID_COVER'
    | 'INVALID_LOCATION'
    | 'FILE_NOT_FOUND'
    | 'INVARIANT_VIOLATION'

export class MediaRepositoryError extends Error {
    constructor(
        readonly code: RepositoryErrorCode,
        readonly context: Record<string, unknown> = {}
    ) {
        super(code)
        this.name = 'MediaRepositoryError'
    }
}

export interface CleanupCandidate {
    fileId: number
    role: 'original' | 'thumbnail'
    path: string
    storageKind: s.MediaFile['storageKind']
    thumbnailOrigin: s.MediaFile['thumbnailOrigin']
}

export interface DeletionCleanupPayload {
    version: 1
    mediaId: number

    // 후보는 삭제 허가가 아니다.
    // 실행기가 소유권·저장소 경계·남은 참조를 재검사해야 한다.
    candidates: CleanupCandidate[]

    // 제거되는 행의 보호 대상도 보존한다.
    protectedPaths: string[]

    // 현재 스키마에는 preview의 소유 구분이 없다.
    unverifiedPreviews: {
        fileId: number
        path: string
    }[]
}

export class MediaRepository {
    constructor(
        private readonly db: V2Database,
        private readonly clock: () => number = Date.now
    ) {
        const row = db.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`)

        if (row?.foreign_keys !== 1) {
            throw new MediaRepositoryError('INVARIANT_VIOLATION', {
                reason: 'foreign_keys must be ON'
            })
        }
    }

    list({
        limit = 50,
        offset = 0,
        favoritesOnly = false,
        filter
    }: {
        limit?: number
        offset?: number
        favoritesOnly?: boolean
        filter?: unknown
    } = {}) {
        this.page(limit, offset)

        if (typeof favoritesOnly !== 'boolean') {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        const where = and(
            this.searchCondition(filter),
            favoritesOnly
                ? sql`EXISTS (
                    SELECT 1 FROM favorite f
                    WHERE f.media_id = ${s.medias.id}
                )`
                : undefined
        )

        return this.db.transaction((tx) => {
            const total = tx.select({ value: count() }).from(s.medias).where(where).get()!.value

            const favoriteTime = sql<number>`(
                SELECT f.created_at FROM favorite f
                WHERE f.media_id = ${s.medias.id}
            )`

            const favoriteId = sql<number>`(
                SELECT f.id FROM favorite f
                WHERE f.media_id = ${s.medias.id}
            )`

            const data = this.summaryQuery(tx)
                .where(where)
                .orderBy(
                    ...(favoritesOnly
                        ? [desc(favoriteTime), desc(favoriteId), desc(s.medias.id)]
                        : [desc(s.medias.createdAt), desc(s.medias.id)])
                )
                .limit(limit)
                .offset(offset)
                .all()
                .map((row) => this.present(row))

            return {
                data,
                total,
                hasNextPage: offset + data.length < total
            }
        })
    }

    private searchCondition(value: unknown): SQL | undefined {
        if (value === undefined) return undefined

        function invalid(): never {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            invalid()
        }

        const prototype = Object.getPrototypeOf(value)

        if (prototype !== Object.prototype && prototype !== null) {
            invalid()
        }

        const input = value as Record<string, unknown>

        const allowed = [
            'keyword',
            'tags',
            'tagMode',
            'platforms',
            'authors',
            'createdFrom',
            'createdTo'
        ]

        if (Object.keys(input).some((key) => !allowed.includes(key))) {
            invalid()
        }

        const strings = (value: unknown): string[] => {
            if (value === undefined) return []

            if (!Array.isArray(value) || value.length > 100) {
                invalid()
            }

            return [
                ...new Set(
                    Array.from(value, (item) => {
                        if (typeof item !== 'string' || !item.trim() || item.length > 200) {
                            invalid()
                        }

                        // 기존 태그·플랫폼 이름의 공백을 변경하지 않는다.
                        return item
                    })
                )
            ]
        }

        const tags = strings(input.tags)
        const platforms = strings(input.platforms)
        const authors = strings(input.authors)

        if (input.tagMode !== undefined && input.tagMode !== 'and' && input.tagMode !== 'or') {
            invalid()
        }

        let keyword = ''

        if (input.keyword !== undefined) {
            if (typeof input.keyword !== 'string' || input.keyword.length > 1000) {
                invalid()
            }

            keyword = input.keyword.trim()
        }

        const time = (value: unknown): number | undefined => {
            if (value === undefined) return undefined

            if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
                invalid()
            }

            return value
        }

        const from = time(input.createdFrom)
        const to = time(input.createdTo)

        if (from !== undefined && to !== undefined && from > to) {
            invalid()
        }

        const contains = (column: SQL, text: string) =>
            sql`instr(
                lower(coalesce(${column}, '')),
                lower(${text})
            ) > 0`

        const conditions: SQL[] = []

        if (keyword) {
            conditions.push(sql`(
                ${contains(sql`${s.medias.customTitle}`, keyword)}
                OR ${contains(sql`${s.medias.sourceTitle}`, keyword)}
                OR EXISTS (
                    SELECT 1 FROM download_urls u
                    WHERE u.id = ${s.medias.requestUrlId}
                      AND (
                        ${contains(sql`u.url`, keyword)}
                        OR ${contains(sql`u.normalized_url`, keyword)}
                      )
                )
                OR EXISTS (
                    SELECT 1 FROM media_tag mt
                    JOIN tag t ON t.id = mt.tag_id
                    WHERE mt.media_id = ${s.medias.id}
                      AND ${contains(sql`t.name`, keyword)}
                )
                OR EXISTS (
                    SELECT 1 FROM media_file mf
                    LEFT JOIN profiles pr
                        ON pr.id = mf.profile_id
                    LEFT JOIN platform p
                        ON p.id = mf.platform_id
                    LEFT JOIN download_urls lu
                        ON lu.id = mf.legacy_url_id
                    WHERE mf.media_id = ${s.medias.id}
                      AND (
                        ${contains(sql`mf.title`, keyword)}
                        OR ${contains(sql`mf.source_url`, keyword)}
                        OR ${contains(sql`mf.external_id`, keyword)}
                        OR ${contains(sql`pr.owner_name`, keyword)}
                        OR ${contains(sql`pr.owner_id`, keyword)}
                        OR ${contains(sql`p.name`, keyword)}
                        OR ${contains(sql`lu.url`, keyword)}
                        OR ${contains(sql`lu.normalized_url`, keyword)}
                      )
                )
            )`)
        }

        if (tags.length) {
            const matches = sql<number>`(
                SELECT count(*) FROM media_tag mt
                JOIN tag t ON t.id = mt.tag_id
                WHERE mt.media_id = ${s.medias.id}
                  AND t.name IN (
                    ${sql.join(
                        tags.map((tag) => sql`${tag}`),
                        sql`, `
                    )}
                  )
            )`

            conditions.push(
                input.tagMode === 'or' ? sql`${matches} > 0` : sql`${matches} = ${tags.length}`
            )
        }

        if (platforms.length || authors.length) {
            const platformCondition = platforms.length
                ? sql`p.name IN (
                    ${sql.join(
                        platforms.map((name) => sql`${name}`),
                        sql`, `
                    )}
                  )`
                : undefined

            const authorCondition = authors.length
                ? or(
                      ...authors.map(
                          (author) => sql`(
                              ${contains(sql`pr.owner_name`, author)}
                              OR ${contains(sql`pr.owner_id`, author)}
                          )`
                      )
                  )
                : undefined

            conditions.push(sql`EXISTS (
                SELECT 1 FROM media_file mf
                LEFT JOIN profiles pr
                    ON pr.id = mf.profile_id
                LEFT JOIN platform p
                    ON p.id = mf.platform_id
                WHERE mf.media_id = ${s.medias.id}
                  AND ${and(platformCondition, authorCondition)}
            )`)
        }

        if (from !== undefined) {
            conditions.push(sql`${s.medias.createdAt} >= ${from}`)
        }

        if (to !== undefined) {
            conditions.push(sql`${s.medias.createdAt} <= ${to}`)
        }

        return and(...conditions)
    }

    suggest({ kind, text, limit = 10 }: MediaSuggestionRequest): string[] {
        if (
            !['tag', 'platform', 'author'].includes(kind) ||
            typeof text !== 'string' ||
            text.length > 200 ||
            !Number.isSafeInteger(limit) ||
            limit < 1 ||
            limit > 20
        ) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        const keyword = text.trim()

        if (!keyword) return []

        const source =
            kind === 'tag'
                ? sql`
                    SELECT t.name AS value
                    FROM tag t
                    WHERE EXISTS (
                        SELECT 1 FROM media_tag mt
                        WHERE mt.tag_id = t.id
                    )
                `
                : kind === 'platform'
                  ? sql`
                      SELECT p.name AS value
                      FROM platform p
                      WHERE EXISTS (
                          SELECT 1 FROM media_file mf
                          WHERE mf.platform_id = p.id
                      )
                  `
                  : sql`
                      SELECT pr.owner_name AS value
                      FROM profiles pr
                      WHERE EXISTS (
                          SELECT 1 FROM media_file mf
                          WHERE mf.profile_id = pr.id
                      )
                      UNION
                      SELECT pr.owner_id AS value
                      FROM profiles pr
                      WHERE EXISTS (
                          SELECT 1 FROM media_file mf
                          WHERE mf.profile_id = pr.id
                      )
                  `

        return this.db
            .all<{ value: string }>(
                sql`
                SELECT DISTINCT value
                FROM (${source}) candidates
                WHERE value IS NOT NULL
                  AND length(trim(value)) > 0
                  AND instr(lower(value), lower(${keyword})) > 0
                ORDER BY lower(value), value
                LIMIT ${limit}
            `
            )
            .map((row) => row.value)
    }

    get(mediaId: number) {
        this.integer(mediaId)

        return this.db.transaction((tx) => this.detail(tx, mediaId))
    }

    getPage(
        mediaId: number,
        {
            limit = 50,
            offset = 0
        }: {
            limit?: number
            offset?: number
        } = {}
    ) {
        this.integer(mediaId)
        this.page(limit, offset)

        return this.db.transaction((tx) => {
            const row = this.summaryQuery(tx).where(eq(s.medias.id, mediaId)).get()

            if (!row) return undefined

            const files = tx
                .select()
                .from(s.mediaFiles)
                .where(eq(s.mediaFiles.mediaId, mediaId))
                .orderBy(asc(s.mediaFiles.position), asc(s.mediaFiles.id))
                .limit(limit)
                .offset(offset)
                .all()

            return {
                ...this.present(row),
                ...this.detailRelations(tx, mediaId),
                files: {
                    data: files,
                    total: row.fileCount,
                    hasNextPage: offset + files.length < row.fileCount
                }
            }
        })
    }

    register(input: RegisterInput) {
        this.nonempty(input.files)

        return this.write((tx, now) => {
            const media = tx
                .insert(s.medias)
                .values({
                    sourceKind: input.sourceKind,
                    requestUrlId: input.sourceKind === 'download' ? input.requestUrlId : null,
                    sourceTitle:
                        input.sourceTitle === undefined && input.sourceKind === 'local'
                            ? input.folder.sourceTitle
                            : input.sourceTitle,
                    customTitle: input.customTitle,
                    createdAt: now,
                    updatedAt: now
                })
                .returning()
                .get()

            let locationId: number | undefined

            if (input.sourceKind === 'local') {
                const folder = tx
                    .insert(s.localFolders)
                    .values({
                        mediaId: media.id,
                        sourceTitle: input.folder.sourceTitle
                    })
                    .returning()
                    .get()

                locationId = tx
                    .insert(s.localFolderLocations)
                    .values({
                        directoryPath: input.folder.directoryPath,
                        directoryKey: input.folder.directoryKey,
                        keyVersion: input.folder.keyVersion,
                        mediaId: media.id,
                        localFolderId: folder.id,
                        state: 'active'
                    })
                    .returning()
                    .get().id
            }

            this.insertFiles(tx, media, input.files, locationId, now)

            if (input.coverFileKey !== undefined) {
                const cover = tx
                    .select()
                    .from(s.mediaFiles)
                    .where(
                        and(
                            eq(s.mediaFiles.mediaId, media.id),
                            eq(s.mediaFiles.fileKey, input.coverFileKey)
                        )
                    )
                    .get()

                if (!cover) {
                    throw new MediaRepositoryError('INVALID_COVER')
                }

                tx.update(s.medias)
                    .set({
                        coverMode: 'manual',
                        coverFileId: cover.id
                    })
                    .where(eq(s.medias.id, media.id))
                    .run()
            }

            if (input.tagIds !== undefined) {
                this.syncTags(tx, media.id, input.tagIds)
            }

            if (input.isFavorite) {
                tx.insert(s.favorites)
                    .values({
                        mediaId: media.id,
                        createdAt: now
                    })
                    .run()
            }

            this.enqueueSearch(tx, media.id, now)

            return this.requiredDetail(tx, media.id)
        })
    }

    addFiles(
        mediaId: number,
        expectedRevision: number,
        files: FileInput[],
        localFolderLocationId?: number
    ) {
        this.nonempty(files)

        return this.write((tx, now) => {
            const media = this.checkRevision(tx, mediaId, expectedRevision)

            this.assertAvailable(tx, media, true)

            this.insertFiles(tx, media, files, localFolderLocationId, now)

            this.bump(tx, media, now)
            this.enqueueSearch(tx, mediaId, now)

            return this.requiredDetail(tx, mediaId)
        })
    }

    edit(mediaId: number, expectedRevision: number, input: EditInput) {
        if (
            input.customTitle === undefined &&
            input.cover === undefined &&
            input.tagIds === undefined &&
            input.tagChange === undefined &&
            input.isFavorite === undefined
        ) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        if (input.tagIds !== undefined && input.tagChange !== undefined) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        return this.write((tx, now) => {
            const media = this.checkRevision(tx, mediaId, expectedRevision)

            this.assertAvailable(tx, media, false)

            const changes: Partial<typeof s.medias.$inferInsert> = {}

            if (input.customTitle !== undefined) {
                if (input.customTitle !== null && typeof input.customTitle !== 'string') {
                    throw new MediaRepositoryError('INVALID_ARGUMENT')
                }

                changes.customTitle = input.customTitle
            }

            if (input.cover !== undefined) {
                if (input.cover.mode === 'manual') {
                    this.integer(input.cover.fileId)

                    const child = tx
                        .select({ id: s.mediaFiles.id })
                        .from(s.mediaFiles)
                        .where(
                            and(
                                eq(s.mediaFiles.id, input.cover.fileId),
                                eq(s.mediaFiles.mediaId, mediaId)
                            )
                        )
                        .get()

                    if (!child) {
                        throw new MediaRepositoryError('INVALID_COVER')
                    }

                    changes.coverMode = 'manual'
                    changes.coverFileId = child.id
                } else if (input.cover.mode === 'auto') {
                    changes.coverMode = 'auto'
                    changes.coverFileId = null
                } else {
                    throw new MediaRepositoryError('INVALID_ARGUMENT')
                }
            }

            if (input.tagIds !== undefined) {
                this.syncTags(tx, mediaId, input.tagIds)
            }

            if (input.tagChange !== undefined) {
                this.changeTags(tx, mediaId, input.tagChange)
            }

            if (input.isFavorite !== undefined) {
                if (typeof input.isFavorite !== 'boolean') {
                    throw new MediaRepositoryError('INVALID_ARGUMENT')
                }

                const favorite = tx
                    .select()
                    .from(s.favorites)
                    .where(eq(s.favorites.mediaId, mediaId))
                    .get()

                if (input.isFavorite && !favorite) {
                    tx.insert(s.favorites)
                        .values({
                            mediaId,
                            createdAt: now
                        })
                        .run()
                } else if (!input.isFavorite && favorite) {
                    tx.delete(s.favorites).where(eq(s.favorites.id, favorite.id)).run()
                }
            }

            this.bump(tx, media, now, changes)
            this.enqueueSearch(tx, mediaId, now)

            return this.requiredDetail(tx, mediaId)
        })
    }

    unregisterFiles(mediaId: number, expectedRevision: number, fileIds: number[]) {
        this.nonempty(fileIds)
        fileIds.forEach((id) => this.integer(id))

        const uniqueIds = [...new Set(fileIds)]

        return this.write((tx, now) => {
            const media = this.checkRevision(tx, mediaId, expectedRevision)

            this.assertAvailable(tx, media, true)

            const files = tx
                .select()
                .from(s.mediaFiles)
                .where(and(eq(s.mediaFiles.mediaId, mediaId), inArray(s.mediaFiles.id, uniqueIds)))
                .all()

            if (files.length !== uniqueIds.length) {
                throw new MediaRepositoryError('FILE_NOT_FOUND')
            }

            // 표지 FK를 먼저 해제한다.
            if (media.coverFileId !== null && uniqueIds.includes(media.coverFileId)) {
                tx.update(s.medias)
                    .set({
                        coverMode: 'auto',
                        coverFileId: null
                    })
                    .where(eq(s.medias.id, mediaId))
                    .run()
            }

            tx.delete(s.mediaFiles)
                .where(and(eq(s.mediaFiles.mediaId, mediaId), inArray(s.mediaFiles.id, uniqueIds)))
                .run()

            const remaining = tx
                .select({ value: count() })
                .from(s.mediaFiles)
                .where(eq(s.mediaFiles.mediaId, mediaId))
                .get()!.value

            if (remaining === 0) {
                tx.delete(s.medias).where(eq(s.medias.id, mediaId)).run()
            } else {
                this.bump(tx, media, now)
            }

            const cleanupTaskId = this.enqueueCleanup(tx, mediaId, files, now)

            this.enqueueSearch(tx, mediaId, now)

            return {
                mediaId,
                parentRemoved: remaining === 0,
                revision: remaining === 0 ? null : media.revision + 1,
                cleanupTaskId
            }
        })
    }

    unregisterMedia(mediaId: number, expectedRevision: number) {
        return this.write((tx, now) => {
            const media = this.checkRevision(tx, mediaId, expectedRevision)

            this.assertAvailable(tx, media, true)

            const files = tx
                .select()
                .from(s.mediaFiles)
                .where(eq(s.mediaFiles.mediaId, mediaId))
                .all()

            tx.update(s.medias)
                .set({
                    coverMode: 'auto',
                    coverFileId: null
                })
                .where(eq(s.medias.id, mediaId))
                .run()

            tx.delete(s.medias).where(eq(s.medias.id, mediaId)).run()

            const cleanupTaskId = this.enqueueCleanup(tx, mediaId, files, now)

            this.enqueueSearch(tx, mediaId, now)

            return {
                mediaId,
                parentRemoved: true as const,
                revision: null,
                cleanupTaskId
            }
        })
    }

    private summaryQuery(store: Store) {
        const representativeId = sql<number | null>`
      CASE
        WHEN ${s.medias.coverMode} = 'manual'
          THEN ${s.medias.coverFileId}
        ELSE (
          SELECT f.id
          FROM media_file f
          WHERE f.media_id = ${s.medias.id}
            AND (
              (
                f.kind = 'video'
                AND f.thumbnail_path IS NOT NULL
              )
              OR f.kind = 'image'
            )
          ORDER BY
            CASE WHEN f.kind = 'video' THEN 0 ELSE 1 END,
            f.position,
            f.id
          LIMIT 1
        )
      END
    `

        return store
            .select({
                media: s.medias,
                representative: s.mediaFiles,
                requestUrl: s.downloadUrls.url,
                fileCount: sql<number>`
          (
            SELECT count(*)
            FROM media_file f
            WHERE f.media_id = ${s.medias.id}
          )
        `.mapWith(Number),
                firstTitle: sql<string | null>`
          (
            SELECT f.title
            FROM media_file f
            WHERE f.media_id = ${s.medias.id}
            ORDER BY f.position, f.id
            LIMIT 1
          )
        `,
                isFavorite: sql<boolean>`
          EXISTS (
            SELECT 1
            FROM favorite f
            WHERE f.media_id = ${s.medias.id}
          )
        `.mapWith(Boolean)
            })
            .from(s.medias)
            .leftJoin(s.downloadUrls, eq(s.downloadUrls.id, s.medias.requestUrlId))
            .leftJoin(s.mediaFiles, eq(s.mediaFiles.id, representativeId))
    }

    private present(row: ReturnType<ReturnType<MediaRepository['summaryQuery']>['all']>[number]) {
        const file = row.representative

        const path = file
            ? (file.thumbnailPath ??
              file.previewPath ??
              (file.kind === 'image' ? file.filepath : null))
            : null

        return {
            media: row.media,
            displayTitle:
                [row.media.customTitle, row.media.sourceTitle, row.firstTitle].find(
                    (value) => value !== null && value.trim().length > 0
                ) ?? '제목 없음',
            requestUrl: row.requestUrl,
            fileCount: row.fileCount,
            isFavorite: row.isFavorite,
            cover:
                file && path
                    ? {
                          fileId: file.id,
                          path,
                          kind: file.kind
                      }
                    : null
        }
    }

    private detail(store: Store, mediaId: number) {
        const row = this.summaryQuery(store).where(eq(s.medias.id, mediaId)).get()

        if (!row) return undefined

        return {
            ...this.present(row),
            ...this.detailRelations(store, mediaId),
            files: store
                .select()
                .from(s.mediaFiles)
                .where(eq(s.mediaFiles.mediaId, mediaId))
                .orderBy(asc(s.mediaFiles.position), asc(s.mediaFiles.id))
                .all()
        }
    }

    private detailRelations(store: Store, mediaId: number) {
        return {
            tags: store
                .select({
                    id: s.tags.id,
                    name: s.tags.name
                })
                .from(s.mediaTags)
                .innerJoin(s.tags, eq(s.tags.id, s.mediaTags.tagId))
                .where(eq(s.mediaTags.mediaId, mediaId))
                .orderBy(asc(s.tags.id))
                .all(),
            favorite:
                store.select().from(s.favorites).where(eq(s.favorites.mediaId, mediaId)).get() ??
                null,
            localFolder:
                store
                    .select()
                    .from(s.localFolders)
                    .where(eq(s.localFolders.mediaId, mediaId))
                    .get() ?? null,
            locations: store
                .select()
                .from(s.localFolderLocations)
                .where(eq(s.localFolderLocations.mediaId, mediaId))
                .orderBy(asc(s.localFolderLocations.id))
                .all()
        }
    }

    private requiredDetail(store: Store, mediaId: number) {
        const detail = this.detail(store, mediaId)

        if (
            !detail ||
            detail.files.length === 0 ||
            (detail.media.sourceKind === 'local' && !detail.localFolder)
        ) {
            throw new MediaRepositoryError('INVARIANT_VIOLATION')
        }

        return detail
    }

    private checkRevision(store: Store, mediaId: number, expectedRevision: number) {
        this.integer(mediaId)
        this.integer(expectedRevision, 0)

        const media = store.select().from(s.medias).where(eq(s.medias.id, mediaId)).get()

        if (!media) {
            throw new MediaRepositoryError('NOT_FOUND', {
                mediaId
            })
        }

        if (media.revision !== expectedRevision) {
            throw new MediaRepositoryError('REVISION_CONFLICT', {
                mediaId,
                expectedRevision,
                actualRevision: media.revision
            })
        }

        if (media.revision >= Number.MAX_SAFE_INTEGER) {
            throw new MediaRepositoryError('INVARIANT_VIOLATION')
        }

        return media
    }

    private assertAvailable(store: Store, media: s.Media, structural: boolean) {
        const flag = structural ? 1 : 0

        const row = store.get<{ busy: number }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM download_queue q
        WHERE (
          q.target_media_id = ${media.id}
          OR q.request_url_id = ${media.requestUrlId}
          OR EXISTS (
            SELECT 1
            FROM download_attempt a
            WHERE a.job_id = q.id
              AND a.target_media_id = ${media.id}
          )
        )
        AND (
          q.cleanup_required = 1
          OR (
            ${flag} = 1
            AND q.state IN ('pending', 'running')
          )
          OR EXISTS (
            SELECT 1
            FROM download_attempt a
            WHERE a.job_id = q.id
              AND a.outcome IS NULL
              AND (
                a.phase IN ('committing', 'rolling_back')
                OR (
                  ${flag} = 1
                  AND a.phase <> 'finished'
                )
              )
          )
        )

        UNION ALL

        SELECT 1
        FROM local_import_folder f
        JOIN local_import_job j ON j.id = f.job_id
        WHERE (
          f.local_folder_id IN (
            SELECT id
            FROM local_folder
            WHERE media_id = ${media.id}
          )
          OR f.directory_key IN (
            SELECT directory_key
            FROM local_folder_location
            WHERE media_id = ${media.id}
              AND state IN ('active', 'reserved')
          )
        )
        AND (
          f.cleanup_required = 1
          OR j.cleanup_required = 1
          OR (
            ${flag} = 1
            AND f.state IN ('pending', 'running')
          )
          OR EXISTS (
            SELECT 1
            FROM local_import_attempt a
            WHERE a.import_folder_id = f.id
              AND a.outcome IS NULL
              AND (
                a.phase IN ('committing', 'rolling_back')
                OR (
                  ${flag} = 1
                  AND a.phase <> 'finished'
                )
              )
          )
        )
      ) AS busy
    `)

        if (row?.busy) {
            throw new MediaRepositoryError('JOB_ACTIVE', {
                mediaId: media.id
            })
        }
    }

    private insertFiles(
        tx: Store,
        media: s.Media,
        files: FileInput[],
        locationId: number | undefined,
        now: number
    ) {
        if (media.sourceKind === 'local') {
            if (locationId === undefined) {
                throw new MediaRepositoryError('INVALID_LOCATION')
            }

            const location = tx
                .select()
                .from(s.localFolderLocations)
                .where(
                    and(
                        eq(s.localFolderLocations.id, locationId),
                        eq(s.localFolderLocations.mediaId, media.id)
                    )
                )
                .get()

            if (!location || location.state === 'history') {
                throw new MediaRepositoryError('INVALID_LOCATION')
            }
        } else if (locationId !== undefined) {
            throw new MediaRepositoryError('INVALID_LOCATION')
        }

        for (const file of files) {
            const storageKind = media.sourceKind === 'local' ? 'external_reference' : 'app_managed'

            if (file.storageKind !== storageKind) {
                throw new MediaRepositoryError('INVALID_ARGUMENT', {
                    reason: 'storageKind'
                })
            }

            this.integer(file.position, 0)

            tx.insert(s.mediaFiles)
                .values({
                    ...file,
                    id: undefined,
                    mediaId: media.id,
                    localFolderLocationId: locationId ?? null,
                    createdAt: now
                })
                .run()
        }
    }

    private changeTags(tx: Store, mediaId: number, change: NonNullable<EditInput['tagChange']>) {
        const rawNames = change.addNames ?? []
        const rawIds = change.removeIds ?? []

        if (!Array.isArray(rawNames) || !Array.isArray(rawIds)) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        const names = [
            ...new Set(
                Array.from(rawNames, (name) => {
                    if (typeof name !== 'string' || !name.trim()) {
                        throw new MediaRepositoryError('INVALID_ARGUMENT')
                    }

                    return name.trim()
                })
            )
        ]

        const removeIds = [
            ...new Set(
                Array.from(rawIds, (id) => {
                    this.integer(id)
                    return id
                })
            )
        ]

        if (!names.length && !removeIds.length) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }

        const current = tx.select().from(s.mediaTags).where(eq(s.mediaTags.mediaId, mediaId)).all()

        const linked = new Set(current.map((row) => row.tagId))

        if (removeIds.some((id) => !linked.has(id))) {
            throw new MediaRepositoryError('INVALID_ARGUMENT', {
                reason: 'tag is not linked to this media'
            })
        }

        for (const tagId of removeIds) {
            tx.delete(s.mediaTags)
                .where(and(eq(s.mediaTags.mediaId, mediaId), eq(s.mediaTags.tagId, tagId)))
                .run()

            linked.delete(tagId)
        }

        for (const name of names) {
            const tag =
                tx.select().from(s.tags).where(eq(s.tags.name, name)).get() ??
                tx.insert(s.tags).values({ name }).returning().get()

            if (!linked.has(tag.id)) {
                tx.insert(s.mediaTags)
                    .values({
                        mediaId,
                        tagId: tag.id
                    })
                    .run()

                linked.add(tag.id)
            }
        }
    }

    private syncTags(tx: Store, mediaId: number, tagIds: number[]) {
        tagIds.forEach((id) => this.integer(id))

        const desired = new Set(tagIds)

        const current = tx.select().from(s.mediaTags).where(eq(s.mediaTags.mediaId, mediaId)).all()

        const existing = new Set(current.map((row) => row.tagId))

        for (const tagId of existing) {
            if (!desired.has(tagId)) {
                tx.delete(s.mediaTags)
                    .where(and(eq(s.mediaTags.mediaId, mediaId), eq(s.mediaTags.tagId, tagId)))
                    .run()
            }
        }

        for (const tagId of desired) {
            if (!existing.has(tagId)) {
                tx.insert(s.mediaTags).values({ mediaId, tagId }).run()
            }
        }
    }

    private bump(
        tx: Store,
        media: s.Media,
        now: number,
        changes: Partial<typeof s.medias.$inferInsert> = {}
    ) {
        const result = tx
            .update(s.medias)
            .set({
                ...changes,
                revision: media.revision + 1,
                updatedAt: now
            })
            .where(and(eq(s.medias.id, media.id), eq(s.medias.revision, media.revision)))
            .run()

        if (result.changes !== 1) {
            throw new MediaRepositoryError('REVISION_CONFLICT')
        }
    }

    private enqueueSearch(tx: Store, mediaId: number, now: number) {
        tx.insert(s.maintenanceTasks)
            .values({
                id: randomUUID(),
                kind: 'search_reindex',
                state: 'pending',
                ownerKind: 'system',
                payloadJson: JSON.stringify({
                    scope: 'media',
                    mediaId
                }),
                createdAt: now,
                updatedAt: now
            })
            .run()
    }

    private enqueueCleanup(tx: Store, mediaId: number, files: s.MediaFile[], now: number) {
        const payload: DeletionCleanupPayload = {
            version: 1,
            mediaId,
            candidates: [],
            protectedPaths: [],
            unverifiedPreviews: []
        }

        for (const file of files) {
            const common = {
                fileId: file.id,
                storageKind: file.storageKind,
                thumbnailOrigin: file.thumbnailOrigin
            }

            if (file.storageKind !== 'app_managed') {
                payload.protectedPaths.push(file.filepath)
            }

            if (file.thumbnailOrigin === 'unverified_legacy' && file.thumbnailPath) {
                payload.protectedPaths.push(file.thumbnailPath)
            }

            if (file.storageKind === 'app_managed') {
                payload.candidates.push({
                    ...common,
                    role: 'original',
                    path: file.filepath
                })
            }

            if (file.thumbnailOrigin === 'app_generated' && file.thumbnailPath) {
                payload.candidates.push({
                    ...common,
                    role: 'thumbnail',
                    path: file.thumbnailPath
                })
            }

            if (file.previewPath) {
                payload.protectedPaths.push(file.previewPath)

                payload.unverifiedPreviews.push({
                    fileId: file.id,
                    path: file.previewPath
                })
            }
        }

        payload.protectedPaths = [...new Set(payload.protectedPaths)]

        payload.candidates = payload.candidates.filter(
            (candidate) => !payload.protectedPaths.includes(candidate.path)
        )

        if (!payload.candidates.length && !payload.unverifiedPreviews.length) {
            return null
        }

        const id = randomUUID()

        tx.insert(s.maintenanceTasks)
            .values({
                id,
                kind: 'deletion_cleanup',
                state: 'pending',
                ownerKind: 'system',
                payloadJson: JSON.stringify(payload),
                createdAt: now,
                updatedAt: now
            })
            .run()

        return id
    }

    private write<T>(action: (tx: Tx, now: number) => T): T {
        return this.db.transaction(
            (tx) => {
                const now = this.clock()
                this.integer(now, 0)

                return action(tx, now)
            },
            { behavior: 'immediate' }
        )
    }

    private integer(value: number, min = Number.MIN_SAFE_INTEGER) {
        if (!Number.isSafeInteger(value) || value < min) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }
    }

    private nonempty(values: unknown[]) {
        if (!Array.isArray(values) || values.length === 0) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }
    }

    private page(limit: number, offset: number) {
        this.integer(limit, 1)
        this.integer(offset, 0)

        if (limit > 200 || !Number.isSafeInteger(limit + offset)) {
            throw new MediaRepositoryError('INVALID_ARGUMENT')
        }
    }
}

export type MediaSummary = ReturnType<MediaRepository['list']>['data'][number]

export type MediaDetail = NonNullable<ReturnType<MediaRepository['get']>>

export type PagedMediaDetail = NonNullable<ReturnType<MediaRepository['getPage']>>
