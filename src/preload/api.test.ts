import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createAppApi, type IpcTransport } from './api'

function createTransport(): {
    transport: IpcTransport
    calls: Array<{ channel: string; args: unknown[] }>
    listeners: Map<string, (value: unknown) => void>
} {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const listeners = new Map<string, (value: unknown) => void>()
    const transport: IpcTransport = {
        invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
            calls.push({ channel, args })
            return Promise.resolve(undefined as T)
        },
        subscribe<T>(channel: string, callback: (value: T) => void) {
            listeners.set(channel, (value) => callback(value as T))
            return () => {
                listeners.delete(channel)
            }
        }
    }
    return { transport, calls, listeners }
}

describe('preload contract', () => {
    it('routes every exposed command to a registered existing main handler', async () => {
        const fixture = createTransport()
        const api = createAppApi(fixture.transport)
        // Read handler declarations without importing modules that initialize the user database.
        const directory = new URL('../main/handlers/', import.meta.url)
        const registered = new Set(
            readdirSync(directory)
                .filter((file) => file.endsWith('.ts'))
                .flatMap((file) => {
                    const source = readFileSync(new URL(file, directory), 'utf8')
                    return [...source.matchAll(/['"]([^'"]+)['"]:\s*(?:async\s*)?\(/g)].map(
                        (match) => match[1]
                    )
                })
        )
        await Promise.all([
            api.downloadVideo('https://example.com'),
            api.getMediaFiles(),
            api.deleteMedia(1),
            api.showItemInFolder('C:/photo.jpg'),
            api.getDownloadPath(),
            api.setDownloadPath(),
            api.getEngineStatus(),
            api.installEngine('yt-dlp'),
            api.getEngineLicenses(),
            api.getCookieBrowser(),
            api.setCookieBrowser('chrome'),
            api.getCookieFilePath(),
            api.setCookieFilePath(),
            api.clearCookieFilePath(),
            api.getFavorites(),
            api.toggleFavorite(1),
            api.checkFavorite(1),
            api.getAllTags(),
            api.getMediaTags(1),
            api.createTag('tag'),
            api.renameTag(1, 'new'),
            api.deleteTag(1),
            api.addTagsToMedia(1, ['tag']),
            api.removeTagFromMedia(1, 2),
            api.bulkAddTags([1], ['tag']),
            api.bulkRemoveTags([1], [2]),
            api.bulkReplaceTags([1], ['tag']),
            api.searchMedia({ page: 1, limit: 20 }),
            api.suggestAuthors('author'),
            api.suggestPlatforms('platform'),
            api.suggestTags('tag')
        ])
        expect(registered.size).toBeGreaterThan(0)
        const missing = fixture.calls.filter((call) => !registered.has(call.channel))
        expect(missing).toEqual([])
    })

    it('passes numeric media IDs and a single numeric tag ID', async () => {
        const fixture = createTransport()
        const api = createAppApi(fixture.transport)
        await api.deleteMedia(42)
        await api.removeTagFromMedia(42, 7)
        expect(fixture.calls.map((call) => call.args)).toEqual([[42], [42, 7]])
    })

    it('relays duplicate events and exposes listener cleanup', () => {
        const fixture = createTransport()
        const api = createAppApi(fixture.transport)
        const callback = vi.fn()
        const release = api.onDuplicate(callback)
        const notice = { jobId: 'job', message: '중복 URL' }
        fixture.listeners.get('download:duplicate')?.(notice)
        expect(callback).toHaveBeenCalledWith(notice)
        release()
        expect(fixture.listeners.size).toBe(0)
    })
})
