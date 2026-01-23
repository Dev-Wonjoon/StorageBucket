import { ipcMain, app, dialog } from "electron";
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { ConfigManager } from '../../ConfigManager';

const config = ConfigManager.getInstance();

const isDev = !app.isPackaged;

const BIN_PATH = isDev
    ? path.join(__dirname, '../../resources/bin')
    : path.join(process.resourcesPath, 'bin');

const YTDLP_PATH = path.join(BIN_PATH, 'yt-dlp.exe');
const FFMPEG_PATH = path.join(BIN_PATH, 'ffmpeg.exe');

export const setupDownloadHandlers = () => {
    ipcMain.handle('download-video', async (_, url: string) => {
        return new Promise((resolve) => {
            try {
                const basePath = config.getDownloadPath();

                console.log(`[Download] Base path: ${basePath}`);

                if(!fs.existsSync(basePath)) {
                    fs.mkdirSync(basePath, { recursive: true });
                }

                const args = [
                    url,
                    '-o', path.join(basePath, '%(extractor)s', '%(title)s.%(ext)s'),
                    '--no-check-certificates',
                    '--no-warnings',
                    '--format', 'bestvideo+bestaudio/best',
                    '--merge-output-format', 'mp4'
                ];

                if(fs.existsSync(FFMPEG_PATH)) {
                    args.push('--ffepeg-location', FFMPEG_PATH);
                }

                const ytdlpProcess = spawn(YTDLP_PATH, args);

                ytdlpProcess.stdout.on('data', (data) => console.log(`[yt-dlp]: ${data}`));
                ytdlpProcess.stderr.on('data', (data) => console.error(`[yt-dlp error]: ${data}`));

                ytdlpProcess.on('close', (code) => {
                    if(code === 0) {
                        console.log('[Download] Completed successfully');
                        resolve({ success: true, message: 'download complete', path: basePath });
                    } else {
                        console.error(`[Download] Failed with exit code: ${code}`);
                    }
                });
            } catch(error) {
                console.error('[Download] Error:', error);
                resolve({ success: false, message: 'An error occurred while processing the URL' });
            }
        });
    });

    ipcMain.handle('set-download-path', async () => {
        const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
        if(!result.canceled && result.filePaths.length > 0) {
            const newPath = result.filePaths[0];
            config.setDownloadPath(newPath);
            return newPath;
        }
        return null;
    });
    ipcMain.handle('get-download-path', () => config.getDownloadPath());
};