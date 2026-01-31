import { db } from '../../database';
import { medias, platforms, profiles } from '../../database/schema';
import { eq, and, desc } from 'drizzle-orm';
import { Media } from '../../shared/types';
import { ConfigManager } from '../managers/ConfigManager';
import { downloadVideoTask } from '../handlers/DownloadHandler';

export const MediaService = {

    async processMediaFromUrl(url: string) {
        console.log(`[MediaService] Processing URL: ${url}`);

        const downloadPath = ConfigManager.getInstance().getDownloadPath();

        const result = await downloadVideoTask(url, downloadPath);
        if(!result) {
            throw new Error('Download failed: No result returned');
        }

        return this.registerMedia(result.metadata, result.videoPath, result.thumbnailPath);
    },
    
    async getAll() {
        return await db.select().from(medias).orderBy(desc(medias.createdAt));
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