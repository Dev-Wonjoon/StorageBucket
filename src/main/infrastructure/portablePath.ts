import { app } from 'electron'
import { join } from 'node:path'

const getPortableDirectory = (): string | undefined => {
    const directory = process.env.PORTABLE_EXECUTABLE_DIR?.trim()
    return directory || undefined
}

// 프로그램 업데이트와 분리하여 쓰기 가능한 기본 경로를 정한다.
export const getWritableBasePath = (): string => {
    if (!app.isPackaged) {
        return app.getAppPath()
    }

    return getPortableDirectory() ?? app.getPath('userData')
}

export const getDatabasePath = (): string => {
    if (!app.isPackaged) {
        return join(process.cwd(), 'storagebucket.db')
    }

    return join(getWritableBasePath(), 'storagebucket.db')
}

export const getAppDataPath = (): string => {
    if (!app.isPackaged) {
        return join(process.cwd(), 'data')
    }

    const portableDirectory = getPortableDirectory()

    return portableDirectory ? join(portableDirectory, 'data') : app.getPath('userData')
}

export const getDefaultDownloadPath = (): string => {
    if (!app.isPackaged || getPortableDirectory()) {
        return join(getWritableBasePath(), 'downloads')
    }

    return join(app.getPath('downloads'), 'StorageBucket')
}
