import { db } from '../../database';
import { favorites, medias, platforms, profiles } from '../../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Media } from '../../shared/types';

export const MediaService = {
    
    async getAll() {
        const rows = db
            .select()
            .from(medias)
            .leftJoin(favorites, eq(favorites.mediaId, medias.id))
            .orderBy(desc(medias.createdAt))
            .all();
        
        return rows.map(row => ({
            ...row.media,
            isFavorite: !!row.favorite,
        }));
    },

    async delete(id: number) {
        const media = db.select().from(medias).where(eq(medias.id, id)).get();
        if(!media) return

        const fs = await import('fs/promises');
        try {
            await fs.unlink(media.filepath);
            if(media.thumbnailPath) await fs.unlink(media.thumbnailPath);
        } catch(error) {
            console.warn('[MediaService] File delete failed:', error);
        }

        db.delete(medias).where(eq(medias.id, id)).run();
    },
    
    registerMedia(metadata: any, localFilepath: string, thumbnailPath: string | null): Media {
        return db.transaction((tx) => {
            const platformName = metadata.extractor_key || metadata.extractor || 'unknown';
            let platformId: number;

            const existingPlatform = tx.select()
                .from(platforms)
                .where(eq(platforms.name, platformName))
                .get();
            
            if(existingPlatform) {
                platformId = existingPlatform.id;
            } else {
                const newPlatform = tx.insert(platforms)
                    .values({ name: platformName })
                    .returning()
                    .get();
                platformId = newPlatform.id;
            }

            const uploaderId = metadata.uploader_id || metadata.uploader_url || 'unknown';
            const uploaderName = metadata.uploader || 'unknown';
            let profileId: number;

            const exsitingProfile = tx.select()
                .from(profiles)
                .where(and(
                    eq(profiles.ownerId, uploaderId),
                    eq(profiles.platformId, platformId)
                ))
                .get();
            if(exsitingProfile) {
                profileId = exsitingProfile.id;

                if(exsitingProfile.ownerName !== uploaderName) {
                    tx.update(profiles)
                        .set({ ownerName: uploaderName, updatedAt: new Date() })
                        .where(eq(profiles.id, profileId))
                        .run();
                }
            } else {
                const newProfile = tx.insert(profiles)
                    .values({
                        ownerId: uploaderId,
                        ownerName: uploaderName,
                        platformId: platformId
                    })
                    .returning()
                    .get();
                profileId = newProfile.id;
            }

            const newMedia = tx.insert(medias).values({
                title: metadata.title || 'Untitled',
                filepath: localFilepath,
                url: metadata.webpage_url || metadata.original_url,
                filesize: metadata.filesize || null,
                thumbnailPath: thumbnailPath,
                platformId: platformId,
                profileId: profileId,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning().get();

            console.log(`[MediaService] Registered media: ${newMedia.title} (ID: ${newMedia.id})`);

            return newMedia as Media;
        })
    }
}