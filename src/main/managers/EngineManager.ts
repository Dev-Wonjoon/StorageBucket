import fs from 'fs';
import path from 'path';
import { ConfigManager } from './ConfigManager';
import { ENGINE_REGISTRY } from '../engine/engineRegistry'; 
import { ReleaseClient } from '../engine/ReleaseClient';
import type { EngineName } from '../engine/engineType';
import { pipeline } from 'stream/promises';

export class EngineManager {
    private static instance: EngineManager;
    private releaseClient = new ReleaseClient();

    static getInstance(): EngineManager {
        if(!EngineManager.instance) EngineManager.instance = new EngineManager();
        return EngineManager.instance;
    }

    getInstallDir(): string {
        return path.join(ConfigManager.getInstance().getBasePath(), 'bin');
    }

    getBinaryPath(name: EngineName): string {
        const ext = process.platform === 'win32' ? '.exe' : '';
        return path.join(this.getInstallDir(), `${name}${ext}`);
    }

    getRequiredBinaryPath(name: EngineName): string {
        const binaryPath = this.getBinaryPath(name);
        if(!fs.existsSync(binaryPath)) throw new Error(`ENGINE_MISSING:${name}`);
        return binaryPath;
    }

    checkExists(name: EngineName): boolean {
        return fs.existsSync(this.getBinaryPath(name));
    }

    async installEngine(name: EngineName, versionTag = 'latest'): Promise<boolean> {
        const engine = ENGINE_REGISTRY[name];
        const destDir = this.getInstallDir();

        try {
            fs.mkdirSync(destDir, { recursive: true })
            const { assetName, downloadUrl } = await this.releaseClient.resolveAsset(engine, versionTag);
            const response = await fetch(downloadUrl);

            if(!response.ok || !response.body) {
                throw new Error(`Download failed: ${response.status} ${response.statusText}`);
            }

            if(assetName.endsWith('.zip') || assetName.endsWith('.tar.xz')) {
                const archivePath = path.join(destDir, assetName);

                // changed: archive assets must be saved as archives before extraction.
                await pipeline(response.body, fs.createWriteStream(archivePath));
                await this.extractBinary(archivePath, destDir, name);
                fs.rmSync(archivePath, { force: true });
            } else {
                const binaryPath = this.getBinaryPath(name);

                // changed: single executable assets can be written directly.
                await pipeline(response.body, fs.createWriteStream(binaryPath));

                if(process.platform != 'win32') {
                    fs.chmodSync(binaryPath, 0o755);
                }
            }

            return true
        } catch(error) {
            console.error(`[EngineManager] ${name} install failed:`, error);
            return false;
        }

    }

    async getInstalledVersion(name: EngineName): Promise<string | null> {
        if(!this.checkExists(name)) return null;

        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile);

        try {
            const { stdout } = await execFileAsync(this.getBinaryPath(name), ['--version']);
            return stdout.trim().split('\n')[0] || null;
        } catch {
            return null;
        }
    }

    getRegistry() {
        return ENGINE_REGISTRY;
    }

    getLicense() {
        return Object.values(ENGINE_REGISTRY).map((engine) => engine.license);
    }

    private async extractBinary(archivePath: string, destDir: string, name: EngineName): Promise<void> {
        const { execFile } = await import('child_process');
        const { promisify } = await import('util');
        const execFileAsync = promisify(execFile)
        const tempDir = path.join(destDir, `_extract_${name}`);

        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.mkdirSync(tempDir, { recursive: true });

        try {
            if(archivePath.endsWith('.zip')) {
                // changed: LiteralPath avoids PowerShell path parsing surprises.
                await execFileAsync('powershell', [
                    '-NoProfile',
                    '-Command',
                    `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${tempDir}' -Force`
                ]);
            } else {
                await execFileAsync('tar', ['-xf', archivePath, '-C', tempDir])
            }

            const found = this.findFileRecursive(tempDir, path.basename(this.getBinaryPath(name)));
            if(!found) throw new Error(`${name} binary not found in archive`);

            fs.copyFileSync(found, this.getBinaryPath(name));
        } finally {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    private findFileRecursive(dir: string, filename: string): string | null {
        for(const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const fullPath = path.join(dir, entry.name);
            if(entry.isDirectory()) {
                const found = this.findFileRecursive(fullPath, filename);
                if(found) return found;
            } else if(entry.name === filename) {
                return fullPath;
            }
        }
        return null;
    }
}
