import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { ConfigManager } from './ConfigManager';
import { pipeline } from 'stream/promises';

const config = ConfigManager.getInstance();
const isDev = !app.isPackaged;

export class BinManager {
    private static instance: BinManager;

    private bundledBinPath: string;

    private constructor() {
        this.bundledBinPath = isDev
            ? path.join(__dirname, '../../resources/bin')
            : path.join(process.resourcesPath, 'bin');
    }
    public static getInstance(): BinManager {
        if(!BinManager.instance) {
            BinManager.instance = new BinManager();
        }
        return BinManager.instance;
    }

    public getBinaryPath(name: 'ffmpeg' | 'yt-dlp'): string {
        const ext = process.platform === 'win32' ? '.exe' : '';
        const filename = `${name}${ext}`

        if (name === 'ffmpeg') {
            return path.join(this.bundledBinPath, filename);
        }

        const customPath = path.join(config.getBasePath(), 'bin', filename);
        if (fs.existsSync(customPath)) {
            return customPath;
        }

        return path.join(this.bundledBinPath, filename);
    }

    public checkYtdlpExists(): boolean {
        const finalPath = this.getBinaryPath('yt-dlp');
        return fs.existsSync(finalPath);
    }

    public async getYtdlpVersions(): Promise<string[]> {
        try {
            const response = await fetch('https://api.github.com/repos/yt-dlp/yt-dlp/releases', {
                headers: {
                    'User-Agent': 'StorageBucket-App'
                }
            });

            if(!response.ok) throw new Error(`Github API Fail: ${response.status}`);

            const releases = await response.json();

            if(!Array.isArray(releases)) return [];

            return releases.map((r: any) => r.tag_name);
        } catch(error) {
            console.error('[BinManager] Failed to fetch versions:', error);
            return [];
        }
    }

    public async downloadYtdlp(versionsTag: string = 'latest'): Promise<boolean> {
        try{
            const isWin = process.platform === 'win32';
            const filename = isWin ? 'yt-dlp.exe' : 'yt-dlp';
            const destDir = path.join(config.getBasePath(), 'bin')
            const destPath = path.join(destDir, filename);

            if(!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            let downloadUrl = ''
            const baseUrl = 'https://github.com/yt-dlp/yt-dlp/releases';

            if (versionsTag === 'latest') {
                const remoteFileName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
                downloadUrl = `${baseUrl}/download/${versionsTag}/${remoteFileName}`;
            } else {
                const remoteFileName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
                downloadUrl = `${baseUrl}/download/${versionsTag}/${remoteFileName}`
            }

            console.log(`[BinManager] Downloading yt-dlp (${versionsTag}) to : ${destPath}`);

            const response = await fetch(downloadUrl);
            
            if(!response.ok) throw new Error(`Download failed: ${response.statusText}`);

            if(!response.body) throw new Error('Response body is empty');

            const fileStream = fs.createWriteStream(destPath);
            await pipeline(response.body, fileStream);
            
            console.log(`[BinManager] Update complete.`);
            return true
        } catch(error) {
            console.error(`[BinManager] Update failed:`, error);

            const destPath = this.getBinaryPath('yt-dlp');
            try {
                if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
            } catch{}
            return false;
        }
    }

}