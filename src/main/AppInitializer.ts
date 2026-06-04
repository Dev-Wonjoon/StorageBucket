import fs from 'fs';
import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent } from 'electron';
import { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';

import { setupMediaProtocol } from './utils/protocol';
import { getPortableDataPath } from './utils/portablePath';

type MaybePromise<T> = T | Promise<T>;
type IpcHandler = (event: IpcMainInvokeEvent, ...args: any[]) => MaybePromise<any>;

const lazyHandlers: Record<string, () => Promise<IpcHandler>> = {
    'get-download-path': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['get-download-path']),
    'set-download-path': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['set-download-path']),
    'system:engine-install': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:engine-install']),
    'system:engine-licenses': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:engine-licenses']),
    'system:engine-status': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:engine-status']),
    'system:get-cookie-browser': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:get-cookie-browser']),
    'system:set-cookie-browser': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:set-cookie-browser']),
    'system:get-cookie-file': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:get-cookie-file']),
    'system:set-cookie-file': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:set-cookie-file']),
    'system:clear-cookie-file': () => import('./handlers/SystemHandler').then((m) => m.systemHandler['system:clear-cookie-file']),

    'video:download': () => import('./handlers/DownloadHandler').then((m) => m.downloadHandler['video:download']),
    'media:get-all': () => import('./handlers/MediaHandler').then((m) => m.mediaHandler['media:get-all']),
    'media:delete': () => import('./handlers/MediaHandler').then((m) => m.mediaHandler['media:delete']),
    'shell:show-item': () => import('./handlers/MediaHandler').then((m) => m.mediaHandler['shell:show-item']),

    'favorite:get-all': () => import('./handlers/FavoriteHandler').then((m) => m.favoriteHandler['favorite:get-all']),
    'favorite:toggle': () => import('./handlers/FavoriteHandler').then((m) => m.favoriteHandler['favorite:toggle']),
    'favorite:check': () => import('./handlers/FavoriteHandler').then((m) => m.favoriteHandler['favorite:check']),

    'tag:get-all': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:get-all']),
    'tag:get-by-media': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:get-by-media']),
    'tag:create': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:create']),
    'tag:rename': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:rename']),
    'tag:delete': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:delete']),
    'tag:add-to-media': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:add-to-media']),
    'tag:remove-from-media': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:remove-from-media']),
    'tag:bulk-add': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:bulk-add']),
    'tag:bulk-remove': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:bulk-remove']),
    'tag:bulk-replace': () => import('./handlers/TagHandler').then((m) => m.tagHandler['tag:bulk-replace']),

    'search:media': () => import('./handlers/SearchHandler').then((m) => m.searchHandler['search:media']),
    'search:suggest-authors': () => import('./handlers/SearchHandler').then((m) => m.searchHandler['search:suggest-authors']),
    'search:suggest-platforms': () => import('./handlers/SearchHandler').then((m) => m.searchHandler['search:suggest-platforms']),
    'search:suggest-tags': () => import('./handlers/SearchHandler').then((m) => m.searchHandler['search:suggest-tags']),
    'search:rebuild-index': () => import('./handlers/SearchHandler').then((m) => m.searchHandler['search:rebuild-index'])
}

const APP_USER_MODEL_ID = 'com.storagebucket.app';

export class AppInitializer {
    private mainWindow: BrowserWindow | null = null;
    private databaseReady: Promise<void> | null = null;

    public async initialize(): Promise<void> {
        this.setupDataPaths();

        electronApp.setAppUserModelId(APP_USER_MODEL_ID);

        setupMediaProtocol();

        app.on('browser-window-created', (_, window) => {
            optimizer.watchWindowShortcuts(window);
        })

        this.createWindow();
        this.registerIpcHandlers();
    }

    public createWindow(): void {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.focus();
            return;
        }

