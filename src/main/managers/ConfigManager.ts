import { app } from 'electron';
import path from 'path';
import Store from 'electron-store';

interface AppConfig {
    basePath: string;
    downloadPath: string;
    thumbnailPath: string;
}

export class ConfigManager {
    private static instance: ConfigManager;
    private store: Store<AppConfig>;

    private constructor() {
        const isDev = !app.isPackaged;

        const defaultBasePath = process.env.PORTABLE_EXECUTABLE_DIR
            || path.dirname(app.getPath('exe'))
            || (isDev ? process.cwd() : '');
        
        this.store = new Store<AppConfig> ({
            defaults: {
                basePath: defaultBasePath,
                downloadPath: path.join(defaultBasePath, 'downloads'),
                thumbnailPath: path.join(defaultBasePath, 'thumbnails'),
            }
        });
    }
    public static getInstance(): ConfigManager {
        if(!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    public getBasePath(): string {
        return this.store.get('basePath');
    }

    public setBasePath(newPath: string): void {
        this.store.set('basePath', newPath);

        this.store.get('downloadPath', path.join(newPath, 'downloads'));
        this.store.get('thumbnailPath', path.join(newPath, 'thumbnails'));
    }

    public getDownloadPath(): string {
        return this.store.get('downloadPath');
    }

    public setDownloadPath(path: string): void {
        this.store.set('downloadPath', path);
        console.log(`[Config] Download path changed: ${path}`);
    }

    public getThumbnailPath(): string {
        return this.store.get('thumbnailPath');
    }

    public setThumbnailPath(): void {
        this.store.set('thumbnailPath', path);
        console.log(`[Config] Thumbnail path changed: ${path}`);
    }

    public getAll(): AppConfig {
        return this.store.store;
    }

    public getPath(): string {
        return this.store.path;
    }
}