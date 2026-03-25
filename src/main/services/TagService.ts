import { db } from "../../database";
import { tags, mediaTags } from "../../database/schema";
import { eq, and, inArray } from "drizzle-orm";

export const TagService = {
    async getAll() {
        return await db.select().from(tags);
    },

    async getByMediaId(mediaId: number) {
        return await db
            .select({ id: tags.id, name: tags.name })
            .from(mediaTags)
            .innerJoin(tags, eq(mediaTags.tagId, tags.id))
            .where(eq(mediaTags.mediaId, mediaId));
    },

    async create(name: string) {
        const existing = db
            .select()
            .from(tags)
            .where(eq(tags.name, name))
            .get();
        if(existing) return existing;

        const [created] = await db.insert(tags).values({ name }).returning();
        return created;
    },

    async rename(tagId: number, newName: string) {
        const duplicate = db
            .select()
            .from(tags)
            .where(eq(tags.name, newName))
            .get();

        if(duplicate && duplicate.id !== tagId) {
            throw new Error(`Tag name "${newName}" already exists`);
        }

        db.update(tags)
            .set({ name: newName })
            .where(eq(tags.id, tagId))
            .run();
        
        return db.select().from(tags).where(eq(tags.id, tagId)).get();
    },

    async delete(tagId: number) {
        db.delete(tags).where(eq(tags.id, tagId)).run();
    },


    // --- 단일 미디어 태그 관리 ---
    async addToMedia(mediaId: number, tagNames: string[]) {
        for(const name of tagNames) {
            const tag = await TagService.create(name);

            const existing = db
                .select()
                .from(mediaTags)
                .where(and(eq(mediaTags.mediaId, mediaId), eq(mediaTags.tagId, tag.id)))
                .get();
            
            if(!existing) {
                db.insert(mediaTags).values({ mediaId, tagId: tag.id }).run();
            }
        }
    },

    async removeFromMedia(mediaId: number, tagId: number) {
        db.delete(mediaTags)
            .where(and(eq(mediaTags.mediaId, mediaId), eq(mediaTags.tagId, tagId)))
            .run();
    },

    // --- 다중 미디어 태그 관리 ---
    async bulkAddToMedias(mediaIds: number[], tagNames: string[]) {
        const tagRecords: { id: number; name: string }[] = [];
        for(const name of tagNames) {
            tagRecords.push(await TagService.create(name));
        }

        for(const mediaId of mediaIds) {
            for(const tag of tagRecords) {
                const exists = db
                    .select()
                    .from(mediaTags)
                    .where(and(eq(mediaTags.mediaId, mediaId), eq(mediaTags.tagId, tag.id)))
                    .get();
                
                if(!exists) {
                    db.insert(mediaTags).values({ mediaId, tagId: tag.id }).run();
                }
            }
        }
    },

    async bulkRemoveFromMedias(mediaIds: number[], tagIds: number[]) {
        db.delete(mediaTags)
            .where(and(
                inArray(mediaTags.mediaId, mediaIds),
                inArray(mediaTags.tagId, tagIds),
            )).run();
    },

    async bulkReplaceOnMedias(mediaIds: number[], tagNames: string[]) {
        db.delete(mediaTags)
            .where(inArray(mediaTags.mediaId, mediaIds))
            .run();
        
        if(tagNames.length > 0) {
            await TagService.bulkAddToMedias(mediaIds, tagNames);
        }
    },
};