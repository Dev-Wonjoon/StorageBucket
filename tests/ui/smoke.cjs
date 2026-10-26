/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- This standalone Electron main/preload harness runs directly as CommonJS without a TS loader. */
// Run the built renderer against synthetic APIs in a disposable Electron profile.
// No production main/preload, database, config, cookies, downloads or shell calls.
const { app, BrowserWindow, protocol } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'storagebucket-ui-'))
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(profile, 'screenshots')
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'session'))
app.commandLine.appendSwitch('disable-gpu')
protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

function installFixtures() {
    const { contextBridge } = require('electron')
    const calls = []
    const ok = (data) => ({ ok: true, data })
    const now = Date.UTC(2026, 9, 25)
    const rows = Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        sourceKind: 'download',
        requestUrl: 'https://www.youtube.com/watch?v=fixture-' + i,
        sourceTitle: '보관한 영상 ' + (i + 1),
        customTitle: null,
        title: '보관한 영상 ' + (i + 1),
        revision: 0,
        coverMode: 'auto',
        cover: { fileId: i + 1, path: 'C:/ui-fixtures/cover-' + i + '.svg', kind: 'video' },
        fileCount: 60,
        isFavorite: i % 2 === 0,
        createdAt: now,
        updatedAt: null
    }))
    const tags = new Map()
    const jobs = ['running', 'pending', 'completed', 'cancelled'].map((state, i) => ({
        id: 'job-' + i,
        url: 'https://www.youtube.com/watch?v=fixture-' + i,
        title: '다운로드 영상 ' + (i + 1),
        state,
        phase: state === 'running' ? 'downloading' : state === 'pending' ? null : 'finished',
        progress: state === 'running' ? 42 : state === 'completed' ? 100 : 0,
        options: {},
        cleanupRequired: state === 'cancelled',
        currentAttemptId: 'attempt-' + i,
        errorCode: null
    }))
    const api = {
        getDoubleClickInterval: async () => {
            calls.push({ kind: 'os-click-interval' })
            return 500
        },
        getEngineStatus: async () => ({
            'yt-dlp': { installed: true, version: 'fixture' },
            ffmpeg: { installed: true, version: 'fixture' }
        }),
        showItemInFolder: async (filepath) => {
            calls.push({ kind: 'show-file', filepath })
        },
        getDownloadPath: async () => 'C:/ui-fixtures/downloads',
        setDownloadPath: async () => null,
        getEngineLicenses: async () => [],
        installEngine: async () => false,
        getCookieBrowser: async () => '',
        getCookieFilePath: async () => '',
        setCookieBrowser: async () => false,
        setCookieFilePath: async () => null,
        clearCookieFilePath: async () => false,
        media: {
            list: async ({ favoritesOnly } = {}) => {
                const data = rows.filter((row) => !favoritesOnly || row.isFavorite)
                return ok({ data, total: data.length, hasNextPage: false })
            },
            get: async ({ mediaId, fileOffset = 0, fileLimit = 50 }) => {
                calls.push({ kind: 'get', mediaId, fileLimit })
                const row = rows.find((item) => item.id === mediaId)
                const files = Array.from({ length: 60 }, (_, i) => ({
                    id: mediaId * 100 + i,
                    mediaId,
                    fileKey: 'file-' + i,
                    storageKind: 'app_managed',
                    filepath: 'C:/ui-fixtures/file-' + i + '.mp4',
                    kind: 'video',
                    position: i,
                    title: '영상 파일 ' + (i + 1),
                    thumbnailPath: row.cover.path,
                    previewPath: null,
                    thumbnailOrigin: 'app_generated'
                }))
                return ok({
                    ...row,
                    files: {
                        data: files.slice(fileOffset, fileOffset + fileLimit),
                        total: files.length,
                        hasNextPage: fileOffset + fileLimit < files.length
                    },
                    tags: tags.get(mediaId) || [],
                    favorite: null,
                    localFolder: null,
                    locations: []
                })
            },
            edit: async (request) => {
                calls.push({ kind: 'edit', request })
                const row = rows.find((item) => item.id === request.mediaId)
                if ('customTitle' in request) {
                    row.customTitle = request.customTitle
                    row.title = request.customTitle || row.sourceTitle
                }
                if ('isFavorite' in request) row.isFavorite = request.isFavorite
                if (request.tagChange?.addNames)
                    tags.set(
                        row.id,
                        request.tagChange.addNames.map((name, i) => ({ id: i + 1, name }))
                    )
                row.revision++
                return ok(row)
            },
            suggest: async () => ok([]),
            unregisterFiles: async () => {
                throw new Error('Unexpected destructive fixture action')
            },
            unregisterMedia: async ({ mediaId, expectedRevision }) => {
                const index = rows.findIndex((item) => item.id === mediaId)
                if (index < 0 || rows[index].revision !== expectedRevision)
                    throw new Error('Stale unregister fixture request')
                calls.push({ kind: 'unregister', mediaId, expectedRevision })
                rows.splice(index, 1)
                return ok({ mediaId, parentRemoved: true, revision: null, cleanupTaskId: null })
            }
        },
        downloads: {
            list: async ({ limit = 50, offset = 0 } = {}) =>
                ok({
                    data: jobs.slice(offset, offset + limit),
                    limit,
                    offset,
                    hasNextPage: offset + limit < jobs.length
                }),
            get: async ({ jobId }) => ok(jobs.find((job) => job.id === jobId)),
            enqueue: async ({ url }) => {
                const job = { ...jobs[1], id: 'job-new', url }
                jobs.unshift(job)
                calls.push({ kind: 'enqueue', url })
                return ok(job)
            },
            run: async ({ jobId }) => {
                const job = jobs.find((item) => item.id === jobId)
                job.state = 'completed'
                job.phase = 'finished'
                job.progress = 100
                return ok({
                    status: 'committed',
                    jobId,
                    attemptId: 'new-attempt',
                    mediaIdSnapshot: 1
                })
            },
            cancel: async ({ jobId }) => {
                calls.push({ kind: 'cancel', jobId })
                return ok({ accepted: true })
            }
        }
    }
    contextBridge.exposeInMainWorld('api', api)
    contextBridge.exposeInMainWorld('fixtureProbe', { calls: () => calls })
}

