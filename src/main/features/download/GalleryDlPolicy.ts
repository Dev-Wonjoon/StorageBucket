import { extname } from 'node:path'
import type { DownloadJobOptions, DownloadTargetInput } from './DownloadRepository'
import type { GalleryDlDiscoveryPolicy, GalleryDlFile } from './GalleryDlAdapter'
import { galleryDlProfiles, type GalleryDlProfile } from './GalleryDlProfiles'

type Row = Readonly<Record<string, unknown>>

function identifier(value: unknown): string | undefined {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
        return String(value)
    }

    if (typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)) {
        return value
    }

    return undefined
}

function isOne(value: unknown): boolean {
    return value === 1 || value === '1'
}

function field(value: unknown, path: string): unknown {
    let current = value

    for (const segment of path.split('.')) {
        if (
            !current ||
            typeof current !== 'object' ||
            Array.isArray(current) ||
            !Object.hasOwn(current, segment)
        ) {
            return undefined
        }

        current = (current as Record<string, unknown>)[segment]
    }

    return current
}

function acceptsOptions(options: Readonly<DownloadJobOptions>): boolean {
    return (
        options.type !== 'audio' &&
        options.playlist !== true &&
        (options.quality === undefined || options.quality === 'best') &&
        options.extension === undefined
    )
}

function parseRequest(value: string) {
    try {
        if (/[\u0000-\u0020\u007f]/.test(value)) return

        const url = new URL(value)

        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) {
            return
        }

        for (const profile of galleryDlProfiles) {
            if (!profile.hosts.includes(url.hostname)) continue

            const match = profile.pathname.exec(url.pathname)

            if (!match) continue

            for (const key of url.searchParams.keys()) {
                if (!profile.trackingParameters.includes(key)) {
                    return
                }
            }

            const requestId = match[profile.requestIdGroup]

            if (!requestId) return

            return { profile, requestId }
        }
    } catch {
        return
    }

    return undefined
}

function resultKind(profile: GalleryDlProfile, metadata: Row): 'image' | 'video' | undefined {
    const value = field(metadata, profile.completeness.typeField)

    if (typeof value !== 'string' || !Object.hasOwn(profile.completeness.singleTypes, value)) {
        return
    }

    return profile.completeness.singleTypes[value]
}

function matchesKind(file: GalleryDlFile, kind: 'image' | 'video'): boolean {
    try {
        const url = new URL(file.url)

        if (url.protocol !== 'https:' || url.username || url.password || url.port) {
            return false
        }

        const extension = extname(url.pathname).slice(1).toLowerCase()

        if (kind === 'video') {
            return extension === 'mp4'
        }

        return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(extension)
    } catch {
        return false
    }
}

export function createMappedGalleryDlPolicy(
    originalUrl: string
): GalleryDlDiscoveryPolicy | undefined {
    const expected = parseRequest(originalUrl)

    if (!expected) return

    const { profile, requestId } = expected

    function matchesMetadata(metadata: Row): boolean {
        return (
            metadata.category === profile.category &&
            typeof metadata.subcategory === 'string' &&
            profile.subcategories.includes(metadata.subcategory) &&
            field(metadata, profile.fields.requestId) === requestId
        )
    }

    return {
        discoveryOptions: profile.discoveryOptions,
        rejectDiscoveryDiagnostics: true,

        accepts: (url, options) => {
            const actual = parseRequest(url)

            return (
                actual?.profile.id === profile.id &&
                actual.requestId === requestId &&
                acceptsOptions(options)
            )
        },

        identify: (messages, files) => {
            // 현재는 단일 미디어임을 확인할 수 있는 출력만 처리한다.
            if (files.length !== 1) return

            const directories = messages.filter(
                (message): message is unknown[] =>
                    Array.isArray(message) && message[0] === 2 && message.length === 2
            )

            if (directories.length !== 1) return

            const value = directories[0][1]

            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                return
            }

            const directory = value as Row
            const file = files[0]
            const metadata = file.metadata

            if (!matchesMetadata(directory) || !matchesMetadata(metadata)) {
                return
            }

            const kind = resultKind(profile, directory)

            // count가 아니라 원데이터의 유형으로 단일 여부를 판정한다.
            if (
                !kind ||
                resultKind(profile, metadata) !== kind ||
                !isOne(field(directory, profile.fields.count)) ||
                !isOne(field(metadata, profile.fields.count)) ||
                !matchesKind(file, kind)
            ) {
                return
            }

            const postId = identifier(field(directory, profile.fields.postId))

            const filePostId = identifier(field(metadata, profile.fields.postId))

            const fileId = identifier(field(metadata, profile.fields.fileId))

            if (
                !postId ||
                filePostId !== postId ||
                !fileId ||
                (profile.completeness.fileIdEqualsPostId && fileId !== postId)
            ) {
                return
            }

            const ownerName = field(metadata, profile.fields.ownerName)

            const targets: DownloadTargetInput[] = [
                {
                    targetKey: `${profile.id}:${postId}:${fileId}`,
                    sourceUrl: originalUrl,
                    metadata: {
                        kind,
                        externalId: fileId,
                        platformName: profile.platformName,
                        title: `${profile.platformName} ${requestId}`,
                        ownerId: identifier(field(metadata, profile.fields.ownerId)) ?? null,
                        ownerName: typeof ownerName === 'string' ? ownerName : null
                    }
                }
            ]

            return targets
        }
    }
}
