import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { ConfigManager } from './ConfigManager';
import { pipeline } from 'stream/promises';
import { LicenseInfo } from '../../shared/types';

const config = ConfigManager.getInstance();
const isDev = !app.isPackaged;

type EngineName = 'yt-dlp' | 'gallery-dl' | 'ffmpeg';

interface EngineInfo {
    name: EngineName;
    repo: string;
    getAssetName: (platform: string) => string;
    license: LicenseInfo;
    bundled: boolean;
}

const ENGINE_REGISTRY: Record<EngineName, EngineInfo> = {
    'yt-dlp': {
        name: 'yt-dlp',
        repo: 'yt-dlp/yt-dlp',
        getAssetName: (platform) => platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp',
        license: {
            name: 'Unlicense',
            url: 'https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE',
            notice: 'yt-dlp is released into the public domain under the Unlicense.',
        },
        bundled: false,
    },

    'gallery-dl': {
        name: 'gallery-dl',
        repo: 'mikf/gallery-dl',
        getAssetName: (platform) => platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl.bin',
        license: {
            name: 'GPL-2.0',
            url: 'https://github.com/mikf/gallery-dl/blob/master/LICENSE',
            notice: 'gallery-dl is licensed under the GNU General Public License',
        },
        bundled: false,
    },

    'ffmpeg': {
        name: 'ffmpeg',
        repo: 'BtbN/FFmpeg-Builds',
        getAssetName: (platform) => {
            if(platform === 'win32') return 'ffmpeg-master-latest-win64-gpl.zip';
            if(platform === 'darwin') return 'ffmpeg-master-latest-darwin-gpl.zip';
            return 'ffmpeg-master-latest-linux64-gpl.tar.xz';
        },
        license: {
            name: 'GPL-2.0 / LGPL-2.1',
            url: 'https://github.com/BtbN/FFmpeg-Builds/blob/master/LICENSE',
            notice: 'FFmpeg is license under the GNU General Public License v2.0 and the GNU Lesser General Public License v2.1. Source code is available at https://ffmpeg.org.',
        },
        bundled: false,
    },
};

export class BinManager {
    private static instance: BinManager;

    private bundledBinPath: string;

    private constructor() {
        this.bundledBinPath = isDev
            ? path.join(app.getAppPath(), 'resources', 'bin')
            : path.join(process.resourcesPath, 'bin');
    }

    public static getInstance(): BinManager {
        if (!BinManager.instance) {
            BinManager.instance = new BinManager();
        }
        return BinManager.instance;
    }

    // ── 경로 조회 ──

    public getBinaryPath(name: EngineName): string {
        const ext = process.platform === 'win32' ? '.exe' : '';
        const filename = `${name}${ext}`;

        // 사용자 다운로드 경로 우선
        const customPath = path.join(config.getBasePath(), 'bin', filename);
        if (fs.existsSync(customPath)) {
            return customPath;
        }

        // 번들 경로 폴백
        return path.join(this.bundledBinPath, filename);
    }

    // ── 존재 여부 ──

    public checkExists(name: EngineName): boolean {
        return fs.existsSync(this.getBinaryPath(name));
    }

    // ── 설치된 버전 조회 ──

    public async getInstalledVersion(name: EngineName): Promise<string | null> {
        if (!this.checkExists(name)) return null;

        const binPath = this.getBinaryPath(name);
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        try {
            const { stdout } = await execFileAsync(binPath, ['--version']);
            const firstLine = stdout.trim().split('\n')[0];
            return firstLine || null;
        } catch {
            return null;
        }
    }

    // ── GitHub 릴리즈 버전 목록 ──

    public async getVersions(name: EngineName): Promise<string[]> {
        const engine = ENGINE_REGISTRY[name];
        try {
            const response = await fetch(
                `https://api.github.com/repos/${engine.repo}/releases`,
                { headers: { 'User-Agent': 'StorageBucket-App' } }
            );

            if (!response.ok) throw new Error(`GitHub API Fail: ${response.status}`);

            const releases = await response.json();
            if (!Array.isArray(releases)) return [];

            return releases.map((r: any) => r.tag_name);
        } catch (error) {
            console.error(`[BinManager] Failed to fetch ${name} versions:`, error);
            return [];
        }
    }

    // ── 엔진 다운로드 & 설치 ──

