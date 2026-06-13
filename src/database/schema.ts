import { relations, sql } from 'drizzle-orm'
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ----------------------------------------------------------------------
// Platform
// ----------------------------------------------------------------------
export const platforms = sqliteTable('platform', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique()
})

export const platformRelations = relations(platforms, ({ many }) => ({
    medias: many(medias),
    profiles: many(profiles)
}))
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// Profile
// ----------------------------------------------------------------------
export const profiles = sqliteTable(
    'profiles',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        ownerId: text('owner_id').notNull(),
        ownerName: text('owner_name'),
        platformId: integer('platform_id')
            .notNull()
            .references(() => platforms.id),
        updatedAt: integer('updated_at', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date())
            .$onUpdateFn(() => new Date())
    },
    (table) => ({
        uqOwnerPlatform: uniqueIndex('uq_owner_platform').on(table.ownerId, table.platformId)
    })
)

export const profileRelations = relations(profiles, ({ one, many }) => ({
    platform: one(platforms, {
        fields: [profiles.platformId],
        references: [platforms.id]
    }),
    medias: many(medias)
}))
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// Media
// ----------------------------------------------------------------------
export const medias = sqliteTable('media', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    title: text('title').notNull(),
    filepath: text('filepath').notNull(),
    filesize: integer('filesize'),
    thumbnailPath: text('thumbnail_path'),

    urlId: integer('url_id').references(() => downloadUrls.id),
    platformId: integer('platform_id').references(() => platforms.id),
    profileId: integer('profile_id').references(() => profiles.id),

    createdAt: integer('created_at', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date())
})

export const mediaRelations = relations(medias, ({ one, many }) => ({
    downloadUrl: one(downloadUrls, {
        fields: [medias.urlId],
        references: [downloadUrls.id]
    }),
    platform: one(platforms, {
        fields: [medias.platformId],
        references: [platforms.id]
    }),
    profile: one(profiles, {
        fields: [medias.profileId],
        references: [profiles.id]
    }),
    mediaTags: many(mediaTags),
    favorite: one(favorites)
}))
// ----------------------------------------------------------------------

// ----------------------------------------------------------------------
// URL
// ----------------------------------------------------------------------
export const downloadUrls = sqliteTable('download_urls', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    url: text('url').notNull().unique(),
    videoId: text('video_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
        .notNull()
        .$defaultFn(() => new Date())
})

export const downloadUrlRelations = relations(downloadUrls, ({ many }) => ({
    medias: many(medias)
}))

// ----------------------------------------------------------------------
// Tag
// ----------------------------------------------------------------------
export const tags = sqliteTable('tag', {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
        .$defaultFn(() => new Date())
        .$onUpdateFn(() => new Date())
})

export const mediaTags = sqliteTable(
    'media_tag',
    {
        mediaId: integer('media_id')
            .notNull()
            .references(() => medias.id, { onDelete: 'cascade' }),
        tagId: integer('tag_id')
            .notNull()
            .references(() => tags.id, { onDelete: 'cascade' })
    },
    (table) => ({
        pk: primaryKey({ columns: [table.mediaId, table.tagId] })
    })
)

export const mediaTagRelations = relations(mediaTags, ({ one }) => ({
    media: one(medias, {
        fields: [mediaTags.mediaId],
        references: [medias.id]
    }),
    tag: one(tags, {
        fields: [mediaTags.tagId],
        references: [tags.id]
    })
}))

// ----------------------------------------------------------------------
// Favorite
// ----------------------------------------------------------------------
export const favorites = sqliteTable(
    'favorite',
    {
        id: integer('id').primaryKey({ autoIncrement: true }),
        mediaId: integer('media_id')
            .notNull()
            .references(() => medias.id, { onDelete: 'cascade' }),
        createdAt: integer('created_at', { mode: 'timestamp' })
            .notNull()
            .$defaultFn(() => new Date())
    },
    (table) => ({
        uqMedia: uniqueIndex('uq_favorite_media').on(table.mediaId)
    })
)

export const favoritesRelations = relations(favorites, ({ one }) => ({
    media: one(medias, {
        fields: [favorites.mediaId],
        references: [medias.id]
    })
}))

// ----------------------------------------------------------------------
// Download Queue
// ----------------------------------------------------------------------
export const downloadQueue = sqliteTable('download_queue', {
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    status: text('status').notNull(),
    options: text('options', { mode: 'json' }),
    progress: integer('progress').default(0),
    title: text('title'),
    thumbnail: text('thumbnail'),
    errorMessage: text('error_message'),
    log: text('log', { mode: 'json' }),
    startedAt: integer('started_at', { mode: 'timestamp' }),
    finishedAt: integer('finished_at', { mode: 'timestamp' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`)
})
