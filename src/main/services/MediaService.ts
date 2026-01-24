import { db } from '../../database';
import { medias, mediaTags, tags, profiles, platforms } from '../../database/schema';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { Media } from '../../shared/types';

export const MediaService = {

    async getAll() {
        return await db.select().from(medias).orderBy(desc(medias.createdAt));
    },


    async findByUrl(url: string): Promise<Media | undefined> {
        const result = await db
            .select()
            .from(medias)
            .where(eq(medias.url, url))
            .limit(1);
        return result[0] as Media;
    },

    async deleteBatch(ids: number[]) {
        return await db.delete(medias).where(inArray(medias.id, ids));
    },

    async registerMediaFromYtdlp(metadata: any, localFilepath: string): Promise<Media> {
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

            const uploaderId = metadata.uploader_id || 'unknown';
            const uploaderName = metadata.uploader || 'unknown';
            let profileId: number;

            const existingProfile = await tx.query.profiles.findFirst({
                where: and(
                    eq(profiles.ownerId, uploaderId),
                    eq(profiles.platformId, platformId)
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
                thumbnailPath: localThumbnailPath || null,
                platformId: platformId,
                profileId: profileId,

                createdAt: new Date(),
                updatedAt: new Date()
            }).returning();
            return newMedia as Media;
        });
    }
}
