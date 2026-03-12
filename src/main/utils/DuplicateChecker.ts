import { eq, inArray } from "drizzle-orm";
import { db } from "../../database";
import { medias } from "../../database/schema";
import { fetchVideoIds } from './YtdlpTask';

export interface DuplicateResult {
    isDuplicate: boolean;
    method: 'videoId' | 'url';
    totalCount: number;
    duplicateCount: number;
    matchedIds?: string[];
}

export async function checkDuplicate(url: string): Promise<DuplicateResult> {
    try {
        
        // URL 빠른 DB 조회
        const existingByUrl = db.select().from(medias).where(eq(medias.url, url)).get();
        if(existingByUrl) {
            return {
                isDuplicate: true,
                method: 'url',
                totalCount: 1,
                duplicateCount: 1,
            };
        }

        // videoId 기반 정밀 체크
        const videoIds = await fetchVideoIds(url);
        if(videoIds.length === 0) {
            return { isDuplicate: false, method: 'videoId', totalCount: 0, duplicateCount: 0 };
        }

        const existingMedias = db.select({ videoId: medias.videoId })
            .from(medias)
            .where(inArray(medias.videoId, videoIds))
            .all();
        
        const matchedIds = existingMedias
            .map(m => m.videoId)
            .filter((id): id is string => id !== null);

        return {
            isDuplicate: matchedIds.length > 0 && matchedIds.length === videoIds.length, 
            method: 'videoId',
            totalCount: videoIds.length,
            duplicateCount: matchedIds.length,
            matchedIds,
        };
    } catch(error) {
        console.warn('[DuplicateChecker] fetchVideoIds failed, falling back to URL check:', error);
    }
    return { isDuplicate: false, method: 'url', totalCount: 1, duplicateCount: 0 };
}