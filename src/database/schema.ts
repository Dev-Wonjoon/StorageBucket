import { relations } from "drizzle-orm";
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";



// ----------------------------------------------------------------------
// Platform
// ----------------------------------------------------------------------
export const platforms = sqliteTable('platform', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
});

export const platformRelations = relations(platforms, ({ many }) => ({
    medias: many(medias),
    profiles: many(profiles),
}));
// ----------------------------------------------------------------------



// ----------------------------------------------------------------------
// Profile
// ----------------------------------------------------------------------
export const profiles = sqliteTable('profiles', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: text('owner_id').notNull(),
    ownerName: text('owner_name'),
    platformId: integer('platform_id')
        .notNull()
        .references(() => platforms.id),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date()),
}, (table) => ({
    ownerIdx: uniqueIndex('idx_profile_owner_id').on(table.ownerId),
    uqOwnerPlatform: uniqueIndex('uq_owner_platform').on(table.ownerId, table.platformId),
}));

export const profileRelations = relations(profiles, ({ one, many }) => ({
    platform: one(platforms, {
        fields: [profiles.platformId],
        references: [platforms.id]
    }),
    medias: many(medias)
}));
// ----------------------------------------------------------------------



// ----------------------------------------------------------------------
// Media
// ----------------------------------------------------------------------
export const medias = sqliteTable('media', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    filepath: text('filepath').notNull(),
    url: text('url'),
    filesize: integer('filesize'),
    thumbnailPath: text('thumbnail_path'),

    platformId: integer('platform_id').references(() => platforms.id),
    profileId: integer('profile_id').references(() => profiles.id),

    createdAt: integer('created_at', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date()),
});

export const mediaRelations = relations(medias, ({ one, many }) => ({
    platform: one(platforms, {
        fields: [medias.platformId],
        references: [platforms.id],
    }),
    profile: one(profiles, {
        fields: [medias.profileId],
        references: [profiles.id],
    }),
    mediaTags: many(mediaTags),
}));
// ----------------------------------------------------------------------



// ----------------------------------------------------------------------
// Tag
// ----------------------------------------------------------------------
export const tags = sqliteTable('tag', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date()),
});

export const mediaTags = sqliteTable('media_tag', {
    mediaId: integer('media_id')
        .notNull()
        .references(() => medias.id, { onDelete: 'cascade' }),
    tagId: integer('tag_id')
        .notNull()
        .references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => ({
    pk: primaryKey({ columns: [table.mediaId, table.tagId] }),
}));

export const mediaTagRelations = relations(mediaTags, ({ one }) => ({
    media: one(medias, {
        fields: [mediaTags.mediaId],
        references: [medias.id],
    }),
    tag: one(tags, {
        fields: [mediaTags.tagId],
        references: [tags.id],
    }),
}));