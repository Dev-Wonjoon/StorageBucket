import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createAppApi, type IpcTransport } from '../../src/preload/api'
import * as downloadHandlers from '../../src/main/handlers/DownloadHandler'
import * as mediaHandlers from '../../src/main/handlers/MediaHandler'

function fixture() {
    const calls: { channel: string; args: unknown[] }[] = []
    const subscribe = vi.fn(() => () => {})

    const transport: IpcTransport = {
        invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
            calls.push({ channel, args })
            return Promise.resolve(undefined as T)
        },
        subscribe
    }

    return { api: createAppApi(transport), calls, subscribe }
}

describe('preload contract', () => {
    it('정식 명령과 시스템 명령이 선언된 main 채널을 사용한다', async () => {
        const { api, calls, subscribe } = fixture()
        const directory = new URL('../../src/main/handlers/', import.meta.url)

        const registered = new Set(
            readdirSync(directory)
                .filter((file) => file.endsWith('.ts'))
                .flatMap((file) =>
                    [
                        ...readFileSync(new URL(file, directory), 'utf8').matchAll(
                            /['"]([^'"]+)['"]:\s*(?:async\s*)?\(/g
                        )
                    ].map((match) => match[1])
                )
        )

        await Promise.all([
            api.media.list(),
            api.media.get({ mediaId: 1 }),
            api.media.edit({
                mediaId: 1,
                expectedRevision: 0,
                customTitle: '제목'
            }),
            api.media.unregisterFiles({
                mediaId: 1,
                expectedRevision: 0,
                fileIds: [2]
            }),
            api.media.unregisterMedia({ mediaId: 1, expectedRevision: 0 }),
            api.media.suggest({ kind: 'tag', text: 'tag' }),

            api.downloads.enqueue({
                mode: 'create',
                url: 'https://example.invalid/post'
            }),
            api.downloads.list(),
            api.downloads.get({ jobId: 'job' }),
            api.downloads.run({ jobId: 'job', trigger: 'manual_initial' }),
            api.downloads.cancel({ jobId: 'job' }),

            api.showItemInFolder('C:/fixture/a.png'),
            api.getDoubleClickInterval(),
            api.getDownloadPath(),
            api.setDownloadPath(),
            api.getEngineStatus(),
            api.installEngine('yt-dlp'),
            api.getEngineLicenses(),
            api.getCookieBrowser(),
            api.setCookieBrowser('chrome'),
            api.getCookieFilePath(),
            api.setCookieFilePath(),
            api.clearCookieFilePath()
        ])

        expect(calls.filter((call) => !registered.has(call.channel))).toEqual([])
        expect(subscribe).not.toHaveBeenCalled()
    })

    it('이전 미디어·태그·즐겨찾기·검색·다운로드 API를 공개하지 않는다', () => {
        const { api } = fixture()

        expect(Object.keys(api).sort()).toEqual(
            [
                'media',
                'downloads',
                'showItemInFolder',
                'getDoubleClickInterval',
                'getDownloadPath',
                'setDownloadPath',
                'getEngineStatus',
                'installEngine',
                'getEngineLicenses',
                'getCookieBrowser',
                'setCookieBrowser',
                'getCookieFilePath',
                'setCookieFilePath',
                'clearCookieFilePath'
            ].sort()
        )

        expect(Object.keys(mediaHandlers).sort()).toEqual(
            ['createMediaHandlers', 'shellHandler'].sort()
        )

        expect(Object.keys(mediaHandlers.shellHandler)).toEqual(['shell:show-item'])

        const channels = Object.keys(mediaHandlers.createMediaHandlers(() => undefined))

        expect(channels).not.toContain('media:get-all')
        expect(channels).not.toContain('media:delete')
    })

    it('다운로드 모듈은 정식 팩터리만 내보낸다', () => {
        expect(Object.keys(downloadHandlers)).toEqual(['createDownloadHandlers'])

        expect(Object.keys(downloadHandlers.createDownloadHandlers(() => undefined))).toEqual([
            'download:enqueue',
            'download:list',
            'download:get',
            'download:run',
            'download:cancel'
        ])
    })

    it('태그·즐겨찾기 편집과 등록 해제에 ID와 revision을 전달한다', async () => {
        const { api, calls } = fixture()

        await api.media.edit({
            mediaId: 42,
            expectedRevision: 7,
            isFavorite: true,
            tagChange: { removeIds: [3] }
        })

        await api.media.unregisterMedia({
            mediaId: 42,
            expectedRevision: 8
        })

        expect(calls).toEqual([
            {
                channel: 'media:edit',
                args: [
                    {
                        mediaId: 42,
                        expectedRevision: 7,
                        isFavorite: true,
                        tagChange: { removeIds: [3] }
                    }
                ]
            },
            {
                channel: 'media:unregister',
                args: [{ mediaId: 42, expectedRevision: 8 }]
            }
        ])
    })
})
