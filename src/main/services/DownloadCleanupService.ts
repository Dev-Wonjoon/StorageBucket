import { opendir, rmdir, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, resolve, sep, toNamespacedPath } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import {
    DownloadCleanupRepository,
    type DownloadCleanupSnapshot
} from '../repositories/DownloadCleanupRepository'
import {
    DownloadRepositoryError,
    type DownloadFileVerification
} from '../repositories/DownloadRepository'
import {
    downloadStagingDirectory,
    inspectDownloadFile,
    nodeVerificationFileSystem,
    type VerificationFileSystem,
    type VerificationStat
} from './DownloadVerificationService'

export interface CleanupFileSystem extends VerificationFileSystem {
    entries(path: string): Promise<string[]>
    unlink(path: string): Promise<void>
    rmdir(path: string): Promise<void>
}

export const nodeCleanupFileSystem: CleanupFileSystem = {
    ...nodeVerificationFileSystem,
    unlink,
    rmdir,

    async entries(path) {
        const result: string[] = []

        for await (const entry of await opendir(path)) {
            if (result.length >= 10_000) {
                hold('SCAN_LIMIT')
            }

            result.push(entry.name)
        }

        return result
    }
}

type Repository = Pick<
    DownloadCleanupRepository,
    'startAtStartup' | 'references' | 'finish' | 'fail'
>

type Member = {
    path: string
    scope: string
    info: VerificationStat
}

type Group = {
    proof: DownloadFileVerification
    members: Member[]
}

const active = new Set<string>()

function hold(reason: string): never {
    throw new DownloadRepositoryError('CLEANUP_REQUIRED', { reason })
}

function key(path: string) {
    const value = resolve(path)

    return process.platform === 'win32' ? toNamespacedPath(value).toLowerCase() : value
}

function child(parent: string, path: string) {
    const part = relative(parent, path)

    if (
        !isAbsolute(path) ||
        path.includes('\0') ||
        !part ||
        part === '..' ||
        part.startsWith('..' + sep) ||
        isAbsolute(part)
    ) {
        throw new DownloadRepositoryError('UNSAFE_STAGING_PATH')
    }
}

function database<T>(action: () => T): T {
    try {
        return action()
    } catch (error) {
        if (error instanceof DownloadRepositoryError) {
            throw error
        }

        throw new DownloadRepositoryError('DATABASE_ERROR')
    }
}

function proofFor(target: DownloadCleanupSnapshot['targets'][number]) {
    const proof = JSON.parse(target.metadataJson)?.fileVerification as
        (DownloadFileVerification & { version?: number }) | undefined

    if (
        target.state !== 'verified' ||
        !proof ||
        proof.version !== 1 ||
        proof.targetId !== target.id ||
        proof.stagedPath !== target.stagedPath ||
        typeof proof.realPath !== 'string' ||
        !isAbsolute(proof.realPath) ||
        key(proof.realPath) !== key(proof.stagedPath) ||
        typeof proof.ctimeNs !== 'string' ||
        !/^-?\d+$/.test(proof.ctimeNs) ||
        !Number.isSafeInteger(proof.size) ||
        proof.size <= 0 ||
        typeof proof.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(proof.sha256) ||
        typeof proof.device !== 'string' ||
        !/^\d+$/.test(proof.device) ||
        typeof proof.inode !== 'string' ||
        !/^[1-9]\d*$/.test(proof.inode) ||
        typeof proof.mtimeNs !== 'string' ||
        !/^-?\d+$/.test(proof.mtimeNs)
    ) {
        hold('UNVERIFIED_FILE')
    }

    return proof
}

function matches(info: VerificationStat, proof: DownloadFileVerification, links: bigint) {
    if (
        info.kind !== 'file' ||
        info.dev.toString() !== proof.device ||
        info.ino.toString() !== proof.inode ||
        info.size !== BigInt(proof.size) ||
        info.mtimeNs.toString() !== proof.mtimeNs ||
        info.nlink !== links
    ) {
        throw new DownloadRepositoryError('FILE_CHANGED')
    }
}

class Tree {
    private ids = new Map<string, string>()

    constructor(
        private root: string,
        private fs: CleanupFileSystem
    ) {}

