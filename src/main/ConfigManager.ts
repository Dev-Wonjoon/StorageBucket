import { app } from 'electron';
import path from 'path';
import Store from 'electron-store';

interface AppConfig {
    downloadPath: string;
    theme?: 'light' | 'dark';
}

export class ConfigManager {
    private static instance: ConfigManager;
    private store: Store<AppConfig>;

    private constructor() {
        this.store = new Store<AppConfig> ({
            defaults: {
                downloadPath: path.join(app.getPath('downloads')),
                theme: 'light'
            }
        })
    }
    public static getInstance(): ConfigManager {
        if(!ConfigManager.instance) {
            ConfigManager.instance = new ConfigManager();
        }
        return ConfigManager.instance;
    }

    public getDownloadPath(): string {
        return this.store.get('downloads');
    }

    public setDownloadPath(path: string): void {
        this.store.set('downloadPath', path);
        console.log(`[Config] Download path changed: ${path}`);
    }

    public getAll(): AppConfig {
        return this.store.store;
    }

    public getPath(): string {
        return this.store.path;
    }
}