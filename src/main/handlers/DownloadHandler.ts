import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import { IpcMainInvokeEvent, WebContents } from 'electron';
import { DownloadOptions } from '../../shared/types';
import { BinManager } from '../managers/BinManager';
import { buildYtdlpArgs } from '../utils/YtdlpArgs';
import { spawn } from 'child_process';
import { DownloadManager } from '../managers/DownloadManager';

export const downloadHandler = {
    'video:download': async (_: IpcMainInvokeEvent, url: string, options: any) => {
        console.log(`[IPC] Download Request: ${url}`);
        await DownloadManager.getInstance().addJob(url, options || {});
        return { success: true, message: "Download added to queue" };
    }
};


async function downloadThumbnail(url: string, videoId: string, videoName: string, thumbnailDir: string) {
    if(!url) return null;

    try {
        const thumbDir = path.join(thumbnailDir);
        if(!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

        const urlObj = new URL(url);
        const extension = path.extname(urlObj.pathname) || '.jpg';

        const safeId = videoId.replace(/[\/\\:*?"<>\|]/g, "");
        const safeName = videoName.replace(/[\/\\:*?"<>\|]/g, "");
        const filename = `${safeName}_${safeId}${extension}`;
        const filepath = path.join(thumbDir, filename);

        if(fs.existsSync(filepath)) return filepath;

        const response = await fetch(url);
        if(!response.ok || !response.body) return null;

        // @ts-ignore
        await pipeline(response.body, fs.createWriteStream(filepath));
        return filepath;
    } catch(error) {
        console.error('Thumbnail download failed:', error);
        return null;
    }
}

export const downloadVideoTask = (
    sender: WebContents,
    url: string,
    basePath: string,
    options: DownloadOptions = {}
): Promise<any> => {
    const binManager = BinManager.getInstance();
    const ytdlpPath = binManager.getBinaryPath('yt-dlp');
    const ffmpegPath = binManager.getBinaryPath('ffmpeg');

    return new Promise((resolve, reject) => {
        if(!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

        const args = buildYtdlpArgs(url, basePath, options);

        if(fs.existsSync(ffmpegPath)) {
            args.push('--ffmpeg-location', ffmpegPath);
        }

        console.log(`[DownloadHandler] command: ${ytdlpPath} ${args.join(' ')}`);

        const ytdlpProcess = spawn(ytdlpPath, args);
        let currentMetaData: any = null;

        let stdoutBuffer = '';

        ytdlpProcess.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.toString().split('\n');
            
            stdoutBuffer = lines.pop() || '';

            lines.forEach((line) => {
                const trimmed = line.trim();
                if(!trimmed) return;

                if(trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        currentMetaData = parsed;

                        sender.send('download:progress', {
                            status: 'start',
                            title: parsed.title,
                            platform: parsed.extractor_key || parsed.extractor,
                            thumbnail: parsed.thumbnail
                        });
                    } catch(error) { /* ignore */ }
                }
            });
        });

        ytdlpProcess.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach((line) => {
                const trimmed = line.trim();
                if(!trimmed) return;

                const progressMatch = trimmed.match(/\[download\]\s+(\d+\.\d+)%/);
                if(progressMatch) {
                    sender.send('download:progress', {
                        status: 'downloading',
                        progress: parseFloat(progressMatch[1])
                    });
                }
            });
        });

        ytdlpProcess.on('close', async (code) => {
            if (stdoutBuffer.trim()) {
                const trimmed = stdoutBuffer.trim();
                if(trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        currentMetaData = JSON.parse(trimmed);
                    } catch(e) {}
                }
            }

            if(code === 0) {
                let thumbnailPath: string | null = null;

                if(currentMetaData) {
                    thumbnailPath = await downloadThumbnail(
                        currentMetaData.thumbnail,
                        currentMetaData.id,
                        currentMetaData.title,
                        basePath
                    );
                }

                const videoPath = currentMetaData?.filename || currentMetaData?._filename;

                sender.send('download:progress', { status: 'completed', progress: 100 });

                resolve({
                    success: true,
                    metadata: currentMetaData,
                    videoPath,
                    thumbnailPath
                });
            } else {
                sender.send('download:progress', { status: 'failed' });
                reject(new Error(`Exit code: ${code}`));
            }
        });
    });
};
