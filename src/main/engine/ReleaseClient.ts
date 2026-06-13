import type { EngineInfo, ReleaseData } from './engineType'

export class ReleaseClient {
    async resolveAsset(engine: EngineInfo, versionTag = 'latest') {
        const release = await this.fetchRelease(engine, versionTag)
        const assets = release.assets ?? release.attachments ?? []
        const candidates = engine.getAssetCandidates(process.platform)
        const asset = assets.find((item) => candidates.includes(item.name))

        if (!asset) {
            const available = assets.map((item) => item.name).join(', ') || 'none'
            throw new Error(
                `${engine.name} asset not found. Expected: ${candidates.join(', ')}. Available: ${available}`
            )
        }

        const downloadUrl = asset.browser_download_url ?? asset.url
        if (!downloadUrl) throw new Error(`${engine.name} asset has no download URL`)

        return {
            versionTag: release.tag_name,
            assetName: asset.name,
            downloadUrl
        }
    }

    private async fetchRelease(engine: EngineInfo, versionTag: string): Promise<ReleaseData> {
        const path = versionTag === 'latest' ? 'latest' : `tags/${versionTag}`
        const url =
            engine.provider === 'codeberg'
                ? `https://codeberg.org/api/v1/repos/${engine.repo}/releases/${path}`
                : `https://api.github.com/repos/${engine.repo}/releases/${path}`

        const response = await fetch(url, {
            headers: { 'User-Agent': 'Storagebucket-App' }
        })

        if (!response.ok) {
            throw new Error(`Release fetch failed: ${response.status} ${response.statusText}`)
        }

        return (await response.json()) as ReleaseData
    }
}
