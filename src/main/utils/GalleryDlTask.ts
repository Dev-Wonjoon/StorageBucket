import { ChildProcess, spawn } from "child_process";
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
                const mainFile = downloadedFiles[0];
                const title = path.basename(mainFile, path.extname(mainFile));

                const results: DownloadResultItem[] = downloadedFiles.map(file => {
                    const isImage = !!file.match(/\.(jpg|jpeg|png|webp|gif|heic)$/i);
                    const metadata: DownloadResultMetadata = {
                        id: path.basename(file),
                        title: title,
                        extractor_key: extractSiteKey(url),
                        filename: file,
                        webpage_url: url,
                    };
                    return {
                        metadata,
                        videoPath: file,
                        thumbnailPath: isImage ? file : null
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