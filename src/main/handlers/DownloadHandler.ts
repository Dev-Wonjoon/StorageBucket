import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { BinManager } from '../managers/BinManager';


async function downloadThumbnail(url: string, videoId: string, videoName: string, baseDir: string) {
    if(!url) return null;
    try {
        const thumbDir = path.join(baseDir, 'thumbnails');
        if(!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

        const urlObj = new URL(url);
        let extension = path.extname(urlObj.pathname) || '.jpg';

        const safeId = videoId.replace(/[\/\\:*?"<>|]g/, "");
        const filename = `${videoName}_${safeId}${extension}`;
        const filepath = path.join(thumbDir, filename);

        if(fs.existsSync(filepath)) return filepath;

        const response = await fetch(url);
        if(!response.ok || !response.body) return null;

        // @ts-ignore pipeline types mismatch workaround
        await pipeline(response.body, fs.createWriteStream(filepath));
        return filepath;
    } catch(error) {
        console.error('Thumbnail download failed:', error);
        return null;
    }
}

export const downloadVideoTask = (url: string, basePath: string): Promise<any> => {
    const binManager = BinManager.getInstance();
    const ytdlpPath = binManager.getBinaryPath('yt-dlp');
    const ffmpegPath = binManager.getBinaryPath('ffmpeg');
    return new Promise((resolve, reject) => {
        if(!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

        const args = [
            url,
            '-o', path.join(basePath, '%(extractor)s', '%(title)s_%(id)s.$(ext)s'),
            '--no-check-certificates',
            '--no-warnings',
            '--format', 'bestvideo+bestaudio/best',
            '--merge-output-format', 'mp4',
            '--print-json',
            '--no-write-thumbnail'
        ];

        if(fs.existsSync(ffmpegPath)) {
            args.push('--ffmpeg-location', ffmpegPath);
        } else {
            console.warn('[DownloadHandler] FFMPEG not found. Format merging might fall.');
        }

        console.log(`[DownloadHandler] Spawning: ${ytdlpPath} ${args.join(' ')}`);

        const ytdlpProcess = spawn(ytdlpPath, args);
        let jsonOutput = '';

        ytdlpProcess.stdout.on('data', (data) => {
            jsonOutput += data.toString();
        });

        ytdlpProcess.stderr.on('data', (data) => {
            jsonOutput += data.toString();
            console.log(`[yt-dlp stderr] ${data}`);
        })

        ytdlpProcess.on('error', (error) => {
            console.error('[DownloadHandler] Process spawn error: ', error);
            reject(new Error(`Failed to start yt-dlp: ${error.message}`));
        })

        ytdlpProcess.on('close', async (code) => {
            if(code === 0) {
                try{
                    const metadata = JSON.parse(jsonOutput.trim());
                    const videoId = metadata.id || 'Unknown';
                    const videoTitle = metadata.title || 'Untitled';

                    const videoPath = metadata._filename;

                    const thumbnailPath = await downloadThumbnail(metadata.thumbnail, videoId, videoTitle, basePath);

                    resolve({
                        metadata,
                        videoPath,
                        thumbnailPath
                    });
                } catch(error) {
                    console.error('JSON parse Error:', error);
                    console.error('Raw Output:', jsonOutput);
                    reject(new Error("Failed to parse download metadata"));
                }
            } else {
                reject(new Error(`Download failed with exit code: ${code}`));
            }
        });
    });
}