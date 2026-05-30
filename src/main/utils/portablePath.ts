import { app } from "electron";
import { dirname, join } from 'path';

export const getPortableRootPath = (): string => {
    if(app.isPackaged) {
        return process.env.PORTABLE_EXECUTABLE_DIR || dirname(process.execPath);
    }

    return process.cwd();
}

export const getPortableDataPath = (): string => {
    return join(getPortableRootPath(), 'data');
}

export const getDatabasePath = (): string => {
    return join(getPortableDataPath(), 'storagebucket.db');
}

export const getLegacyDatabasePath = (): string => {
    return join(getPortableRootPath(), 'storagebucket.db');
}