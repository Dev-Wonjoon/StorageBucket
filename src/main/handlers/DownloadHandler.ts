import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { app } from 'electron';

const isDev = !app.isPackaged;

const getBinPath = () => {
    const paths = isDev
        ? path.join(__dirname, '../../resources/bin')
        : path.join(process.resourcesPath, 'bin');

    console.log(`[DownloadHandler] Bin path detected: ${paths}`);
    return paths
}
const BIN_PATH = getBinPath();
const YTDLP_PATH = path.join(BIN_PATH, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG_PATH = path.join(BIN_PATH, 'ffmpeg.exe');

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
    return new Promise((resolve, reject) => {
        if(!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });

        const args = [
            url,
            '-o', path.join(basePath, '%(extractor)s', '%(title)s_%(id)s.$(ext)s'),
            '--no-check-certificates',
            'no-warnings',
            '--format', 'bestvideo+bestaudio/best',
            '--merge-output-format', 'mp4',
            '--print-json',
            '--no-write-thumbnail'
        ];

        if(fs.existsSync(FFMPEG_PATH)) {
            args.push('--ffmpeg-location', FFMPEG_PATH);
        } else {
            console.warn('[DownloadHandler] FFMPEG not found. Format merging might fall.');
        }

        console.log(`[DownloadHandler] Spawning: ${YTDLP_PATH} ${args.join(' ')}`);

        const ytdlpProcess = spawn(YTDLP_PATH, args);
        let jsonOutput = '';
        let errorOutput = '';

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