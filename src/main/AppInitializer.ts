import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'

import { getDB, initDB } from '../database/index'
import { MediaRepository } from '@features/media/MediaRepository'
import { MediaService } from '@features/media/MediaService'
import { setupMediaProtocol } from './infrastructure/protocol'
import { createDownloadHandlers } from '@features/download/DownloadHandler'
import {
    shellHandler,
    createMediaHandlers,
    type MediaServicePort
} from '@features/media/MediaHandler'
import { systemHandler } from './SystemHandler'
import type { DownloadServicePort } from '../shared/download-api'
import { BinManager } from '@features/engines/BinManager'
import { ConfigManager } from '@features/settings/ConfigManager'
import { startDownloadThumbnailWorker } from '@features/thumbnail/DownloadThumbnailRuntime'
import { createThumbnailHandlers } from '@features/thumbnail/ThumbnailHandler'
import { DownloadThumbnailRepository } from '@features/thumbnail/DownloadThumbnailRepository'
import { createDownloadRuntime } from '@features/download/DownloadRuntime'
import { recoverInterruptedDownloadsAtStartup } from '@features/download/DownloadStartupRecovery'

type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any>

export class AppInitializer {
    private mainWindow: BrowserWindow | null = null
    private mediaService: MediaServicePort | undefined
    private downloadService: DownloadServicePort | undefined
    private stopThumbnailWorker: (() => void) | undefined

    public async initialize(): Promise<void> {
        try {
            await initDB({
                legacyStorageRoot: ConfigManager.getInstance().getDownloadPath()
            })
        } catch (error) {
            console.error('DB Initialization Failed:', error)
            throw error
        }

        const recoveryConfirmed =
            process.env.STORAGEBUCKET_RECOVER_DOWNLOADS === 'confirmed-stopped'

        // 복구 표시는 엔진이나 다른 자식 프로세스로 전달하지 않는다.
        delete process.env.STORAGEBUCKET_RECOVER_DOWNLOADS

        if (recoveryConfirmed) {
            if (app.isPackaged) {
                throw new Error('이 복구 모드는 개발 실행에서만 사용할 수 있습니다.')
            }

            const recovered = recoverInterruptedDownloadsAtStartup(getDB(), true)

            console.info('[DownloadRecovery] 중단 작업 복구:', recovered.length)
        }
        this.mediaService = new MediaService(new MediaRepository(getDB()))
        this.downloadService = createDownloadRuntime(getDB(), {
            getStorageRoot: () => ConfigManager.getInstance().getDownloadPath(),

            engines: {
                getBinaries: () => {
                    const bin = BinManager.getInstance()

                    return {
                        ytDlp: bin.getBinaryPath('yt-dlp'),
                        ffmpeg: bin.getBinaryPath('ffmpeg'),
                        galleryDl: bin.getBinaryPath('gallery-dl')
                    }
                },
                getGalleryDlAuthentication: () => ({
                    cookieFilePath: ConfigManager.getInstance().getCookieFilePath()
                }),

                hostScript: app.isPackaged
                    ? join(process.resourcesPath, 'engine-host.ps1')
                    : join(app.getAppPath(), 'resources', 'engine-host.ps1'),

                nodeExecutable: process.execPath,
                workingDirectory: app.getPath('userData')
            }
        }).service

        electronApp.setAppUserModelId('com.storagebucket')

        setupMediaProtocol()

        app.on('browser-window-created', (_, window) => {
            optimizer.watchWindowShortcuts(window)
        })

        this.createWindow()
        this.registerIpcHandlers()

        try {
            this.stopThumbnailWorker = startDownloadThumbnailWorker(getDB(), (mediaId) => {
                const window = this.mainWindow

                if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
                    window.webContents.send('media:thumbnail-updated', mediaId)
                }
            })

            app.once('before-quit', () => {
                this.stopThumbnailWorker?.()
                this.stopThumbnailWorker = undefined
            })
        } catch (error) {
            console.error('[ThumbnailWorker] 초기화 실패:', error)
        }
    }

    public createWindow(): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore()
            this.mainWindow.focus()
            return
        }

        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: false,
            autoHideMenuBar: false,
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                sandbox: false
            }
        })
        this.mainWindow.setMenu(null)

        this.mainWindow.on('ready-to-show', () => {
            this.mainWindow?.show()
        })

        this.mainWindow.webContents.setWindowOpenHandler((details) => {
            shell.openExternal(details.url)
            return { action: 'deny' }
        })

        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
            this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        } else {
            this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
        }
    }

    private registerIpcHandlers(): void {
        const handlers = {
            ...shellHandler,
            ...systemHandler,
            ...createMediaHandlers(() => this.mediaService),
            ...createDownloadHandlers(() => this.downloadService),
            ...createThumbnailHandlers(() => new DownloadThumbnailRepository(getDB()))
        }

        console.log(`[Main] Found ${Object.keys(handlers).length} handlers to register.`)

        for (const [channel, listener] of Object.entries(handlers)) {
            if (ipcMain.eventNames().includes(channel)) {
                ipcMain.removeHandler(channel)
            }
            const typedListener = listener as IpcHandler
            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    return await typedListener(event, ...args)
                } catch (error) {
                    console.error(`[IPC Error] ${channel}:`, error)
                    throw error
                }
            })

            console.log(`[IPC] Registered: ${channel}`)
        }
    }
}
