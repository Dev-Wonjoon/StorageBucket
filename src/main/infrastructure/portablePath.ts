import { app } from 'electron';
import { join } from 'path';

const getPortableDirectory = (): string | undefined => {
    const directory = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
    return directory || undefined
}

export const getDatabasePath = (): string => {
    if(!app.isPackaged) {
        return join(process.cwd(), 'storagebucket.db')
    }

    return join(getPortableDirectory() ?? app.getPath('userData'), 'storagebucket.db')
}

export const getAppDataPath = (): string => {
    if(!app.isPackaged) {
        return join(process.cwd(), 'data')
    }

    const portableDirectory = getPortableDirectory()
    return portableDirectory
        ? join(portableDirectory, 'data')
        : app.getPath('userData')
}