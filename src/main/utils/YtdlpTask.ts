import { ChildProcess, spawn } from "child_process";
import path from 'path';
import fs from 'fs';
import { pipeline } from "stream/promises";
import { BinManager } from "../managers/BinManager";
import { 
    DownloadOptions,
    DownloadResult,
    DownloadResultItem,
    DownloadResultMetadata,
    TaskCallbacks,
    TaskHandle
 } from "../../shared/types";
import { buildYtdlpArgs } from "./ArgsUtils";
import { platform } from "os";
import { ConfigManager } from "../managers/ConfigManager";

async function downloadThumbnail(url: string, videoId: string, videoName: string, basePath: string): Promise<string | null> {
    if(!url) return null;

    try {
        if (!fs.existsSync(basePath)) fs.mkdirSync(basePath, { recursive: true });
        const urlObj = new URL(url);
        const extension = path.extname(urlObj.pathname) || '.jpg';
        const safeId = videoId.replace(/[\/\\:*?"<>|]/g, "");
        const safeName = videoName.replace(/[\/\\:*?"<>|]/g, "");
        const filepath = path.join(basePath, `${safeName}_${safeId}${extension}`);
        if(fs.existsSync(filepath)) return filepath;
        const response = await fetch(url);
        if(!response.ok || !response.body) return null;
        // @ts-ignore
        await pipeline(response.body, fs.createWriteStream(filepath));
        return filepath;
    } catch {
        return null;
    }
} 

export function downloadYtdlp(
    url: string,
    basePath: string,
    options: DownloadOptions,
    callbacks: TaskCallbacks
): TaskHandle {
    const binManager = BinManager.getInstance();
    const ytdlpPath = binManager.getBinaryPath('yt-dlp');
    let proc: ChildProcess | null = null;
    let aborted = false;

    const promise = new Promise<DownloadResult>((resolve, reject) => {
        const args = buildYtdlpArgs(url, basePath, options);
        console.log(`[YtdlpTask] command: ${ytdlpPath} ${args.join(' ')}`);

        proc = spawn(ytdlpPath, args);
        let stdoutBuffer = "";
        const allMetadata: any[] = [];

        proc.stdout?.on('data', (data: Buffer) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split('\n');
            stdoutBuffer = lines.pop() || "";

            lines.forEach((line) => {
                const trimmed = line.trim();
                if(!trimmed) return;

                // --print-json 출력 파싱
                if(trimmed.startsWith("{") && trimmed.endsWith("}")) {
                    try {
                        const parsed = JSON.parse(trimmed);
                        allMetadata.push(parsed);
                        callbacks.onProgress(-1, {
                            status: 'start',
                            title: parsed.title,
                            platform: parsed.extractor_key,
                            thumbnail: parsed.thumbnail,
                            itemCount: allMetadata.length,
                        });
                    } catch { }
                }
            });
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const lines = data.toString().split('\n');
            lines.forEach((line) => {
                const trimmed = line.trim();
                if(!trimmed) return;

                console.log(`[yt-dlp stderr] ${trimmed}`);

                const progressMatch = trimmed.match(/\[download\]\s+(\d+\.?\d*)%/);
                if(progressMatch) {
                    const progress = parseFloat(progressMatch[1]);
                    callbacks.onProgress(progress, { status: 'downloading' });
                }
            });
        });

        proc.on('close', async (code) => {
            if(aborted) {
                reject(new Error('Aborted'));
                return
            }

            // 버퍼 잔여분 처리
            if(stdoutBuffer.trim()) {
                const trimmed = stdoutBuffer.trim();
                if(trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                        allMetadata.push(JSON.parse(trimmed));
                    } catch { }
                }
            }

            if (code === 0 && allMetadata.length > 0) {
                const results: DownloadResultItem[] = [];

                for(const meta of allMetadata) {
                    let thumbnailPath: string | null = null;
                    if(meta.thumbnail) {
                        const siteName = meta.extractor_key || meta.extractor || 'unknown';
                        const thumbDir = path.join(ConfigManager.getInstance().getThumbnailPath(), siteName);
                        thumbnailPath = await downloadThumbnail(meta.thumbnail, meta.id, meta.title, thumbDir);
                    }
                    const metadata: DownloadResultMetadata = {
                        id: meta.id,
                        title: meta.title,
                        extractor_key: meta.extractor_key || meta.extractor,
                        filename: meta.filename || meta._filename || '',
                        duration: meta.duration,
                        uploader: meta.uploader,
                        webpage_url: meta.webpage_url,
                        thumbnail: meta.thumbnail,
                    };
                    results.push({
                        metadata,
                        videoPath: meta.filename || meta._filename || '',
                        thumbnailPath
                    });
                }

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
                reject(new Error(`yt-dlp exited with code ${code}`));
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