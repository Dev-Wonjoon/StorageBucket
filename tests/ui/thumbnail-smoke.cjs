/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { requireTestWorkspace, testPath } = require('../helpers/test-workspace.cjs')

if (!app || !nativeImage) {
    throw new Error('Electron 실행 파일로 실행해 주세요.')
}

const temporary = requireTestWorkspace()

for (const name of ['userData', 'sessionData', 'logs', 'crashDumps', 'temp']) {
    const directory = testPath(temporary, name)

    fs.mkdirSync(directory, { recursive: true })
    app.setPath(name, directory)
}

app.commandLine.appendSwitch('disable-gpu')

const compiledDirectory = testPath(temporary, 'compiled')
const outputDirectory = testPath(temporary, 'output')

fs.mkdirSync(compiledDirectory)
fs.mkdirSync(outputDirectory)

fs.writeFileSync(path.join(compiledDirectory, 'package.json'), JSON.stringify({ type: 'commonjs' }))

// 앱 전체 대신 이미지 변환·캐시 서비스 두 파일만 불러온다.
for (const name of ['ThumbnailImageService', 'DownloadPreviewService']) {
    const sourceFile = path.resolve(__dirname, `../../src/main/services/${name}.ts`)

    const compiled = ts.transpileModule(fs.readFileSync(sourceFile, 'utf8'), {
        fileName: sourceFile,
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true
        }
    })

    fs.writeFileSync(path.join(compiledDirectory, `${name}.js`), compiled.outputText)
}

function makeImage(width, height) {
    const bitmap = Buffer.alloc(width * height * 4)

    for (let offset = 0; offset < bitmap.length; offset += 4) {
        bitmap.writeUInt32LE(0xff4488cc, offset)
    }

    return nativeImage.createFromBitmap(bitmap, {
        width,
        height,
        scaleFactor: 1
    })
}

async function run() {
    await app.whenReady()

    const { createThumbnailJpeg, inspectThumbnailJpeg } = require(
        path.join(compiledDirectory, 'ThumbnailImageService.js')
    )

    const { DownloadPreviewService } = require(
        path.join(compiledDirectory, 'DownloadPreviewService.js')
    )

    const cases = [
        ['landscape', 1600, 900, 480, 270],
        ['portrait', 900, 1600, 270, 480],
        ['small', 320, 180, 320, 180]
    ]

    for (const [name, width, height, expectedWidth, expectedHeight] of cases) {
        // 원본 PNG는 메모리에만 만들고 축소 JPG만 저장한다.
        const original = makeImage(width, height).toPNG()
        const result = createThumbnailJpeg(original)

        assert.deepEqual([result.width, result.height], [expectedWidth, expectedHeight])

        assert.deepEqual(inspectThumbnailJpeg(result.buffer), {
            width: expectedWidth,
            height: expectedHeight
        })

        fs.writeFileSync(path.join(outputDirectory, `${name}.jpg`), result.buffer, { flag: 'wx' })
    }

    assert.throws(
        () => createThumbnailJpeg(Buffer.from('이미지가 아닌 데이터')),
        /THUMBNAIL_DECODE_FAILED/
    )

    const videoId = 'jNQXAC9IVRw'
    const url = `https://www.youtube.com/watch?v=${videoId}`
    const cacheDirectory = testPath(temporary, 'preview-cache')
    const original = makeImage(1600, 900).toPNG()

    let requests = 0

    // 실제 인터넷 연결 없이 합성 PNG 응답을 제공한다.
    const previews = new DownloadPreviewService(cacheDirectory, async () => {
        requests++

        return new Response(original, {
            headers: { 'content-type': 'image/png' }
        })
    })

    const [first, second] = await Promise.all([
        previews.get(url),
        previews.get(`https://youtu.be/${videoId}`)
    ])

    assert.ok(first)
    assert.equal(first, second)
    assert.equal(requests, 1)

    const saved = fs.readFileSync(first)

    assert.deepEqual(inspectThumbnailJpeg(saved), { width: 480, height: 270 })

    assert.deepEqual(
        fs.readdirSync(cacheDirectory).sort(),
        [path.basename(first), `${videoId}.preview.json`].sort()
    )

    // 오래된 로컬 파일도 온라인 재조회 없이 재사용해야 한다.
    const oldDate = new Date('2000-01-01T00:00:00Z')
    fs.utimesSync(first, oldDate, oldDate)

    let unexpectedRequests = 0

    const offline = new DownloadPreviewService(cacheDirectory, async () => {
        unexpectedRequests++
        throw new Error('NETWORK_MUST_NOT_BE_USED')
    })

    assert.equal(await offline.get(url), first)
    assert.equal(unexpectedRequests, 0)

    // 손상된 파일은 보존하고 새 JPG를 생성해야 한다.
    const damaged = Buffer.from('손상된 JPG 테스트 데이터')

    testPath(temporary, first)
    fs.writeFileSync(first, damaged)

    const repaired = await previews.get(url)

    assert.ok(repaired)
    assert.notEqual(repaired, first)
    assert.equal(requests, 2)

    assert.deepEqual(inspectThumbnailJpeg(fs.readFileSync(repaired)), { width: 480, height: 270 })

    assert.deepEqual(fs.readFileSync(first), damaged)

    // 새 인스턴스도 복구된 로컬 JPG를 온라인 조회 없이 사용한다.
    assert.equal(await offline.get(url), repaired)
    assert.equal(unexpectedRequests, 0)

    // 현재 JPG가 없어지면 새 파일을 생성해야 한다.
    testPath(temporary, repaired)
    fs.unlinkSync(repaired)

    const restored = await previews.get(url)

    assert.ok(restored)
    assert.notEqual(restored, repaired)
    assert.equal(requests, 3)

    assert.deepEqual(inspectThumbnailJpeg(fs.readFileSync(restored)), { width: 480, height: 270 })

    assert.equal(await offline.get(url), restored)
    assert.equal(unexpectedRequests, 0)

    console.log(
        JSON.stringify(
            {
                ok: true,
                outputDirectory,
                cachedFile: restored,
                jpegBytes: saved.length,
                requests,
                unexpectedRequests
            },
            null,
            2
        )
    )

    app.exit(0)
}

run().catch((error) => {
    console.error(error)
    app.exit(1)
})
