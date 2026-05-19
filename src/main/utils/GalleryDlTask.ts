import { ChildProcess, spawn, spawnSync } from "child_process";
import path from 'path';
import fs from 'fs';
import { BinManager } from "../managers/BinManager";
import { ConfigManager } from "../managers/ConfigManager";
import {
    DownloadResult,
    DownloadResultItem,
    DownloadResultMetadata,
    TaskCallbacks,
    TaskHandle
} from '../../shared/types';
import { extractSiteKey, cleanUrl } from "./ArgsUtils";

const readMetadata = (file: string): any => {
    const parsed = path.parse(file);
    const candidates = [
        `${file}.json`,
        path.join(parsed.dir, `${parsed.name}.json`)
    ];

    for(const candidate of candidates) {
        if(fs.existsSync(candidate)) {
            try {
                return JSON.parse(fs.readFileSync(candidate, 'utf8'));
            } catch {
                return {};
            }
        }
    }

    return {};
}

const createVideoThumbnail = (file: string): string | null => {
    if(!file.match(/\.(mp4|webm|mov|mkv)$/i)) return null;

    const ffmpegPath = BinManager.getInstance().getBinaryPath('ffmpeg');
    const thumbDir = path.join(ConfigManager.getInstance().getThumbnailPath(), 'instagram');

    if(!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

    const output = path.join(thumbDir, `${path.basename(file, path.extname(file))}.jpg`);

    const result = spawnSync(ffmpegPath, [
        '-y',
        '-ss', '00:00:01',
        '-i', file,
        '-frames:v', '1',
        '-q:v', '2',
        output
    ]);

    return result.status === 0 && fs.existsSync(output) ? output : null;
}

export function downloadGalleryDl(
    url: string,
    basePath: string,
    callbacks: TaskCallbacks
): TaskHandle {
    const binManager = BinManager.getInstance();
    const galleryDlPath = binManager.getBinaryPath('gallery-dl');
    let proc: ChildProcess | null = null;
    let aborted = false;

    const promise = new Promise<DownloadResult>((resolve, reject) => {
        const args = [
            cleanUrl(url),
            '-d', basePath,
            '-o', 'directory=["{category}", "{owner_id}"]',
            '-o', 'filename="{media_id}_{filename}.{extension}"',
        ];

        const cookieFile = ConfigManager.getInstance().getCookieFilePath();
        const cookieBrowser = ConfigManager.getInstance().getCookieBrowser();

        if(cookieFile) {
            args.push('--cookies', cookieFile);
        } else if (cookieBrowser) {
            args.push('--cookie-from-browser', cookieBrowser);
        }

        console.log(`[GalleryDlTask] command: ${galleryDlPath} ${args.join(' ')}`);

        proc = spawn(galleryDlPath, args);
        const downloadedFiles: string[] = [];
        let stdoutBuffer = '';
        let stderrBuffer = '';

        proc.stdout?.on('data', (data: Buffer) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || '';

            lines.forEach((line) => {
                const trimmed = line.trim();
                if(!trimmed || trimmed.startsWith('#')) return;

                console.log(`[gallery-dl stdout] ${trimmed.substring(0, 300)}`);

                if(fs.existsSync(trimmed) || trimmed.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|heic)$/i)) {
                    downloadedFiles.push(trimmed);
                    callbacks.onProgress(50, {
                        status: 'downloading',
                        itemCount: downloadedFiles.length,
                    });
                }
            });
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const text = data.toString();
            stderrBuffer += text;
            console.log(`[gallery-dl stderr] ${text}`);
        });

        proc.on('close', (code) => {
            if(aborted) {
                reject(new Error('Aborted'));
                return;
            }

            if(code === 0 && downloadedFiles.length > 0) {
                const results: DownloadResultItem[] = downloadedFiles.map(file => {
					const info = readMetadata(file);
					const isImage = !!file.match(/\.(jpg|jpeg|png|webp|gif|heic)$/i);

					const uploaderId = 
						info.uploader_id ||
						info.username ||
						info.owner?.username ||
						info.user?.username ||
						info.author?.username;
					
					const uploaderName =
						uploaderId ||
						info.uploader ||
						info.owner?.full_name ||
						info.user?.full_name ||
						'unknown';
					
					const title =
						info.title ||
						info.description ||
						info.caption ||
						path.basename(file, path.extname(file));

					const metadata: DownloadResultMetadata = {
						id: String(info.id || info.shortcode || path.basename(file)),
						title,
						extractor_key: extractSiteKey(url),
						filename: file,
						filesize: fs.statSync(file).size,
						uploader: uploaderName,
						uploader_id: uploaderId,
						webpage_url: url,
						thumbnail: info.thumbnail || info.display_url,
					};

					return {
						metadata,
						videoPath: file,
						thumbnailPath: isImage ? file : createVideoThumbnail(file)
					};
				});

                callbacks.onProgress(100, { status: 'completed', itemCount: results.length });

                if(results.length === 1) {
                    resolve({
                        success: true,
                        multiple: false,
                        metadata: results[0].metadata,
                        videoPath: results[0].videoPath,
                        thumbnailPath: results[0].thumbnailPath
                    });
                } else {
                    resolve({
                        success: true,
                        multiple: true,
                        items: results,
                        metadata: results[0].metadata,
                        videoPath: results[0].videoPath,
                        thumbnailPath: results[0].thumbnailPath,
                    });
                }
            } else {
                callbacks.onProgress(0, { status: 'failed' });
                reject(new Error(`gallery-dl exited with code ${code}\n${stderrBuffer}`));
            }
        });
    });

    return {
        promise,
        abort: () => {
            aborted = true;
            proc?.kill();
        }
    };
}