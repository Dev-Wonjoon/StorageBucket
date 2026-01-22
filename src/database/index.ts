import { app } from "electron";
import { join, dirname } from 'path';
import Database from "better-sqlite3";
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const getDbPath = () => {
    if(app.isPackaged) {
        return join(dirname(app.getPath('exe')), 'storagebucket.db');
    }

    return join(process.cwd(), '../../storagebucket.db')
}

const sqlite = new Database(getDbPath(), {
    verbose: console.log
});

export const db = drizzle(sqlite, { schema });

app.on('before-quit', () => {
    sqlite.close();
})