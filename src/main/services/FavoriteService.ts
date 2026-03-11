import { db } from "../../database";
import { favorites, medias } from "../../database/schema";
import { eq, desc } from "drizzle-orm";

export const FavoriteService = {
    async getAll() {
        return await db
            .select({ media: medias, favoriteId: favorites.id, favoriteAT: favorites.createdAt})
            .from(favorites)
            .innerJoin(medias, eq(favorites.mediaId, medias.id))
            .orderBy(desc(favorites.createdAt));
    },

    async toggle(mediaId: number): Promise<boolean> {
        const existing = db
            .select()
            .from(favorites)
            .where(eq(favorites.mediaId, mediaId))
            .get();
        
        if(existing) {
            db.delete(favorites).where(eq(favorites.id, existing.id)).run();
            return false
        } else {
            db.insert(favorites).values({ mediaId }).run();
            return true;
        }
    },

    async isFavorite(mediaId: number): Promise<boolean> {
        const row = db
            .select()
            .from(favorites)
            .where(eq(favorites.mediaId, mediaId))
            .get();
        return !!row;
    },
};