    public async downloadEngine(name: EngineName, versionTag: string = 'latest'): Promise<boolean> {
        const engine = ENGINE_REGISTRY[name];
        const assetName = engine.getAssetName(process.platform);
        const destDir = path.join(this.bundledBinPath);
        const isArchive = assetName.endsWith('.zip') || assetName.endsWith('.tar.xz');

        try {
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }

            if(versionTag === 'latest') {
                const apiUrl = `https://api.github.com/repos/${engine.repo}/releases/latest`;
                const apiResponse = await fetch(apiUrl, {
                    headers: {'User-Agent': 'StorageBucket-App'}
                });
                if(!apiResponse.ok) throw new Error(`Failed to fetch latest release: ${apiResponse.statusText}`);
                const releaseData = await apiResponse.json();
                versionTag = releaseData.tag_name;
            }

            const downloadUrl = `https://github.com/${engine.repo}/releases/download/${versionTag}/${assetName}`;
            console.log(`[BinManager] Downloading ${name} (${versionTag}): ${downloadUrl}`);

            const response = await fetch(downloadUrl);
            if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
            if (!response.body) throw new Error('Response body is empty');

            if (isArchive) {
                // 압축 파일 → 임시 저장 후 해제
                const tmpPath = path.join(destDir, assetName);
                const fileStream = fs.createWriteStream(tmpPath);
                await pipeline(response.body, fileStream);

                await this.extractBinary(tmpPath, destDir, name);
                fs.unlinkSync(tmpPath);
            } else {
                // 단일 실행 파일 → 바로 저장
                const ext = process.platform === 'win32' ? '.exe' : '';
                const destPath = path.join(destDir, `${name}${ext}`);
                const fileStream = fs.createWriteStream(destPath);
                await pipeline(response.body, fileStream);

                // Unix: 실행 권한 부여
                if (process.platform !== 'win32') {
                    fs.chmodSync(destPath, 0o755);
                }
            }

            console.log(`[BinManager] ${name} install complete.`);
            return true;
        } catch (error) {
            console.error(`[BinManager] ${name} install failed:`, error);
            this.cleanupFailed(name, destDir);
            return false;
        }
    }

    // ── 압축 해제 (ffmpeg 등) ──

    private async extractBinary(archivePath: string, destDir: string, name: EngineName): Promise<void> {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        const ext = process.platform === 'win32' ? '.exe' : '';
        const targetBinary = `${name}${ext}`;
        const tempExtractDir = path.join(destDir, `_extract_${name}`);

        try {
            if (fs.existsSync(tempExtractDir)) {
                fs.rmSync(tempExtractDir, { recursive: true });
            }
            fs.mkdirSync(tempExtractDir, { recursive: true });

            if (archivePath.endsWith('.zip')) {
                if (process.platform === 'win32') {
                    // Windows: PowerShell로 압축 해제
                    await execFileAsync('powershell', [
                        '-NoProfile', '-Command',
                        `Expand-Archive -Path "${archivePath}" -DestinationPath "${tempExtractDir}" -Force`
                    ]);
                } else {
                    await execFileAsync('unzip', ['-o', archivePath, '-d', tempExtractDir]);
                }
            } else if (archivePath.endsWith('.tar.xz')) {
                await execFileAsync('tar', ['-xf', archivePath, '-C', tempExtractDir]);
            }

            // 압축 해제된 폴더에서 바이너리 찾기
            const found = this.findFileRecursive(tempExtractDir, targetBinary);
            if (!found) {
                throw new Error(`${targetBinary} not found in archive`);
            }

            const finalPath = path.join(destDir, targetBinary);
            fs.copyFileSync(found, finalPath);

            if (process.platform !== 'win32') {
                fs.chmodSync(finalPath, 0o755);
            }
        } finally {
            // 임시 디렉토리 정리
            if (fs.existsSync(tempExtractDir)) {
                fs.rmSync(tempExtractDir, { recursive: true });
            }
        }
    }

    // ── 유틸리티 ──

    private findFileRecursive(dir: string, filename: string): string | null {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const found = this.findFileRecursive(fullPath, filename);
                if (found) return found;
            } else if (entry.name === filename) {
                return fullPath;
            }
        }
        return null;
    }

    private cleanupFailed(name: EngineName, destDir: string): void {
        const ext = process.platform === 'win32' ? '.exe' : '';
        const destPath = path.join(destDir, `${name}${ext}`);
        try {
            if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        } catch { /* ignore */ }
    }

    // ── 레지스트리 접근 ──

    public getEngineRegistry(): Record<EngineName, EngineInfo> {
        return ENGINE_REGISTRY;
    }

    public getLicenses(): LicenseInfo[] {
        return Object.values(ENGINE_REGISTRY).map(e => e.license);
    }
}