const preload = path.join(profile, 'fixture-preload.cjs')
fs.writeFileSync(preload, '(' + installFixtures.toString() + ')()')
const errors = []
let window
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const evaluate = (code) => window.webContents.executeJavaScript(code)
async function waitFor(code) {
    for (let i = 0; i < 60; i++) {
        if (await evaluate('Boolean(' + code + ')')) return
        await pause(50)
    }
    throw new Error('Timed out waiting for ' + code)
}
async function click(label) {
    const found = await evaluate(
        `(() => { const button = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true })()`
    )
    assert(found, 'Missing button: ' + label)
    await pause(30)
}
async function input(selector, value) {
    await evaluate(
        `(() => { const element = document.querySelector(${JSON.stringify(selector)}); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); })()`
    )
    await pause(30)
}
async function screenshot(name) {
    fs.mkdirSync(output, { recursive: true })
    window.webContents.invalidate()
    await pause(300)
    fs.writeFileSync(
        path.join(output, name + '.png'),
        (await window.webContents.capturePage()).toPNG()
    )
}
async function run() {
    await app.whenReady()
    protocol.handle(
        'media',
        () =>
            new Response(
                '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#394867"/><circle cx="465" cy="100" r="68" fill="#a5b4fc"/><path d="M0 360L210 130L405 360Z" fill="#64748b"/><path d="M200 360L420 180L640 360Z" fill="#818cf8"/></svg>',
                { headers: { 'content-type': 'image/svg+xml' } }
            )
    )
    window = new BrowserWindow({
        width: 1500,
        height: 950,
        show: false,
        webPreferences: {
            preload,
            contextIsolation: true,
            sandbox: true,
            backgroundThrottling: false,
            offscreen: true
        }
    })
    window.webContents.session.webRequest.onBeforeRequest(
        { urls: ['http://*/*', 'https://*/*'] },
        (_details, callback) => callback({ cancel: true })
    )
    window.webContents.on('console-message', (details) => {
        if (details.level === 'error') errors.push(details.message)
    })
    await window.loadFile(path.resolve(__dirname, '../../out/renderer/index.html'))
    await waitFor("document.querySelectorAll('article').length === 30")
    await evaluate(
        "document.documentElement.classList.remove('dark'); window.__confirmCalls = 0; window.confirm = () => { window.__confirmCalls++; return false }; true"
    )
    assert.equal(
        await evaluate('!!document.querySelector(\'input[aria-label="다운로드할 URL"]\')'),
        true
    )
    assert.equal(
        await evaluate('!!document.querySelector(\'[aria-label="다운로드 작업 목록"]\')'),
        false
    )
    // Footer order and both star appearances are checked before any mutations.
    assert.deepEqual(
        await evaluate(
            "Array.from(document.querySelector('article').lastElementChild.querySelectorAll('button')).map(b => b.getAttribute('aria-label'))"
        ),
        ['보관한 영상 1 즐겨찾기 해제', '보관한 영상 1 파일 위치 열기', '보관한 영상 1 더보기']
    )
    assert.equal(
        await evaluate(
            "document.querySelector('button[aria-label=\"보관한 영상 1 즐겨찾기 해제\"] svg').getAttribute('fill')"
        ),
        'currentColor'
    )
    assert.equal(
        await evaluate(
            "document.querySelector('button[aria-label=\"보관한 영상 2 즐겨찾기 추가\"] svg').getAttribute('fill')"
        ),
        'none'
    )
    // A pointer click selects immediately, without a double-click timer.
    await evaluate(
        `document.querySelector('button[aria-label="보관한 영상 1 상세보기"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`
    )
    assert.equal(await evaluate("!!document.querySelector('aside[aria-labelledby]')"), true)
    await waitFor('!!document.querySelector(\'input[aria-label="추가할 태그 이름"]\')')
    const reads = await evaluate(
        "window.fixtureProbe.calls().filter(c => c.kind === 'get' && c.mediaId === 1 && c.fileLimit === 50).length"
    )
    await click('보관한 영상 1 상세보기')
    assert.equal(
        await evaluate(
            "window.fixtureProbe.calls().filter(c => c.kind === 'get' && c.mediaId === 1 && c.fileLimit === 50).length"
        ),
        reads
    )
    await evaluate(
        `(() => { const b = document.querySelector('button[aria-label="보관한 영상 1 상세보기"]'); b.dispatchEvent(new MouseEvent('click', { bubbles:true, detail:2 })); b.dispatchEvent(new MouseEvent('dblclick', { bubbles:true, detail:2 })); })()`
    )
    assert.equal(
        await evaluate("window.fixtureProbe.calls().filter(c => c.kind === 'show-file').length"),
        0
    )
    assert.equal(await evaluate("!!document.querySelector('aside[aria-labelledby]')"), true)
    assert.equal(
        await evaluate(
            "document.querySelector('aside[aria-labelledby]').getBoundingClientRect().width"
        ),
        400
    )
    await pause(150)
    await evaluate(
        "(() => { const panel = document.querySelector('aside[aria-labelledby]'); panel.previousElementSibling.scrollTop = 150; panel.lastElementChild.scrollTop = 200; })()"
    )
    assert.deepEqual(
        await evaluate(
            "(() => { const panel = document.querySelector('aside[aria-labelledby]'); return [panel.previousElementSibling.scrollTop, panel.lastElementChild.scrollTop] })()"
        ),
        [150, 200]
    )
    await evaluate(
        "(() => { const panel = document.querySelector('aside[aria-labelledby]'); panel.previousElementSibling.scrollTop = 0; panel.lastElementChild.scrollTop = 0; })()"
    )
    await click('보관한 영상 1 즐겨찾기 해제')
    await waitFor(
        '!!document.querySelector(\'button[aria-label="보관한 영상 1 즐겨찾기 추가"]:not(:disabled)\')'
    )
    assert.equal(
        await evaluate("document.querySelector('aside[aria-labelledby] h3').textContent"),
        '보관한 영상 1'
    )
    assert.equal(
        await evaluate(
            "document.querySelector('main').textContent.includes('변경을 반영했습니다.')"
        ),
        false
    )
    await click('보관한 영상 1 즐겨찾기 추가')
    await waitFor(
        '!!document.querySelector(\'button[aria-label="보관한 영상 1 즐겨찾기 해제"]:not(:disabled)\')'
    )
    await click('보관한 영상 2 더보기')
    await screenshot('gallery-actions-menu-wide')
    await evaluate(
        "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowDown', bubbles:true })); true"
    )
    assert.equal(await evaluate('document.activeElement.textContent.trim()'), '태그 편집')
    await evaluate(
        "document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); true"
    )
    assert.equal(await evaluate("!!document.querySelector('[role=menu]')"), false)
    assert.equal(await evaluate("!!document.querySelector('aside[aria-labelledby]')"), true)
    await input('input[aria-label="추가할 태그 이름"]', '아직 저장하지 않은 태그')
    const beforeSame = await evaluate('window.__confirmCalls')
    await click('보관한 영상 1 상세보기')
    assert.equal(await evaluate('window.__confirmCalls'), beforeSame)
    assert.equal(
        await evaluate(
            'document.querySelector(\'button[aria-label="보관한 영상 1 즐겨찾기 해제"]\').disabled'
        ),
        true
    )
    await click('보관한 영상 2 파일 위치 열기')
    assert.equal(
        await evaluate("window.fixtureProbe.calls().filter(c => c.kind === 'show-file').length"),
        1
    )
    assert.equal(await evaluate('window.__confirmCalls'), beforeSame)
    assert.equal(
        await evaluate("document.querySelector('aside[aria-labelledby] h3').textContent"),
        '보관한 영상 1'
    )
    await click('보관한 영상 1 더보기')
    await click('태그 편집')
    await waitFor("document.activeElement.getAttribute('aria-label') === '추가할 태그 이름'")
    assert.equal(
        await evaluate('document.querySelector(\'input[aria-label="추가할 태그 이름"]\').value'),
        '아직 저장하지 않은 태그'
    )
    const beforeOutside = await evaluate('window.__confirmCalls')
    await evaluate("document.querySelector('main h1').click(); true")
    assert.equal(await evaluate('window.__confirmCalls'), beforeOutside + 1)
    await click('보관한 영상 2 상세보기')
    assert.equal(
        await evaluate("document.querySelector('aside[aria-labelledby] h3').textContent"),
        '보관한 영상 1'
    )
    const beforeMenu = await evaluate('window.__confirmCalls')
    await click('다운로드')
    assert.equal(await evaluate('window.__confirmCalls'), beforeMenu + 1)
    assert.equal(await evaluate("document.querySelector('main h1').textContent"), '갤러리')
    await evaluate('window.confirm = () => { window.__confirmCalls++; return true }; true')
    await click('보관한 영상 2 상세보기')
    await waitFor(
        "document.querySelector('aside[aria-labelledby] h3')?.textContent === '보관한 영상 2'"
    )
    await click('보관한 영상 2 더보기')
    await click('제목 편집')
    await waitFor("document.activeElement === document.querySelector('label input')")
    await input('label input', '제목 초안')
    await click('보관한 영상 2 더보기')
    await click('태그 편집')
    await waitFor("document.activeElement.getAttribute('aria-label') === '추가할 태그 이름'")
    assert.equal(await evaluate("document.querySelector('label input').value"), '제목 초안')
    await click('보관한 영상 1 상세보기')
    await waitFor(
        "document.querySelector('aside[aria-labelledby] h3')?.textContent === '보관한 영상 1'"
    )
    await click('보관한 영상 30 더보기')
    await evaluate('window.confirm = () => false; true')
    await click('등록 해제')
    assert.equal(
        await evaluate("window.fixtureProbe.calls().filter(c => c.kind === 'unregister').length"),
        0
    )
    await click('보관한 영상 30 더보기')
    await evaluate('window.confirm = () => true; true')
    await click('등록 해제')
    await waitFor("window.fixtureProbe.calls().filter(c => c.kind === 'unregister').length === 1")
    assert.equal(
        await evaluate(
            '!!document.querySelector(\'button[aria-label="보관한 영상 30 상세보기"]\')'
        ),
        false
    )
    assert.equal(
        await evaluate("document.querySelector('aside[aria-labelledby] h3').textContent"),
        '보관한 영상 1'
    )
    await click('즐겨찾기')
    await click('보관한 영상 1 상세보기')
    await click('보관한 영상 1 즐겨찾기 해제')
    await waitFor('!document.querySelector(\'button[aria-label="보관한 영상 1 상세보기"]\')')
    assert.equal(
        await evaluate("document.querySelector('aside[aria-labelledby] h3').textContent"),
        '보관한 영상 1'
    )
    await click('갤러리')
    await click('보관한 영상 1 즐겨찾기 추가')
    await waitFor(
        '!!document.querySelector(\'button[aria-label="보관한 영상 1 즐겨찾기 해제"]:not(:disabled)\')'
    )
    await click('보관한 영상 1 상세보기')
    await evaluate(
        'document.querySelector(\'input[aria-label="다운로드할 URL"]\').focus(); document.querySelector(\'input[aria-label="다운로드할 URL"]\').click(); true'
    )
    assert.equal(await evaluate("!!document.querySelector('aside[aria-labelledby]')"), false)
    assert.equal(
        await evaluate("document.activeElement.getAttribute('aria-label')"),
        '다운로드할 URL'
    )
    await click('다운로드')
    await waitFor('!!document.querySelector(\'[aria-label="다운로드 작업 목록"]\')')
    await click('상세보기')
    await waitFor('!!document.querySelector(\'[aria-label="선택한 다운로드 작업"]\')')
    await screenshot('downloads-detail-wide')
    assert.equal(
        await evaluate('!!document.querySelector(\'input[aria-label="다운로드할 URL"]\')'),
        true
    )
    await click('취소 요청')
    assert.equal(
        await evaluate("window.fixtureProbe.calls().filter(c => c.kind === 'cancel').length"),
        1
    )
    assert.equal(await evaluate("!!document.querySelector('aside[aria-labelledby]')"), false)
    await click('상세보기')
    await waitFor('!!document.querySelector(\'[aria-label="선택한 다운로드 작업"]\')')
    window.setSize(900, 850)
    await waitFor('!!document.querySelector(\'[role="dialog"]\')')
    assert.equal(await evaluate("!!document.querySelector('main [inert]')"), true)
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    await evaluate('document.querySelector(\'input[aria-label="다운로드할 URL"]\').focus(); true')
    assert.equal(
        await evaluate("document.activeElement.getAttribute('aria-label')"),
        '다운로드할 URL'
    )
    await screenshot('downloads-detail-narrow')
    await evaluate(
        'document.querySelector(\'aside[role="dialog"]\').previousElementSibling.click(); true'
    )
    assert.equal(await evaluate("!!document.querySelector('aside[aria-labelledby]')"), false)
    await click('상세보기')
    await waitFor('!!document.querySelector(\'[role="dialog"]\')')
    window.setSize(580, 850)
    await pause(100)
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth'), false)
    assert.equal(
        await evaluate(
            "document.querySelector('aside[role=\"dialog\"]').getBoundingClientRect().width === document.querySelector('main').getBoundingClientRect().width"
        ),
        true
    )
    window.setSize(900, 850)
    await pause(100)
    await evaluate(
        "document.querySelector('button[aria-label=\"다운로드 상세 닫기\"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))"
    )
    await waitFor('!document.querySelector(\'[role="dialog"]\')')
    await click('갤러리')
    await input('input[aria-label="다운로드할 URL"]', 'https://youtu.be/new-fixture')
    await evaluate("document.querySelector('form').requestSubmit()")
    await pause(100)
    assert.equal(await evaluate("document.querySelector('main h1').textContent"), '갤러리')
    assert.equal(
        await evaluate("window.fixtureProbe.calls().filter(c => c.kind === 'enqueue').length"),
        1
    )
    assert.deepEqual(errors, [])
    console.log(
        JSON.stringify(
            {
                status: 'passed',
                checks: [
                    'common-input',
                    'gallery-only-media',
                    'footer-icon-order',
                    'filled-and-empty-star',
                    'immediate-card-selection',
                    'same-card-keeps-detail',
                    'no-double-click-folder',
                    'wide-panel-400',
                    'independent-scroll',
                    'favorite-toggle-api',
                    'favorite-no-success-notice',
                    'favorite-keeps-detail',
                    'menu-keyboard',
                    'menu-escape-keeps-detail',
                    'draft-favorite-disabled',
                    'folder-icon-only',
                    'folder-keeps-draft',
                    'tag-edit-focus',
                    'title-edit-focus',
                    'edit-focus-keeps-draft',
                    'outside-draft-rejection',
                    'single-menu-confirm',
                    'registration-rejection',
                    'registration-confirmation',
                    'unregister-keeps-other-detail',
                    'favorites-view-update',
                    'input-click-close-focus',
                    'download-details',
                    'cancel-request',
                    'narrow-overlay',
                    'overlay-input-access',
                    'very-narrow-full-panel',
                    'no-horizontal-overflow',
                    'overlay-backdrop-close',
                    'escape-close',
                    'download-from-gallery'
                ],
                screenshots: output,
                profile
            },
            null,
            2
        )
    )
    window.destroy()
    app.exit(0)
}
run().catch((error) => {
    console.error(error)
    console.error(errors)
    if (window && !window.isDestroyed()) window.destroy()
    app.exit(1)
})
