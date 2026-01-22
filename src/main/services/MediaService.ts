import { db } from '../../database';
import { medias, mediaTags, tags, profiles, platforms } from '../../database/schema';
import { desc, like, sql, and, gte, lte, or, type SQL, type Column, eq, inArray, count } from 'drizzle-orm';
import { Media, MediaSearchRequest, MediaSearchResult } from '../../shared/types';


type SearchConfigType = {
    [key: string]: {
        column?: Column;
        type: 'text' | 'multi-or' | 'relation-and';
        table?: any;
    }
}

const SEARCH_CONFIG: SearchConfigType = {
    title: {
        column: medias.title,
        type: 'text'
    },

    author: {
        column: profiles.ownerName,
        type: 'multi-or'
    },
    platform: {
        column: platforms.name,
        type: 'multi-or'
    },
    tags: {
        type: 'relation-and'
    }
}

export const MediaService = {
    async search(request: MediaSearchRequest): Promise<MediaSearchResult> {
        const { page = 1, limit = 50, startDate, endDate, ...filters } = request;
        const offset = (page - 1) * limit;

        const conditions: SQL[] = [];

        Object.entries(filters).forEach(([key, rawValue]) => {
            const config = SEARCH_CONFIG[key];
            if (!config || rawValue === undefined || rawValue === null || rawValue === '') return;

            const values = Array.isArray(rawValue) ? rawValue : [rawValue];
            if (values.length === 0) return;

            if(config.type === 'text' && config.column) { 
                // A. 단순 텍스트 포함 검색
                conditions.push(like(config.column, `%${values[0]}%`));

            } else if(config.type === 'multi-or' && config.column) { 
                // B. 다중 OR 검색
                const orConditions = values.map(v => like(config.column!, `%${v}%`));
                conditions.push(or(...orConditions));

            } else if (config.type === 'relation-and' && key === 'tags') { 
                // C. 태그 AND 검색
                const subQuery = db
                    .select({ mediaId: mediaTags.mediaId })
                    .from(mediaTags)
                    .innerJoin(tags, eq(mediaTags.tagId, tags.id))
                    .where(inArray(tags.name, values))
                    .groupBy(mediaTags.mediaId)
                    .having(eq(count(tags.id), values.length));
                conditions.push(inArray(medias.id, subQuery));
            }
        });

        if (startDate) conditions.push(gte(medias.createdAt, new Date(startDate)));
        if (endDate) conditions.push(lte(medias.updatedAt, new Date(endDate)));

        const baseJoin = (qb: any) => qb
            .leftJoin(profiles, eq(medias.profileId, profiles.id))
            .leftJoin(platforms, eq(medias.platformId, platforms.id));

        const dataQuery = baseJoin(
            db.select({
                id: medias.id,
                title: medias.title,
                filepath: medias.filepath,
                url: medias.url,
                thumbnailPath: medias.thumbnailPath,
                createdAt: medias.createdAt,
                author: profiles.ownerName,
                platform: platforms.name,

                platformId: medias.platformId,
                profileId: medias.profileId,
            }).from(medias).$dynamic()
        );

        const countQuery = baseJoin(
            db.select({ count: count(medias.id) }).from(medias).$dynamic()
        );

        const [totalResult, data] = await Promise.all([
            countQuery.where(and(...conditions)).then(res => res[0]),
            dataQuery
                .where(and(...conditions))
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

    async suggestPlatforms(keyword: string): Promise<string[]> {
        if(!keyword) return [];
        const results = await db
            .selectDistinct({ name: platforms.name })
            .from(platforms)
            .where(like(platforms.name, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name || '').filter(Boolean);
    },

    async suggestAuthors(keyword: string): Promise<string[]> {
        if(!keyword) return [];
        const results = await db
            .selectDistinct({ name: profiles.ownerName })
            .from(profiles)
            .where(like(profiles.ownerName, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name || '').filter(Boolean);
    },

    async suggestTags(keyword: string): Promise<string[]> {
        if(!keyword) return [];
        const results = await db
            .selectDistinct({ name: tags.name })
            .from(tags)
            .where(like(tags.name, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name);
    }
};