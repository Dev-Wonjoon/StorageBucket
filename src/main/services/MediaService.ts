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
            throw new Error("Download failed: No result returned");
        }

        return await this.registerMedia(result.metadata, result.videoPath, result.thumbnailPath);
    },
    
    async getAll() {
        return await db.select().from(medias).orderBy(desc(medias.createdAt));
    },

    async registerMedia(metadata: any, localFilepath: string, thumbnailPath: string | null): Promise<Media> {
        return await db.transaction(async (tx) => {
            const platformName = metadata.extractor_key || metadata.extractor || 'unknown';
            let platformId: number;

            const existingPlatform = await tx.query.platforms.findFirst({
                where: eq(platforms.name, platformName)
            });

            if(existingPlatform) {
                platformId = existingPlatform.id;
            } else {
                const [newPlatform] = await tx.insert(platforms).values({ name: platformName }).returning();
                platformId = newPlatform.id;
            }

            const uploaderId = metadata.uploaderId || 'unknown';
            const uploaderName = metadata.uploader || 'unknown';
            let profileId: number = 0;

            const existingProfile = await tx.query.profiles.findFirst({
                where: and(
                    eq(profiles.ownerId, uploaderId),
                    eq(profiles.ownerName, uploaderName)
                )
            });

            if(existingProfile) {
                profileId = existingProfile.id;

                if(existingProfile.ownerName !== uploaderName) {
                    await tx.update(profiles)
                        .set({ ownerName: uploaderName, updatedAt: new Date() })
                        .where(eq(profiles.id, profileId));
                }
            } else {
                const [newProfile] = await tx.insert(profiles).values({
                    ownerId: uploaderId,
                    ownerName: uploaderName,
                    platformId: platformId
                }).returning();
                profileId = newProfile.id;
            }

            const [newMedia] = await tx.insert(medias).values({
                title: metadata.title || 'Untitled',
                filepath: localFilepath,
                url: metadata.webpage_url || metadata.original_url,
                filesize: metadata.filesize || null,
                thumbnailPath: thumbnailPath,
                platformId: platformId,
                profileId: profileId,
                createdAt: new Date(),
                updatedAt: new Date()
            }).returning();

            console.log(`[MediaService] Registered media: ${newMedia.title} (ID: ${newMedia.id})`);

            return newMedia as Media;
        })
    }
}