        this.mainWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            show: false,
            autoHideMenuBar: true,
            icon: this.resolveWindowIconPath(),
            webPreferences: {
                preload: join(__dirname, '../preload/index.js'),
                sandbox: false,
            }
        });

        this.mainWindow.on('ready-to-show', () => {
            this.mainWindow?.show();
        });

        this.mainWindow.webContents.setWindowOpenHandler((details) => {
            shell.openExternal(details.url);
            return { action: 'deny' }
        });

        this.mainWindow.webContents.once('did-finish-load', () => {
            void this.prepareDatabaseAfterWindowLoad();
        });

        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
            this.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
        } else {
            this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
        }
    }

    private async prepareDatabaseAfterWindowLoad(): Promise<void> {
        if(!this.mainWindow || this.mainWindow.isDestroyed()) {
            return;
        }
        
        try {
            await this.ensureDatabaseReady();
            this.mainWindow.webContents.send('app:bootstrap-ready');
        } catch (error) {
            console.error('[Database Initialization Error]', error);
            this.mainWindow.webContents.send('app:bootstrap-error', {
                message: 'Failed to initialize database. Please check the logs for details.'
            });
        }
    }

    private async ensureDatabaseReadyForChannel(channel: string): Promise<void> {
        if(!this.isDatabaseChannel(channel)) return;
        

        await this.ensureDatabaseReady();
    }

    private async ensureDatabaseReady(): Promise<void> {
        if(!this.databaseReady) {
            this.databaseReady = this.initializeDatabase();
        }

        await this.databaseReady;
    }

    private isDatabaseChannel(channel: string): boolean {
        return (
            channel === 'video:download' ||
            channel.startsWith('media:') ||
            channel.startsWith('favorite:') ||
            channel.startsWith('tag:') ||
            channel.startsWith('search:')
        )
    }

    private async initializeDatabase(): Promise<void> {
        const database = await import('../database/index');

        database.initDB();
        database.createFtsTable();

        const { DownloadManager } = await import('./managers/DownloadManager');

        if(this.mainWindow && !this.mainWindow.isDestroyed()) {
            DownloadManager.getInstance().setWindow(this.mainWindow);
        }

        this.scheduleFtsMaintenance(database);

    }

    private resolveWindowIconPath(): string | undefined {
        const candidates = [
            join(process.cwd(), 'build', 'icon.ico'),
            join(process.resourcesPath, 'icon.ico'),
        ];

        return candidates.find((candidate) => fs.existsSync(candidate));
    }

    private setupDataPaths(): void {
        // const basePath = app.getAppPath();
        const portableDataPath = getPortableDataPath();

        app.setPath('userData', portableDataPath);
        app.setPath('sessionData', join(portableDataPath, 'session'));
        app.setPath('crashDumps', join(portableDataPath, 'crash_dumps'));
        app.setPath('logs', join(portableDataPath, 'logs'));

        console.log(`[AppInitializer] User data path set to: ${portableDataPath}`);
    }

    private registerIpcHandlers(): void {

        for (const [channel, loadHandler] of Object.entries(lazyHandlers)) {
            if (ipcMain.eventNames().includes(channel)) {
                ipcMain.removeHandler(channel);
            }

            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    await this.ensureDatabaseReadyForChannel(channel);

                    const handler = await loadHandler();
                    return await handler(event, ...args)
                } catch (error) {
                    console.error(`[IPC Error] ${channel}:`, error);
                    throw error;
                }
            })
            console.log(`[IPC] Registered: ${channel}`);
        }

    }

    private scheduleFtsMaintenance(database: typeof import('../database/index')): void {
        setTimeout(() => {
            try{
                if(database.getFtsCount() === 0 && database.getMediaCount() > 0) {
                    console.log('[FTS] Rebuilding index in background....');
                    database.rebuildFtsIndex();
                }
            } catch(error) {
                console.error('[FTS] Background rebuild failed: ', error);
            }
        }, 1000);
    }

}


