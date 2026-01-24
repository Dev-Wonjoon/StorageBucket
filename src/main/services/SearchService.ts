import { db } from '../../database';
import { medias, mediaTags, tags, profiles, platforms } from '../../database/schema';
import { desc, like, and, gte, lte, or, type SQL, type Column, eq, inArray, count } from 'drizzle-orm';
import { Media, MediaSearchRequest, MediaSearchResult } from '../../shared/types';

type SearchConfigType = {
    [key: string]: {
        column?: Column;
        type: 'text' | 'multi-or' | 'relation-and';
    }
}

const SEARCH_CONFIG: SearchConfigType = {
    title: { column: medias.title, type: 'text' },
    author: { column: profiles.ownerName, type: 'multi-or' },
    platform: { column: platforms.name, type: 'multi-or' },
    tags: { type: 'relation-and' }
}

export const SearchService = {
    async search(request: MediaSearchRequest): Promise<MediaSearchResult> {
        const { page = 1, limit = 50, startDate, endDate, ...filters } = request;
        const offset = (page - 1) * limit;

        const conditions: SQL[] = [];

        Object.entries(filters).forEach(([key, rawValue]) => {
            const config = SEARCH_CONFIG[key];
            if(!config || rawValue === undefined || rawValue === null || rawValue === '') return;

            const values = Array.isArray(rawValue) ? rawValue : [rawValue];
            if(values.length === 0) return;

            if(config.type === 'text' && config.column) {
                conditions.push(like(config.column, `%${values[0]}%`));
            }
            else if(config.type === 'multi-or' && config.column) {
                const orConditions = values.map(v => like(config.column!, `%${v}%`));
                const orClause = or(...orConditions);
                if(orClause) conditions.push(orClause);
            }
            else if(config.type === 'relation-and' && key === 'tags') {
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

        if(startDate) conditions.push(gte(medias.createdAt, new Date(startDate)));
        if(endDate) conditions.push(lte(medias.updatedAt, new Date(endDate)));

        const baseJoin = (qb: any) => qb
            .leftJoin(profiles, eq(medias.profileId, profiles.id))
            .leftJoin(platforms, eq(medias.platformId, platforms.id));

        let dataQuery = baseJoin(
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

        let countQuery = baseJoin(
            db.select({ count: count(medias.id) }).from(medias).$dynamic()
        );

        if(conditions.length > 0) {
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
    
    async suggestAuthors(keyword: string): Promise<string[]> {
        if(!keyword) return [];
        const results = await db
            .selectDistinct({ name: profiles.ownerName })
            .from(profiles)
            .where(like(profiles.ownerName, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name || '').filter(Boolean);
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

    async suggestTags(keyword: string): Promise<string[]> {
        if(!keyword) return [];
        const results = await db
            .selectDistinct({ name: tags.name })
            .from(tags)
            .where(like(tags.name, `%${keyword}%`))
            .limit(10);
        return results.map(r => r.name);
    }
}