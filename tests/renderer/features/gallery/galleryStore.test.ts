import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import type { MediaApi } from '../../../../src/shared/media-api'
import type {
    MediaDetailDto,
    MediaFileDto,
    MediaResult,
    MediaSummaryDto
} from '../../../../src/shared/media-v2'
import { createGalleryStore } from '../../../../src/renderer/src/features/gallery/galleryStore'

const ok = <T>(data: T): MediaResult<T> => ({ ok: true, data })

const fail = (
    code: 'NOT_READY' | 'REVISION_CONFLICT' | 'JOB_ACTIVE' | 'INTERNAL_ERROR'
): MediaResult<never> => ({
    ok: false,
    error: {
        code,
        message: code,
        context: {}
    }
})

function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: unknown) => void

    const promise = new Promise<T>((yes, no) => {
        resolve = yes
        reject = no
    })

    return { promise, resolve, reject }
}

function summary(id = 1, revision = 0): MediaSummaryDto {
    return {
        id,
        revision,
        sourceKind: 'legacy',
        requestUrl: null,
        sourceTitle: '원본',
        customTitle: null,
        title: '원본',
        coverMode: 'auto',
        cover: null,
        fileCount: 1,
        isFavorite: false,
        createdAt: 1000,
        updatedAt: null
    }
}

function file(id: number): MediaFileDto {
    return {
        id,
        mediaId: 1,
        fileKey: 'file-' + id,
        storageKind: 'unverified_legacy',
        sourceUrl: null,
        title: null,
        filepath: 'C:/fixture/' + id,
        relativePath: null,
        kind: 'unknown',
        position: id - 1,
        filesize: null,
        duration: null,
        detectedFormat: null,
        width: null,
        height: null,
        orientation: null,
        frameCount: null,
        pageCount: null,
        primaryImageIndex: null,
        thumbnailPath: null,
        thumbnailOrigin: 'none',
        previewPath: null,
        createdAt: 1000
    }
}

function detail(id = 1, revision = 0, offset = 0, total = 1): MediaDetailDto {
    return {
        ...summary(id, revision),
        fileCount: total,
        files: {
            data:
                offset < total
                    ? [
                          {
                              ...file(offset + 1),
                              mediaId: id
                          }
                      ]
                    : [],
            total,
            hasNextPage: offset + 1 < total
        },
        tags: [],
        favorite: null,
        localFolder: null,
        locations: []
    }
}

function fixture(overrides: Partial<MediaApi> = {}) {
    const calls = {
        list: [] as number[],
        get: [] as number[],
        edit: [] as unknown[],
        remove: [] as unknown[],
        removeFiles: [] as unknown[]
    }

    let current = summary()
    let removed = false

    const implementation: MediaApi = {
        suggest: async () => ok([]),
        list: async () =>
            ok({
                data: removed ? [] : [current],
                total: removed ? 0 : 1,
                hasNextPage: false
            }),

        get: async (request) =>
            ok({
                ...detail(request.mediaId, current.revision),
                ...current
            }),

        edit: async (request) => {
            current = {
                ...current,
                revision: request.expectedRevision + 1,
                customTitle:
                    request.customTitle === undefined ? current.customTitle : request.customTitle,
                title: request.customTitle ?? current.sourceTitle ?? '제목 없음',
                isFavorite: request.isFavorite ?? current.isFavorite
            }

            return ok(current)
        },

        unregisterMedia: async (request) => {
            removed = true
            return ok({
                mediaId: request.mediaId,
                parentRemoved: true,
                revision: null,
                cleanupTaskId: null
            })
        },

        unregisterFiles: async (request) => {
            removed = true
            return ok({
                mediaId: request.mediaId,
                parentRemoved: true,
                revision: null,
                cleanupTaskId: null
            })
        },

        ...overrides
    }

    const api: MediaApi = {
        suggest: (request) => implementation.suggest(request),
        list: (request) => {
            calls.list.push(request?.offset ?? 0)
            return implementation.list(request)
        },

        get: (request) => {
            calls.get.push(request.fileOffset ?? 0)
            return implementation.get(request)
        },

        edit: (request) => {
            calls.edit.push(structuredClone(request))
            return implementation.edit(request)
        },

        unregisterMedia: (request) => {
            calls.remove.push(request)
            return implementation.unregisterMedia(request)
        },

        unregisterFiles: (request) => {
            calls.removeFiles.push(request)
            return implementation.unregisterFiles(request)
        }
    }

    return {
        store: createGalleryStore(api),
        calls
    }
}

