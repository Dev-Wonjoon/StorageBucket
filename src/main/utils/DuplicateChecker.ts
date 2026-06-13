import { eq, inArray } from 'drizzle-orm'
import { db } from '../../database'
import { downloadUrls, medias } from '../../database/schema'
import { fetchVideoIds } from './YtdlpTask'

export interface DuplicateResult {
    isDuplicate: boolean
    method: 'videoId' | 'url'
    totalCount: number
    duplicateCount: number
    matchedIds?: string[]
}

export function checkUrlDuplicate(url: string): boolean {
    const existing = db
        .select({ id: medias.id })
        .from(medias)
        .innerJoin(downloadUrls, eq(medias.urlId, downloadUrls.id))
        .where(eq(downloadUrls.url, url))
        .get()

    return !!existing
}

export async function checkDuplicate(url: string): Promise<DuplicateResult> {
    try {
        const existingByUrl = db.select().from(downloadUrls).where(eq(downloadUrls.url, url)).get()
        if (existingByUrl) {
            return {
                isDuplicate: true,
                method: 'url',
                totalCount: 1,
                duplicateCount: 1
            }
        }

        const videoIds = await fetchVideoIds(url)
        if (videoIds.length === 0) {
            return { isDuplicate: false, method: 'videoId', totalCount: 0, duplicateCount: 0 }
        }

        const existingUrls = db
            .select({ videoId: downloadUrls.videoId })
            .from(downloadUrls)
            .where(inArray(downloadUrls.videoId, videoIds))
            .all()

        const matchedIds = existingUrls
            .map((u) => u.videoId)
            .filter((id): id is string => id !== null)

        return {
            isDuplicate: matchedIds.length > 0 && matchedIds.length === videoIds.length,
            method: 'videoId',
            totalCount: videoIds.length,
            duplicateCount: matchedIds.length,
            matchedIds
        }
    } catch (error) {
        console.warn('[Duplicate] fetchVideoIds failed, falling back to URL check:', error)
        return { isDuplicate: false, method: 'url', totalCount: 0, duplicateCount: 0 }
    }
}
