import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { pipeline } from 'stream/promises';
import { app } from 'electron';

const isDev = !app.isPackaged;
const BIN_PATH = isDev
    ? path.join(__dirname, '../../resources/bin')
    : path.join(process.resourcesPath, 'bin');

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
        }

        const ytdlpProcess = spawn(YTDLP_PATH, args);
        let jsonOutput = '';

        ytdlpProcess.stdout.on('data', (data) => {
            jsonOutput += data.toString();
        });

        ytdlpProcess.on('close', async (code) => {
            if(code === 0) {
                try{
                    const metadata = JSON.parse(jsonOutput);
                    const videoId = metadata.id || 'Unknown';
                    const videoTitle = metadata.title || 'Untitled';

                    const videoPath = metadata._filename || path.join(
                        basePath,
                        metadata.extractor,
                        `${metadata.title}_${metadata.id}.mp4`
                    )

                    const thumbnailPath = await downloadThumbnail(metadata.thumbnail, videoId, videoTitle, basePath);

                    resolve({
                        metadata,
                        videoPath,
                        thumbnailPath
                    });
                } catch(error) {
                    console.error('JSON parse Error:', error);
                    reject(new Error("Failed to parse download metadata"));
                }
            } else {
                reject(new Error(`Download failed with exit code: ${code}`));
            }
        })
    })
}