    async walk(path: string): Promise<VerificationStat | undefined> {
        if (key(path) !== key(this.root)) {
            child(this.root, path)
        }

        let current = this.root
        const part = relative(this.root, path)
        const parts = part ? part.split(sep) : []

        for (let i = -1; i < parts.length; i++) {
            if (i >= 0) {
                current = join(current, parts[i])
            }

            let info: VerificationStat

            try {
                info = await this.fs.lstat(current)
            } catch (error) {
                if (i >= 0 && (error as { code?: string }).code === 'ENOENT') {
                    return undefined
                }

                throw error
            }

            if (
                info.kind === 'link' ||
                info.ino <= 0n ||
                key(await this.fs.realpath(current)) !== key(current) ||
                (i < parts.length - 1 && info.kind !== 'directory')
            ) {
                throw new DownloadRepositoryError('UNSAFE_STAGING_PATH')
            }

            if (info.kind === 'directory') {
                const identity = info.dev + ':' + info.ino
                const previous = this.ids.get(key(current))

                if (previous !== undefined && previous !== identity) {
                    throw new DownloadRepositoryError('FILE_CHANGED')
                }

                this.ids.set(key(current), identity)
            }

            if (i === parts.length - 1) {
                return info
            }
        }

        return undefined
    }

    async scan(scope: string) {
        const files: Member[] = []
        const directories: string[] = []
        const pending = [scope]

        while (pending.length) {
            const path = pending.pop()!
            const info = await this.walk(path)

            if (!info) continue

            if (info.kind === 'file') {
                files.push({ path, scope, info })
            } else if (info.kind === 'directory') {
                directories.push(path)

                for (const name of await this.fs.entries(path)) {
                    if (basename(name) !== name || name === '.' || name === '..') {
                        hold('UNEXPECTED_ENTRY')
                    }

                    pending.push(join(path, name))
                }
            } else {
                hold('UNEXPECTED_ENTRY')
            }

            if (files.length + directories.length + pending.length > 10_000) {
                hold('SCAN_LIMIT')
            }
        }

        return { files, directories }
    }
}

export class DownloadCleanupService {
    private root: string

    constructor(
        private repository: Repository,
        storageRoot: string,
        private fs: CleanupFileSystem = nodeCleanupFileSystem
    ) {
        if (!isAbsolute(storageRoot) || storageRoot.includes('\0')) {
            throw new DownloadRepositoryError('INVALID_ARGUMENT')
        }

        this.root = resolve(storageRoot)
    }

