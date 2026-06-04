import { app } from "electron";
import { join, dirname } from 'path';
import Database from "better-sqlite3";
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from './schema';
import { existsSync, mkdirSync, renameSync } from "fs";
import { getDatabasePath, getLegacyDatabasePath } from "../main/utils/portablePath";

const dbPath = getDatabasePath();
const dbFolder = dirname(dbPath);
const legacyDbPath = getLegacyDatabasePath();

if(!existsSync(dbFolder)) {
    console.log(`[Database] Creating folder: ${dbFolder}`);
    mkdirSync(dbFolder, { recursive: true });
}
console.log(`[Database] File path: ${dbPath}`);

if(!existsSync(dbPath) && existsSync(legacyDbPath)) {
    console.log(`[Database] Moving legacy database: ${legacyDbPath} -> ${dbPath}`);
    renameSync(legacyDbPath, dbPath);
}


let sqlite = new Database(dbPath);

export const db = drizzle(sqlite, { schema });

export const initDB = () => {
    const migrationsFolder = app.isPackaged
        ? join(process.resourcesPath, 'drizzle')
        : join(app.getAppPath(), 'drizzle');
    
    console.log(`[Database] Running migrations from: ${migrationsFolder}`);

    try {
        migrate(db, { migrationsFolder });
        console.log('[Database] Migration Completed.');
    } catch(error) {
        console.error('[Database] Migration failed:', error);
    }
}

app.on('before-quit', () => {
    sqlite.close();
})


// ----------------------------------------------------------------------
// FTS5 유틸
// ----------------------------------------------------------------------
export const createFtsTable = () => {
    sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS media_fts USING fts5(
            title,
            owner_name,
            url,
            tag_names
        );
    `);
};


// FTS 인덱스 전체 재구축
export const rebuildFtsIndex = () => {
    sqlite.exec('DELETE FROM media_fts');
    sqlite.exec(`
        INSERT INTO media_fts(rowid, title, owner_name, url, tag_names)
        SELECT
            m.id,
            m.title,
            COALESCE(p.owner_name, ''),
            COALESCE(u.url, ''),
            COALESCE(
                (SELECT GROUP_CONCAT(t.name, ' ')
                FROM media_tag mt
                JOIN tag t ON mt.tag_id = t.id
                WHERE mt.media_id = m.id),
                ''
            )
            FROM media m
            LEFT JOIN profiles p ON m.profile_id = p.id
            LEFT JOIN download_urls u ON m.url_id = u.id
    `);
};

// FTS 단건 갱신
export const upsertFtsEntry = (mediaId: number) => {
    sqlite.prepare('DELETE FROM media_fts WHERE rowid = ?').run(mediaId);
    sqlite.prepare(`
        INSERT INTO media_fts(rowid, title, owner_name, url, tag_names)
        SELECT
            m.id,
            m.title,
            COALESCE(p.owner_name, ''),
            COALESCE(u.url, ''),
            COALESCE(
                (SELECT GROUP_CONCAT(t.name, ' ')
                    FROM media_tag mt
                    JOIN tag t ON mt.tag_id = t.id
                    WHERE mt.media_id = m.id),
                ''
            )
        FROM media m
        LEFT JOIN profiles p ON m.profile_id = p.id
        LEFT JOIN download_urls u ON m.url_id = u.id
        WHERE m.id = ?
    `).run(mediaId);
};

// FTS 단건 삭제
export const deleteFtsEntry = (mediaId: number) => {
    sqlite.prepare('DELETE FROM media_fts WHERE rowid = ?').run(mediaId);
};

export const getFtsCount = (): number => {
    const result = sqlite.prepare('SELECT COUNT(*) as cnt FROM media_fts').get() as { cnt: number };
    return result.cnt;
};

export const getMediaCount = (): number => {
    const result = sqlite.prepare('SELECT COUNT(*) as cnt FROM media').get() as { cnt: number };
    return result.cnt;
};

