import { WebContents } from "electron";
import { spawn } from "child_process";
import path from 'path';
import fs from 'fs';
import { BinManager } from "../managers/BinManager";

export const downloadGalleryDl = (
    sender: WebContents,
    url: string,
    basePath: string,
): Promise<any> => {
    const binManager = BinManager.getInstance();
    const galleryDlPath = binManager.getBinaryPath('gallery-dl');

    return new Promise((resolve, reject) => {
        const args = [
            url,
            '-d', basePath,
            '--write-metadata',
            '--print', '{_meta}',
        ];

        console.log(`[GalleryDlTask] command: ${galleryDlPath} ${args.join(' ')}`);

        const proc = spawn(galleryDlPath, args);
        const downloadedFiles: string[] = [];
        let stdoutBuffer = '';
        let stderrOutput = '';

        proc.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stderrOutput.split('\n');
            stdoutBuffer = lines.pop() || '';

            lines.forEach((line) => {
                const trimmed = line.trim();
                if(!trimmed) return;

                console.log(`[gallery-dl stdout] ${trimmed.substring(0, 300)}`);

                if(fs.existsSync(trimmed) || trimmed.match(/\.(jpg|jpeg|png|gif|webp|mp4|webm|mov|heic)$/i)) {
                    downloadedFiles.push(trimmed);

                    sender.send('download:progress', {
                        status: 'downloading',
                        progress: 50,
                        itemCount: downloadedFiles.length,
                    });
                }
            })
        })
    })
}