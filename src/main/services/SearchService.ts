import { db, rebuildFtsIndex } from '../../database';
import { medias, mediaTags, tags, profiles, platforms, downloadUrls } from '../../database/schema';
import { desc, like, and, gte, lte, or, type SQL, eq, inArray, count, sql } from 'drizzle-orm';
import { Media, MediaSearchRequest, MediaSearchResult } from '../../shared/types';

export const SearchService = {
    // FTS5 통합 검색
    async search(request: MediaSearchRequest): Promise<MediaSearchResult> {
        const { page = 1, limit = 50, startDate, endDate, keyword, tags: tagFilter, tagMode = 'and', author, platform } = request;
        const offset = (page - 1) * limit;
        const conditions: SQL[] = [];

        // FTS5 MATCH (제목, 작성자, URL, 태그명 통합 검색)
        if (keyword && keyword.trim()) {
            const escaped = keyword.trim().replace(/"/g, '""');
            conditions.push(
                inArray(
                    medias.id,
                    sql`(SELECT rowid FROM media_fts WHERE media_fts MATCH '"${sql.raw(escaped)}"')`
                )
            );
        }

        // 태그 필터 (정확 매칭, AND 조건)
                if (tagFilter) {
            const tagValues = Array.isArray(tagFilter) ? tagFilter : [tagFilter];
            if (tagValues.length > 0) {
                const baseSubQuery = db
                    .select({ mediaId: mediaTags.mediaId })
                    .from(mediaTags)
                    .innerJoin(tags, eq(mediaTags.tagId, tags.id))
                    .where(inArray(tags.name, tagValues))
                    .groupBy(mediaTags.mediaId);

                const subQuery = tagMode === 'or'
                    ? baseSubQuery
                    : baseSubQuery.having(eq(count(tags.id), tagValues.length));

                conditions.push(inArray(medias.id, subQuery));
            }
        }


        // 플랫폼 필터
        if (platform) {
            const platformValues = Array.isArray(platform) ? platform : [platform];
            if (platformValues.length > 0) {
                conditions.push(inArray(platforms.name, platformValues));
            }
        }

        // 작성자 필터
        if (author) {
            const authorValues = Array.isArray(author) ? author : [author];
            if (authorValues.length > 0) {
                const orConditions = authorValues.map(v => like(profiles.ownerName, `%${v}%`));
                const orClause = or(...orConditions);
                if (orClause) conditions.push(orClause);
            }
        }

        // 날짜 범위
        if (startDate) conditions.push(gte(medias.createdAt, new Date(startDate)));
        if (endDate) conditions.push(lte(medias.createdAt, new Date(endDate)));

        const baseJoin = (qb: any) => qb
            .leftJoin(downloadUrls, eq(medias.urlId, downloadUrls.id))
            .leftJoin(profiles, eq(medias.profileId, profiles.id))
            .leftJoin(platforms, eq(medias.platformId, platforms.id));

        let dataQuery = baseJoin(
            db.select({
                id: medias.id,
                title: medias.title,
                filepath: medias.filepath,
                thumbnailPath: medias.thumbnailPath,
                createdAt: medias.createdAt,
                author: profiles.ownerName,
                platform: platforms.name,
                url: downloadUrls.url,
                platformId: medias.platformId,
                profileId: medias.profileId,
            }).from(medias).$dynamic()
        );

        let countQuery = baseJoin(
            db.select({ count: count(medias.id) }).from(medias).$dynamic()
        );

        if (conditions.length > 0) {
            dataQuery = dataQuery.where(and(...conditions));
            countQuery = countQuery.where(and(...conditions));
        }

        const [totalResult, data] = await Promise.all([
            countQuery.then(res => res[0]),
            dataQuery
                .limit(limit)
                .offset(offset)
                .orderBy(desc(medias.createdAt))
        ]);

        const total = totalResult ? totalResult.count : 0;

        return {
            data: data as Media[],
            total,
            hasNextPage: total > (page * limit)
        };
    },

    // 자동완성 (소규모 테이블이라 LIKE 유지)
    async suggestAuthors(keyword: string): Promise<string[]> {
        if (!keyword) return [];
        const results = await db
            .selectDistinct({ name: profiles.ownerName })
            .from(profiles)
            .where(like(profiles.ownerName, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name || '').filter(Boolean);
    },

    async suggestPlatforms(keyword: string): Promise<string[]> {
        if (!keyword) return [];
        const results = await db
            .selectDistinct({ name: platforms.name })
            .from(platforms)
            .where(like(platforms.name, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name || '').filter(Boolean);
    },

    async suggestTags(keyword: string): Promise<string[]> {
        if (!keyword) return [];
        const results = await db
            .selectDistinct({ name: tags.name })
            .from(tags)
            .where(like(tags.name, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name);
    },

    // FTS 인덱스 재구축 (설정에서 호출 가능)
    async rebuildIndex(): Promise<void> {
        rebuildFtsIndex();
    }
};