    // 외부 프로세스·다운로드·미디어 편집이 멈춘 앱 시작 단계에서만 호출한다.
    async runAtStartup(taskId: string) {
        const owner = JSON.stringify([key(this.root), taskId])

        if (active.has(owner)) {
            throw new DownloadRepositoryError('ALREADY_PROCESSING')
        }

        active.add(owner)

        let snapshot: DownloadCleanupSnapshot | null = null
        let finishing = false

        try {
            snapshot = database(() => this.repository.startAtStartup(taskId))

            if (!snapshot) {
                return {
                    taskId,
                    alreadyCompleted: true
                }
            }

            const expectedStaging = downloadStagingDirectory(
                this.root,
                snapshot.job.id,
                snapshot.attempt.id
            )

            if (
                snapshot.stagingDirectory !== expectedStaging ||
                snapshot.finalDirectory !==
                    join(this.root, '.storagebucket', 'files', basename(expectedStaging))
            ) {
                throw new DownloadRepositoryError('UNSAFE_STAGING_PATH')
            }

            const tree = new Tree(this.root, this.fs)

            child(this.root, snapshot.stagingDirectory)
            child(this.root, snapshot.finalDirectory)

            const scanned = [
                await tree.scan(snapshot.stagingDirectory),
                await tree.scan(snapshot.finalDirectory)
            ]

            const byPath = new Map<string, DownloadCleanupSnapshot['targets'][number]>()

            for (const target of snapshot.targets) {
                for (const [path, scope] of [
                    [target.stagedPath, snapshot.stagingDirectory],
                    [target.finalPath, snapshot.finalDirectory]
                ] as const) {
                    if (path === null) continue

                    child(scope, path)

                    if (byPath.has(key(path))) {
                        hold('DUPLICATE_PATH')
                    }

                    byPath.set(key(path), target)
                }
            }

            const groups = new Map<string, Group>()

            for (const member of scanned.flatMap((scan) => scan.files)) {
                const target = byPath.get(key(member.path))

                if (!target) {
                    hold('UNEXPECTED_ENTRY')
                }

                const proof = proofFor(target)
                const previous = groups.get(target.id)

                if (previous) {
                    previous.members.push(member)
                } else {
                    groups.set(target.id, {
                        proof,
                        members: [member]
                    })
                }
            }

            const identities = new Set<string>()

            for (const group of groups.values()) {
                const identity = group.proof.device + ':' + group.proof.inode

                if (identities.has(identity)) {
                    hold('DUPLICATE_IDENTITY')
                }

                identities.add(identity)

                if (group.members.length > 2) {
                    hold('UNEXPECTED_LINK')
                }

                for (const member of group.members) {
                    matches(member.info, group.proof, BigInt(group.members.length))
                }
            }

            // 예상 밖 파일과 추가 하드 링크를 확인한 뒤 삭제를 시작한다.
            for (const group of groups.values()) {
                for (let index = 0; index < group.members.length; index++) {
                    const member = group.members[index]

                    const links = BigInt(group.members.length - index) as 1n | 2n

                    const actual = await inspectDownloadFile(
                        this.root,
                        member.scope,
                        member.path,
                        this.fs,
                        undefined,
                        links
                    )

                    if (
                        actual.sha256 !== group.proof.sha256 ||
                        actual.device !== group.proof.device ||
                        actual.inode !== group.proof.inode ||
                        actual.size !== group.proof.size ||
                        actual.mtimeNs !== group.proof.mtimeNs
                    ) {
                        throw new DownloadRepositoryError('FILE_CHANGED')
                    }

                    const refs = database(() => this.repository.references(snapshot!))

                    await this.protect(refs, member.path, member.info)

                    const current = await tree.walk(member.path)

                    if (!current) {
                        throw new DownloadRepositoryError('FILE_CHANGED')
                    }

                    matches(current, group.proof, links)

                    if (
                        current.ctimeNs.toString() !== actual.ctimeNs ||
                        !isDeepStrictEqual(
                            database(() => this.repository.references(snapshot!)),
                            refs
                        )
                    ) {
                        throw new DownloadRepositoryError('VERIFICATION_CHANGED')
                    }

                    await this.fs.unlink(member.path)
                }
            }

            const directories = scanned
                .flatMap((scan) => scan.directories)
                .sort((a, b) => b.length - a.length)

            for (const path of directories) {
                const info = await tree.walk(path)

                if (!info) continue

                if (info.kind !== 'directory') {
                    throw new DownloadRepositoryError('FILE_CHANGED')
                }

                const refs = database(() => this.repository.references(snapshot!))

                await this.protect(refs, path, info)

                if (
                    !isDeepStrictEqual(
                        database(() => this.repository.references(snapshot!)),
                        refs
                    )
                ) {
                    throw new DownloadRepositoryError('VERIFICATION_CHANGED')
                }

                await tree.walk(path)

                // 재귀 삭제하지 않는다.
                // 새 파일이 생기면 rmdir가 실패하며 파일은 남는다.
                await this.fs.rmdir(path)
            }

            finishing = true

            try {
                database(() => this.repository.finish(snapshot!))
            } catch {
                throw new DownloadRepositoryError('COMMIT_STATE_UNKNOWN')
            }

            return {
                taskId,
                alreadyCompleted: false
            }
        } catch (error) {
            const failure =
                error instanceof DownloadRepositoryError
                    ? error
                    : new DownloadRepositoryError('FILE_IO_ERROR')

            if (snapshot && !finishing) {
                try {
                    database(() => this.repository.fail(snapshot!, failure.code))
                } catch {
                    // DB 상태가 바뀌어도 cleanupRequired를 임의로 해제하지 않는다.
                }
            }

            throw failure
        } finally {
            active.delete(owner)
        }
    }

    private async protect(refs: string[], path: string, info: VerificationStat) {
        for (const ref of refs) {
            if (!isAbsolute(ref) || ref.includes('\0')) {
                hold('INVALID_REFERENCE')
            }

            const part = relative(path, ref)

            if (
                key(ref) === key(path) ||
                (info.kind === 'directory' &&
                    part &&
                    part !== '..' &&
                    !part.startsWith('..' + sep) &&
                    !isAbsolute(part))
            ) {
                hold('REFERENCED_FILE')
            }

            try {
                const canonical = await this.fs.realpath(ref)
                const target = await this.fs.lstat(canonical)

                if (
                    key(canonical) === key(path) ||
                    (target.dev === info.dev && target.ino === info.ino)
                ) {
                    hold('REFERENCED_FILE')
                }
            } catch (error) {
                const code = (error as { code?: string }).code

                if (code !== 'ENOENT' && code !== 'ENOTDIR') {
                    throw error
                }
            }
        }
    }
}
