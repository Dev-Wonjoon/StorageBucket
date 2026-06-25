import { db, upsertFtsEntry, deleteFtsEntry } from '../../database'
import { downloadUrls, favorites, medias, platforms, profiles } from '../../database/schema'
import { eq, and, desc } from 'drizzle-orm'
import { Media } from '../../shared/types'
import { cleanUrl } from '../utils/ArgsUtils'
import fs from 'fs'

    const deleteFileIfExists = async(filepath?: string | null): Promise<void> => {
        if(!filepath) return

        const fs = await import('fs/promises')

        try {
            await fs.unlink(filepath)
        } catch(error) {
            if(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                return
            }

            console.warn('[MediaService] File delete failed:', error)
        }
    }

export const MediaService = {


    async getAll() {
        const rows = db
            .select({
                media: medias,
                url: downloadUrls.url,
                author: profiles.ownerName,
                platform: platforms.name,
                favorite: favorites.id
            })
            .from(medias)
            .leftJoin(downloadUrls, eq(medias.urlId, downloadUrls.id))
            .leftJoin(profiles, eq(medias.profileId, profiles.id))
            .leftJoin(platforms, eq(medias.platformId, platforms.id))
            .leftJoin(favorites, eq(medias.id, favorites.mediaId))
            .orderBy(desc(medias.createdAt))
            .limit(60)
            .all()
        return rows.map((row) => ({
            ...row.media,
            url: row.url ?? null,
            author: row.author ?? null,
            platform: row.platform ?? null,
            isFavorite: !!row.favorite
        }))
    },

    async delete(id: number) {
        const media = db.select().from(medias).where(eq(medias.id, id)).get()
        if (!media) return

        await deleteFileIfExists(media.filepath)
        await deleteFileIfExists(media.thumbnailPath)

        db.transaction((tx) => {
            tx.delete(medias).where(eq(medias.id, id)).run()

            if (media.urlId) {
                const stillUsed = tx
                    .select({ id: medias.id })
                    .from(medias)
                    .where(eq(medias.urlId, media.urlId))
                    .get()

                if (!stillUsed) {
                    tx.delete(downloadUrls).where(eq(downloadUrls.id, media.urlId)).run()
                }
            }
        })

        deleteFtsEntry(id)
    },

    getFilepathById(id: number): string | null {
        const media = db
            .select({ filepath: medias.filepath})
            .from(medias)
            .where(eq(medias.id, id))
            .get()

        return media?.filepath ?? null
    },

    registerMedia(
        metadata: any, 
        localFilepath: string, 
        thumbnailPath: string | null,
        createdAtValue?: Date | string | null
    ): Media {
        return db.transaction((tx) => {
            const platformName = metadata.extractor_key || metadata.extractor || 'unknown'
            let platformId: number

            const existingPlatform = tx
                .select()
                .from(platforms)
                .where(eq(platforms.name, platformName))
                .get()

            if (existingPlatform) {
                platformId = existingPlatform.id
            } else {
                const newPlatform = tx
                    .insert(platforms)
                    .values({ name: platformName })
                    .returning()
                    .get()
                platformId = newPlatform.id
            }

            const uploaderName =
                metadata.uploader || metadata.channel || metadata.uploader_id || 'unknown'
            const uploaderId =
                metadata.uploader_id ||
                metadata.channel_id ||
                metadata.uploader_url ||
                metadata.channel ||
                metadata.uploader ||
                metadata.webpage_url ||
                metadata.id

            let profileId: number

            const exsitingProfile = tx
                .select()
                .from(profiles)
                .where(and(eq(profiles.ownerId, uploaderId), eq(profiles.platformId, platformId)))
                .get()

            if (exsitingProfile) {
                profileId = exsitingProfile.id

                if (exsitingProfile.ownerName !== uploaderName) {
                    tx.update(profiles)
                        .set({ ownerName: uploaderName, updatedAt: new Date() })
                        .where(eq(profiles.id, profileId))
                        .run()
                }
            } else {
                const newProfile = tx
                    .insert(profiles)
                    .values({
                        ownerId: uploaderId,
                        ownerName: uploaderName,
                        platformId: platformId
                    })
                    .returning()
                    .get()
                profileId = newProfile.id
            }

            const mediaUrl = cleanUrl(metadata.webpage_url || metadata.original_url)
            const videoId = metadata.id || null
            let urlId: number | null = null

            if (mediaUrl) {
                const existingUrl = tx
                    .select()
                    .from(downloadUrls)
                    .where(eq(downloadUrls.url, mediaUrl))
                    .get()

                if (existingUrl) {
                    urlId = existingUrl.id
                    if (!existingUrl.videoId && videoId) {
                        tx.update(downloadUrls)
                            .set({ videoId })
                            .where(eq(downloadUrls.id, existingUrl.id))
                            .run()
                    }
                } else {
                    const newUrl = tx
                        .insert(downloadUrls)
                        .values({ url: mediaUrl, videoId })
                        .returning()
                        .get()
                    urlId = newUrl.id
                }
            }

            const fileSize = metadata.filesize || fs.statSync(localFilepath).size
            const createdAt = createdAtValue ? new Date(createdAtValue) : new Date()

            const newMedia = tx
                .insert(medias)
                .values({
                    title: metadata.title || 'Untitled',
                    filepath: localFilepath,
                    filesize: fileSize || null,
                    thumbnailPath: thumbnailPath,
                    urlId: urlId,
                    platformId: platformId,
                    profileId: profileId,
                    createdAt,
                    updatedAt: new Date()
                })
                .returning()
                .get()

            console.log(`[MediaService] Registered media: ${newMedia.title} (ID: ${newMedia.id})`)

            // FTS 인덱스 갱신
            setTimeout(() => upsertFtsEntry(newMedia.id), 0)
            return newMedia as Media
        })
    }
}
