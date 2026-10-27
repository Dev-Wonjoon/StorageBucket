import path from 'path'
import fs from 'fs'
import { app } from 'electron'
import { pipeline } from 'stream/promises'
import { LicenseInfo } from '../../../shared/types'
import { execFile } from 'node:child_process'
import { GALLERYDL_VERSION } from '../download/GalleryDlAdapter'
import { YTDLP_VERSION } from '../download/YtdlpAdapter'

const isDev = !app.isPackaged

type EngineName = 'yt-dlp' | 'gallery-dl' | 'ffmpeg'

interface EngineInfo {
    name: EngineName
    repo: string
    getAssetName: (platform: string) => string
    license: LicenseInfo
    bundled: boolean
}

const ENGINE_REGISTRY: Record<EngineName, EngineInfo> = {
    'yt-dlp': {
        name: 'yt-dlp',
        repo: 'yt-dlp/yt-dlp',
        getAssetName: (platform) => (platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'),
        license: {
            name: 'Unlicense',
            url: 'https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE',
            notice: 'yt-dlp is released into the public domain under the Unlicense.'
        },
        bundled: false
    },

    'gallery-dl': {
        name: 'gallery-dl',
        repo: 'mikf/gallery-dl',
        getAssetName: (platform) => (platform === 'win32' ? 'gallery-dl.exe' : 'gallery-dl.bin'),
        license: {
            name: 'GPL-2.0',
            url: 'https://github.com/mikf/gallery-dl/blob/master/LICENSE',
            notice: 'gallery-dl is licensed under the GNU General Public License'
        },
        bundled: false
    },

    ffmpeg: {
        name: 'ffmpeg',
        repo: 'BtbN/FFmpeg-Builds',
        getAssetName: (platform) => {
            if (platform === 'win32') return 'ffmpeg-master-latest-win64-gpl.zip'
            if (platform === 'darwin') return 'ffmpeg-master-latest-darwin-gpl.zip'
            return 'ffmpeg-master-latest-linux64-gpl.tar.xz'
        },
        license: {
            name: 'GPL-2.0 / LGPL-2.1',
            url: 'https://github.com/BtbN/FFmpeg-Builds/blob/master/LICENSE',
            notice: 'FFmpeg is license under the GNU General Public License v2.0 and the GNU Lesser General Public License v2.1. Source code is available at https://ffmpeg.org.'
        },
        bundled: false
    }
}

export class BinManager {
    private static instance: BinManager

    private bundledBinPath: string

    private constructor() {
        this.bundledBinPath = isDev
            ? path.join(app.getAppPath(), 'resources', 'bin')
            : path.join(process.resourcesPath, 'bin')
    }

    public static getInstance(): BinManager {
        if (!BinManager.instance) {
            BinManager.instance = new BinManager()
        }
        return BinManager.instance
    }

    private readonly installing = new Set<EngineName>()

    private getInstallDirectory(): string {
        const applicationDirectory = app.isPackaged
            ? process.env.PORTABLE_EXECUTABLE_DIR?.trim() || path.dirname(app.getPath('exe'))
            : app.getAppPath()

        return path.join(applicationDirectory, 'bin')
    }

    private readVersion(name: EngineName, executable: string): Promise<string> {
        const args =
            name === 'ffmpeg'
                ? ['-version']
                : name === 'gallery-dl'
                  ? ['--config-ignore', '--version']
                  : ['--ignore-config', '--version']

        return new Promise((resolve, reject) => {
            execFile(
                executable,
                args,
                {
                    cwd: path.dirname(executable),
                    encoding: 'utf8',
                    windowsHide: true,
                    timeout: 15_000,
                    maxBuffer: 1024 * 1024
                },
                (error, stdout) => {
                    if (error) {
                        reject(error)
                        return
                    }

                    resolve(stdout.trim().split(/\r?\n/, 1)[0] ?? '')
                }
            )
        })
    }

    private async validateBinary(name: EngineName, executable: string): Promise<void> {
        const info = await fs.promises.lstat(executable)

        if (!info.isFile() || info.size < 2) {
            throw new Error('다운로드한 실행 파일이 올바르지 않습니다.')
        }

        if (process.platform === 'win32') {
            const handle = await fs.promises.open(executable, 'r')

            try {
                const signature = Buffer.alloc(2)
                const { bytesRead } = await handle.read(signature, 0, 2, 0)

                if (bytesRead !== 2 || signature[0] !== 0x4d || signature[1] !== 0x5a) {
                    throw new Error('Windows 실행 파일 형식이 아닙니다.')
                }
            } finally {
                await handle.close()
            }
        }

        const version = await this.readVersion(name, executable)

        if (name === 'gallery-dl' && version !== GALLERYDL_VERSION) {
            throw new Error(`gallery-dl 버전이 일치하지 않습니다: ${version}`)
        }

        if (name === 'yt-dlp' && version !== YTDLP_VERSION) {
            throw new Error(`yt-dlp 버전이 일치하지 않습니다: ${version}`)
        }

        if (name === 'ffmpeg' && !version.startsWith('ffmpeg version ')) {
            throw new Error('FFmpeg 버전을 확인하지 못했습니다.')
        }
    }

    public getBinaryPath(name: EngineName): string {
        const ext = process.platform === 'win32' ? '.exe' : ''
        const filename = `${name}${ext}`

        const installedPath = path.join(this.getInstallDirectory(), filename)

        if (fs.existsSync(installedPath)) {
            return installedPath
        }

        // 이전 설치 위치는 조회만 유지한다.
        const legacyPath = path.join(this.bundledBinPath, filename)

        if (fs.existsSync(legacyPath)) {
            return legacyPath
        }

        return installedPath
    }

    public checkExists(name: EngineName): boolean {
        try {
            return fs.statSync(this.getBinaryPath(name)).isFile()
        } catch {
            return false
        }
    }

    public async getInstalledVersion(name: EngineName): Promise<string | null> {
        if (!this.checkExists(name)) return null

        try {
            const version = await this.readVersion(name, this.getBinaryPath(name))
            return version || null
        } catch {
            return null
        }
    }

    // ── GitHub 릴리즈 버전 목록 ──

    public async getVersions(name: EngineName): Promise<string[]> {
        if (name === 'gallery-dl') {
            return [`v${GALLERYDL_VERSION}`]
        }

        if (name === 'yt-dlp') {
            return [YTDLP_VERSION]
        }

        const engine = ENGINE_REGISTRY[name]
        try {
            const response = await fetch(`https://api.github.com/repos/${engine.repo}/releases`, {
                headers: { 'User-Agent': 'StorageBucket-App' }
            })

            if (!response.ok) throw new Error(`GitHub API Fail: ${response.status}`)

            const releases = await response.json()
            if (!Array.isArray(releases)) return []

            return releases.map((r: any) => r.tag_name)
        } catch (error) {
            console.error(`[BinManager] Failed to fetch ${name} versions:`, error)
            return []
        }
    }

    // ── 엔진 다운로드 & 설치 ──

    public async downloadEngine(name: EngineName, versionTag: string = 'latest'): Promise<boolean> {
        if (!Object.prototype.hasOwnProperty.call(ENGINE_REGISTRY, name)) {
            return false
        }

        if (this.installing.has(name)) {
            return false
        }

        this.installing.add(name)

        let stagingDirectory: string | undefined

        try {
            const engine = ENGINE_REGISTRY[name]
            const pinnedVersion =
                name === 'gallery-dl'
                    ? GALLERYDL_VERSION
                    : name === 'yt-dlp'
                      ? YTDLP_VERSION
                      : undefined

            if (pinnedVersion) {
                if (versionTag !== 'latest' && versionTag.replace(/^v/, '') !== pinnedVersion) {
                    throw new Error(`지원하지 않는 엔진 버전입니다: ${versionTag}`)
                }

                versionTag = name === 'gallery-dl' ? `v${pinnedVersion}` : pinnedVersion
            }

            if (
                name === 'gallery-dl' &&
                process.platform !== 'win32' &&
                process.platform !== 'linux'
            ) {
                throw new Error('현재 플랫폼용 gallery-dl 설치를 지원하지 않습니다.')
            }

            const destinationDirectory = this.getInstallDirectory()

            await fs.promises.mkdir(destinationDirectory, { recursive: true })

            stagingDirectory = await fs.promises.mkdtemp(
                path.join(destinationDirectory, `.install-${name}-`)
            )

            // 메타데이터 조회부터 파일 다운로드 완료까지의 제한 시간
            const signal = AbortSignal.timeout(120_000)

            if (versionTag === 'latest') {
                const apiResponse = await fetch(
                    `https://api.github.com/repos/${engine.repo}/releases/latest`,
                    {
                        headers: { 'User-Agent': 'StorageBucket-App' },
                        signal
                    }
                )

                if (!apiResponse.ok) {
                    throw new Error(`릴리스 조회 실패: HTTP ${apiResponse.status}`)
                }

                const release = (await apiResponse.json()) as {
                    tag_name?: unknown
                }

                if (typeof release?.tag_name !== 'string' || !release.tag_name.trim()) {
                    throw new Error('릴리스 응답에 버전 정보가 없습니다.')
                }

                versionTag = release.tag_name
            }

            const assetName = engine.getAssetName(process.platform)
            const tag = encodeURIComponent(versionTag)

            const downloadUrl =
                name === 'gallery-dl'
                    ? `https://codeberg.org/mikf/gallery-dl/releases/download/${tag}/${assetName}`
                    : `https://github.com/${engine.repo}/releases/download/${tag}/${assetName}`

            console.log(`[BinManager] Downloading ${name}: ${downloadUrl}`)

            const response = await fetch(downloadUrl, {
                headers: { 'User-Agent': 'StorageBucket-App' },
                signal
            })

            if (!response.ok) {
                throw new Error(`다운로드 실패: HTTP ${response.status}`)
            }

            if (!response.body) {
                throw new Error('다운로드 응답이 비어 있습니다.')
            }

            const ext = process.platform === 'win32' ? '.exe' : ''
            const filename = `${name}${ext}`
            const stagedBinary = path.join(stagingDirectory, filename)

            const isArchive = assetName.endsWith('.zip') || assetName.endsWith('.tar.xz')

            const downloadPath = isArchive ? path.join(stagingDirectory, assetName) : stagedBinary

            await pipeline(response.body, fs.createWriteStream(downloadPath, { flags: 'wx' }), {
                signal
            })

            if (isArchive) {
                await this.extractBinary(downloadPath, stagingDirectory, name)
            }

            if (process.platform !== 'win32') {
                await fs.promises.chmod(stagedBinary, 0o755)
            }

            await this.validateBinary(name, stagedBinary)

            const destination = path.join(destinationDirectory, filename)

            // 기존 파일을 먼저 삭제하지 않는다.
            // 교체가 거부되면 설치 실패로 처리하고 기존 파일을 유지한다.
            await fs.promises.rename(stagedBinary, destination)

            console.log(`[BinManager] ${name} install complete.`)
            return true
        } catch (error) {
            console.error(`[BinManager] ${name} install failed:`, error)
            return false
        } finally {
            if (stagingDirectory) {
                try {
                    await fs.promises.rm(stagingDirectory, {
                        recursive: true,
                        force: true
                    })
                } catch (error) {
                    console.warn('[BinManager] Temporary directory cleanup failed:', error)
                }
            }

            this.installing.delete(name)
        }
    }

    // ── 압축 해제 (ffmpeg 등) ──

    private async extractBinary(
        archivePath: string,
        destDir: string,
        name: EngineName
    ): Promise<void> {
        const { execFile } = await import('child_process')
        const { promisify } = await import('util')
        const execFileAsync = promisify(execFile)

        const ext = process.platform === 'win32' ? '.exe' : ''
        const targetBinary = `${name}${ext}`
        const tempExtractDir = path.join(destDir, `_extract_${name}`)

        try {
            if (fs.existsSync(tempExtractDir)) {
                fs.rmSync(tempExtractDir, { recursive: true })
            }
            fs.mkdirSync(tempExtractDir, { recursive: true })

            if (archivePath.endsWith('.zip')) {
                if (process.platform === 'win32') {
                    // Windows: PowerShell로 압축 해제
                    await execFileAsync('powershell', [
                        '-NoProfile',
                        '-Command',
                        `Expand-Archive -Path "${archivePath}" -DestinationPath "${tempExtractDir}" -Force`
                    ])
                } else {
                    await execFileAsync('unzip', ['-o', archivePath, '-d', tempExtractDir])
                }
            } else if (archivePath.endsWith('.tar.xz')) {
                await execFileAsync('tar', ['-xf', archivePath, '-C', tempExtractDir])
            }

            // 압축 해제된 폴더에서 바이너리 찾기
            const found = this.findFileRecursive(tempExtractDir, targetBinary)
            if (!found) {
                throw new Error(`${targetBinary} not found in archive`)
            }

            const finalPath = path.join(destDir, targetBinary)
            fs.copyFileSync(found, finalPath)

            if (process.platform !== 'win32') {
                fs.chmodSync(finalPath, 0o755)
            }
        } finally {
            // 임시 디렉토리 정리
            if (fs.existsSync(tempExtractDir)) {
                fs.rmSync(tempExtractDir, { recursive: true })
            }
        }
    }

    // ── 유틸리티 ──

    private findFileRecursive(dir: string, filename: string): string | null {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name)
            if (entry.isDirectory()) {
                const found = this.findFileRecursive(fullPath, filename)
                if (found) return found
            } else if (entry.name === filename) {
                return fullPath
            }
        }
        return null
    }

    // ── 레지스트리 접근 ──

    public getEngineRegistry(): Record<EngineName, EngineInfo> {
        return ENGINE_REGISTRY
    }

    public getLicenses(): LicenseInfo[] {
        return Object.values(ENGINE_REGISTRY).map((e) => e.license)
    }
}