describe('gallery store', () => {
    it('NOT_READY를 빈 라이브러리와 구분한다', async () => {
        const { store } = fixture({
            list: async () => fail('NOT_READY')
        })

        assert.equal(await store.refresh(), false)
        assert.equal(store.getSnapshot().list.status, 'not_ready')
        assert.equal(store.getSnapshot().list.error!.code, 'NOT_READY')

        const empty = fixture({
            list: async () =>
                ok({
                    data: [],
                    total: 0,
                    hasNextPage: false
                })
        })

        assert.equal(await empty.store.refresh(), true)
        assert.equal(empty.store.getSnapshot().list.status, 'ready')
        assert.equal(empty.store.getSnapshot().list.page.total, 0)
    })

    it('목록의 늦은 응답이 새 페이지를 덮어쓰지 않는다', async () => {
        const old = deferred<Awaited<ReturnType<MediaApi['list']>>>()

        const { store } = fixture({
            list: (request) =>
                request?.offset === 0
                    ? old.promise
                    : Promise.resolve(
                          ok({
                              data: [summary(2)],
                              total: 51,
                              hasNextPage: false
                          })
                      )
        })

        const first = store.loadList(0)
        await store.loadList(50)

        old.resolve(
            ok({
                data: [summary(1)],
                total: 51,
                hasNextPage: true
            })
        )

        assert.equal(await first, false)
        assert.equal(store.getSnapshot().list.offset, 50)
        assert.equal(store.getSnapshot().list.page.data[0].id, 2)
    })

    it('조회 취소 후 도착한 응답을 반영하지 않는다', async () => {
        const pending = deferred<Awaited<ReturnType<MediaApi['list']>>>()

        const { store } = fixture({
            list: () => pending.promise
        })

        const load = store.refresh()
        store.cancelReads()

        pending.resolve(
            ok({
                data: [summary()],
                total: 1,
                hasNextPage: false
            })
        )

        assert.equal(await load, false)
        assert.equal(store.getSnapshot().list.page.total, 0)
    })

    it('다른 묶음을 열면 이전 상세 응답을 무시한다', async () => {
        const old = deferred<Awaited<ReturnType<MediaApi['get']>>>()

        const { store } = fixture({
            get: (request) => (request.mediaId === 1 ? old.promise : Promise.resolve(ok(detail(2))))
        })

        const first = store.openDetail(1)
        await store.openDetail(2)

        old.resolve(ok(detail(1)))

        assert.equal(await first, false)
        assert.equal(store.getSnapshot().detail.data!.id, 2)
    })

    it('닫은 상세를 늦은 응답이 다시 열지 않는다', async () => {
        const pending = deferred<Awaited<ReturnType<MediaApi['get']>>>()

        const { store } = fixture({
            get: () => pending.promise
        })

        const load = store.openDetail(1)
        store.closeDetail()
        pending.resolve(ok(detail()))

        await load

        assert.equal(store.getSnapshot().detail.mediaId, null)
        assert.equal(store.getSnapshot().detail.data, null)
    })

    it('연속 저장을 막고 사용자가 본 revision을 그대로 보낸다', async () => {
        const pending = deferred<Awaited<ReturnType<MediaApi['edit']>>>()

        const { store, calls } = fixture({
            edit: () => pending.promise
        })

        await store.openDetail(1)

        const input = {
            mediaId: 1,
            expectedRevision: 0,
            customTitle: '작성'
        }

        const first = store.edit(input)

        assert.equal(await store.edit(input), false)
        assert.deepEqual(calls.edit, [input])

        pending.resolve(
            ok({
                ...summary(1, 1),
                title: '작성',
                customTitle: '작성'
            })
        )

        assert.equal(await first, true)
        assert.equal(store.getSnapshot().busy, false)
    })

    it('revision 충돌 시 초안의 기반 상세를 유지하고 자동 재시도하지 않는다', async () => {
        const { store, calls } = fixture({
            edit: async () => fail('REVISION_CONFLICT')
        })

        await store.openDetail(1)

        const before = store.getSnapshot().detail.data
        const reads = calls.get.length

        const input = {
            mediaId: 1,
            expectedRevision: 0,
            customTitle: '작성'
        }

        assert.equal(await store.edit(input), false)
        assert.equal(store.getSnapshot().needsRefresh, true)
        assert.equal(store.getSnapshot().writeError!.code, 'REVISION_CONFLICT')
        assert.deepEqual(store.getSnapshot().detail.data, before)
        assert.equal(calls.get.length, reads)

        assert.equal(await store.edit(input), false)
        assert.equal(calls.edit.length, 1)

        await store.refresh()

        assert.equal(store.getSnapshot().needsRefresh, false)
    })

    it('통신 실패는 커밋 여부 미확인으로 다루고 재전송 전에 조회를 요구한다', async () => {
        const { store, calls } = fixture({
            edit: async () => {
                throw new Error('response lost')
            },
            get: async () => ok(detail(1, 1))
        })

        await store.openDetail(1)

        const input = {
            mediaId: 1,
            expectedRevision: 1,
            customTitle: '작성'
        }

        assert.equal(await store.edit(input), false)
        assert.equal(store.getSnapshot().writeError!.code, 'TRANSPORT_ERROR')
        assert.equal(store.getSnapshot().needsRefresh, true)

        assert.equal(await store.edit(input), false)
        assert.equal(calls.edit.length, 1)

        await store.refresh()

        assert.equal(store.getSnapshot().needsRefresh, false)
        assert.equal(store.getSnapshot().detail.data!.revision, 1)
    })

    it('변경 성공 후 조회 실패를 변경 실패로 뒤집지 않는다', async () => {
        let broken = false

        const { store } = fixture({
            edit: async () => {
                broken = true
                return ok(summary(1, 1))
            },
            list: async () =>
                broken
                    ? fail('INTERNAL_ERROR')
                    : ok({
                          data: [summary()],
                          total: 1,
                          hasNextPage: false
                      }),
            get: async () => (broken ? fail('INTERNAL_ERROR') : ok(detail()))
        })

        await store.refresh()
        await store.openDetail(1)

        assert.equal(
            await store.edit({
                mediaId: 1,
                expectedRevision: 0,
                customTitle: '저장'
            }),
            true
        )

        assert.equal(store.getSnapshot().needsRefresh, true)
        assert.match(store.getSnapshot().notice!, /변경은 반영/)
        assert.equal(store.getSnapshot().detail.data, null)
        assert.equal(store.getSnapshot().list.page.data[0].revision, 1)
    })

    it('삭제 전 목록 응답이 제거된 부모를 복원하지 않는다', async () => {
        const old = deferred<Awaited<ReturnType<MediaApi['list']>>>()

        let reads = 0

        const { store } = fixture({
            list: async () => {
                reads++
                if (reads === 2) return old.promise

                return ok({
                    data: reads === 1 ? [summary()] : [],
                    total: reads === 1 ? 1 : 0,
                    hasNextPage: false
                })
            }
        })

        await store.refresh()
        await store.openDetail(1)

        const stale = store.refresh()

        await store.unregisterMedia({
            mediaId: 1,
            expectedRevision: 0
        })

        old.resolve(
            ok({
                data: [summary()],
                total: 1,
                hasNextPage: false
            })
        )

        await stale

        assert.equal(store.getSnapshot().list.page.total, 0)
        assert.equal(store.getSnapshot().detail.mediaId, null)
    })

    it('마지막 자식 제거 후 조회가 실패해도 닫힌 부모를 복원하지 않는다', async () => {
        let deleted = false

        const { store } = fixture({
            list: async () =>
                deleted
                    ? fail('INTERNAL_ERROR')
                    : ok({
                          data: [summary()],
                          total: 1,
                          hasNextPage: false
                      }),

            unregisterFiles: async () => {
                deleted = true

                return ok({
                    mediaId: 1,
                    parentRemoved: true,
                    revision: null,
                    cleanupTaskId: null
                })
            }
        })

        await store.refresh()
        await store.openDetail(1)

        assert.equal(
            await store.unregisterFiles({
                mediaId: 1,
                expectedRevision: 0,
                fileIds: [1]
            }),
            true
        )
        assert.equal(store.getSnapshot().detail.mediaId, null)
        assert.deepEqual(store.getSnapshot().list.page.data, [])
    })

    it('일부 자식 제거로 마지막 페이지가 비면 앞 페이지로 이동한다', async () => {
        let deleted = false

        const { store, calls } = fixture({
            get: async (request) =>
                ok(detail(1, deleted ? 1 : 0, request.fileOffset ?? 0, deleted ? 50 : 51)),

            unregisterFiles: async () => {
                deleted = true

                return ok({
                    mediaId: 1,
                    parentRemoved: false,
                    revision: 1,
                    cleanupTaskId: null
                })
            }
        })

        await store.openDetail(1)
        await store.loadDetail(50)

        assert.equal(
            await store.unregisterFiles({
                mediaId: 1,
                expectedRevision: 0,
                fileIds: [51]
            }),
            true
        )

        assert.equal(store.getSnapshot().detail.offset, 0)
        assert.deepEqual(calls.get, [0, 50, 50, 0])
        assert.equal(store.getSnapshot().detail.data!.revision, 1)
    })

    it('실행 중 작업 오류를 표시하고 자동 재시도하지 않는다', async () => {
        const { store, calls } = fixture({
            unregisterMedia: async () => fail('JOB_ACTIVE')
        })

        await store.openDetail(1)

        assert.equal(
            await store.unregisterMedia({
                mediaId: 1,
                expectedRevision: 0
            }),
            false
        )
        assert.equal(store.getSnapshot().writeError!.code, 'JOB_ACTIVE')
        assert.equal(store.getSnapshot().needsRefresh, false)
        assert.equal(store.getSnapshot().detail.data!.id, 1)
        assert.equal(calls.remove.length, 1)
    })

    describe('gallery search filters', () => {
        it('검색 조건을 복사해 전달하고 새 조건은 첫 페이지부터 조회한다', async () => {
            const requests: unknown[] = []

            const { store } = fixture({
                list: async (request) => {
                    requests.push(structuredClone(request))

                    return ok({
                        data: [summary()],
                        total: 100,
                        hasNextPage: true
                    })
                }
            })

            await store.loadList(50)

            const filter = {
                tags: ['red'],
                keyword: 'first'
            }

            store.setFilter(filter)
            filter.tags.push('blue')

            assert.equal(store.getSnapshot().list.offset, 0)

            assert.deepEqual(store.getSnapshot().list.page.data, [])

            await store.refresh()

            assert.deepEqual(requests[1], {
                limit: 50,
                offset: 0,
                favoritesOnly: false,
                filter: {
                    tags: ['red'],
                    keyword: 'first'
                }
            })
        })

        it('이전 검색의 늦은 응답이 새 검색을 덮어쓰지 않는다', async () => {
            const old = deferred<Awaited<ReturnType<MediaApi['list']>>>()

            const { store } = fixture({
                list: async (request) =>
                    request?.filter?.keyword === 'old'
                        ? old.promise
                        : ok({
                              data: [summary(2)],
                              total: 1,
                              hasNextPage: false
                          })
            })

            store.setFilter({ keyword: 'old' })
            const first = store.refresh()

            store.setFilter({ keyword: 'new' })
            await store.refresh()

            old.resolve(
                ok({
                    data: [summary(1)],
                    total: 1,
                    hasNextPage: false
                })
            )

            assert.equal(await first, false)

            assert.equal(store.getSnapshot().list.page.data[0].id, 2)
        })

        it('검색 조건 변경 자체는 열려 있는 상세와 충돌 상태를 보존한다', async () => {
            const { store, calls } = fixture({
                edit: async () => fail('REVISION_CONFLICT')
            })

            await store.openDetail(1)

            await store.edit({
                mediaId: 1,
                expectedRevision: 0,
                customTitle: 'draft'
            })

            const before = store.getSnapshot().detail

            store.setFilter({ keyword: 'new' })

            assert.equal(store.getSnapshot().detail, before)

            assert.equal(store.getSnapshot().needsRefresh, true)

            assert.equal(store.getSnapshot().writeError?.code, 'REVISION_CONFLICT')

            assert.equal(calls.edit.length, 1)
        })

        it('저장 중 검색 변경은 저장 결과를 버리지 않고 최신 조건으로 다시 조회한다', async () => {
            const pending = deferred<Awaited<ReturnType<MediaApi['edit']>>>()

            const requests: unknown[] = []
            let committed = false

            const { store, calls } = fixture({
                edit: () => pending.promise,

                get: async () => ok(detail(1, committed ? 1 : 0)),

                list: async (request) => {
                    requests.push(structuredClone(request))

                    return ok({
                        data: [],
                        total: 0,
                        hasNextPage: false
                    })
                }
            })

            await store.openDetail(1)

            const writing = store.edit({
                mediaId: 1,
                expectedRevision: 0,
                customTitle: 'saved'
            })

            store.setFilter({
                keyword: 'latest'
            })

            assert.equal(await store.refresh(), false)

            committed = true

            pending.resolve(
                ok({
                    ...summary(1, 1),
                    customTitle: 'saved',
                    title: 'saved'
                })
            )

            assert.equal(await writing, true)

            assert.equal(store.getSnapshot().busy, false)

            assert.equal(store.getSnapshot().detail.data?.revision, 1)

            assert.equal(calls.edit.length, 1)
            assert.ok(requests.length > 0)

            for (const request of requests) {
                assert.deepEqual(
                    (
                        request as {
                            filter: unknown
                        }
                    ).filter,
                    { keyword: 'latest' }
                )
            }
        })

        it('검색 결과 밖에 남아 있던 상세를 삭제해도 다른 검색의 개수를 빼지 않는다', async () => {
            let deleted = false

            const { store } = fixture({
                list: async () =>
                    deleted
                        ? fail('INTERNAL_ERROR')
                        : ok({
                              data: [summary(2)],
                              total: 1,
                              hasNextPage: false
                          }),

                unregisterMedia: async () => {
                    deleted = true

                    return ok({
                        mediaId: 1,
                        parentRemoved: true,
                        revision: null,
                        cleanupTaskId: null
                    })
                }
            })

            await store.openDetail(1)

            store.setFilter({
                keyword: 'other'
            })

            await store.refresh()

            await store.unregisterMedia({
                mediaId: 1,
                expectedRevision: 0
            })

            assert.equal(store.getSnapshot().list.page.total, 1)

            assert.equal(store.getSnapshot().list.page.data[0].id, 2)

            assert.equal(store.getSnapshot().detail.mediaId, null)

            assert.equal(store.getSnapshot().needsRefresh, true)
        })
    })
})
