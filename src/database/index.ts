import { app } from "electron";
import { join, dirname } from 'path';
import Database from "better-sqlite3";
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from './schema';
import { existsSync, mkdirSync } from "fs";

const getDbPath = () => {
    if(app.isPackaged) {
        return join(dirname(app.getPath('exe')), 'storagebucket.db');
    }
    return join(process.cwd(), 'storagebucket.db');
}

const dbPath = getDbPath();
const dbFolder = dirname(dbPath);

if(!existsSync(dbFolder)) {
    console.log(`[Database] Creating folder: ${dbFolder}`);
    mkdirSync(dbFolder, { recursive: true });
}
console.log(`[Database] File path: ${dbPath}`);

let sqlite;
try {
    sqlite = new Database(dbPath, {
        verbose: console.log
    });
} catch(error) {
    console.error('[Database] Connection Failed. Check if file is locked.');
    throw error;
}

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