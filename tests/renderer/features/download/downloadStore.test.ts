import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import {
  createDownloadStore,
  DOWNLOAD_PAGE_SIZE
} from '../../../../src/renderer/src/features/download/downloadStore'
import type {
  DownloadApi,
  DownloadJobDto,
  DownloadPageDto,
  DownloadResponse,
  DownloadRunDto
} from '../../../../src/shared/download-api'

const ok = <T>(data: T): DownloadResponse<T> => ({
  ok: true,
  data
})

const fail = (
  code: string
): DownloadResponse<never> => ({
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

function job(
  id: string,
  state: DownloadJobDto['state'] = 'pending'
): DownloadJobDto {
  return {
    id,
    url: 'https://example.invalid/' + id,
    title: null,
    state,
    phase: state === 'completed' ? 'finished' : null,
    progress: state === 'completed' ? 100 : 0,
    options: {},
    cleanupRequired: false,
    currentAttemptId:
      state === 'completed' ? 'attempt-' + id : null,
    errorCode: null
  }
}

function fixture() {
  const rows: DownloadJobDto[] = []
  let serial = 0

  const api = {
    enqueue: vi.fn<DownloadApi['enqueue']>(
      async (request) => {
        const row = {
          ...job('new-' + ++serial),
          url: request.url,
          options: request.options ?? {}
        }

        rows.unshift(row)
        return ok(row)
      }
    ),

    list: vi.fn<DownloadApi['list']>(
      async ({
        limit = 50,
        offset = 0
      } = {}) =>
        ok({
          data: rows.slice(offset, offset + limit),
          limit,
          offset,
          hasNextPage: rows.length > offset + limit
        })
    ),

    get: vi.fn<DownloadApi['get']>(
      async ({ jobId }) => {
        const row = rows.find(
          (item) => item.id === jobId
        )

        return row ? ok(row) : fail('NOT_FOUND')
      }
    ),

    run: vi.fn<DownloadApi['run']>(
      async ({ jobId }) => {
        const row = rows.find(
          (item) => item.id === jobId
        )!

        row.state = 'completed'
        row.phase = 'finished'
        row.currentAttemptId = 'attempt-' + jobId
        row.progress = 100

        return ok({
          status: 'committed',
          jobId,
          attemptId: row.currentAttemptId,
          mediaIdSnapshot: 1
        })
      }
    ),

    cancel: vi.fn<DownloadApi['cancel']>(
      async () => ok({ accepted: true })
    )
  }

  return { api, rows }
}

const stops: (() => void)[] = []

async function flush() {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve()
  }
}

function open(f: ReturnType<typeof fixture>) {
  const notices: {
    message: string
    type: string
  }[] = []

  const store = createDownloadStore(f.api, 1000)
  const stop = store.connect(
    (notice) => notices.push(notice)
  )

  stops.push(stop)

  return { store, stop, notices }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  stops.splice(0).forEach((stop) => stop())
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('download store', () => {
  it('한 provider의 조회 결과를 여러 소비자가 공유한다', async () => {
    const f = fixture()
    const { store } = open(f)
    const first = vi.fn()
    const second = vi.fn()

    store.subscribe(first)
    store.subscribe(second)

    await flush()

    expect(f.api.list).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
    expect(store.getSnapshot().ready).toBe(true)
  })

  it('느린 조회 중에는 poll을 겹치지 않고 해제 후 추가 조회하지 않는다', async () => {
    const f = fixture()
    const pending =
      deferred<DownloadResponse<DownloadPageDto>>()

    f.api.list.mockReturnValueOnce(pending.promise)

    const { store, stop } = open(f)

    await vi.advanceTimersByTimeAsync(5000)

    expect(f.api.list).toHaveBeenCalledTimes(1)

    pending.resolve(
      ok({
        data: [],
        limit: 50,
        offset: 0,
        hasNextPage: false
      })
    )

    await flush()

    expect(store.getSnapshot().ready).toBe(true)

    await vi.advanceTimersByTimeAsync(1000)

    expect(f.api.list).toHaveBeenCalledTimes(2)

    stop()
    stop()

    await vi.advanceTimersByTimeAsync(5000)

    expect(f.api.list).toHaveBeenCalledTimes(2)
  })

  it('StrictMode 재연결 뒤 오래된 응답을 무시한다', async () => {
    const f = fixture()
    const old =
      deferred<DownloadResponse<DownloadPageDto>>()

    f.api.list.mockReturnValueOnce(old.promise)
    f.rows.push(job('current'))

    const { store, stop } = open(f)

    stop()
    stops.push(store.connect(() => {}))

    await flush()

    old.resolve(
      ok({
        data: [job('old')],
        limit: 50,
        offset: 0,
        hasNextPage: false
      })
    )

    await flush()

    expect(
      store.getSnapshot().queue.map((row) => row.id)
    ).toEqual(['current'])
  })

  it('조회한 기존 대기·중단·취소 작업을 자동 실행하지 않는다', async () => {
    const f = fixture()

    f.rows.push(
      job('pending'),
      job('interrupted', 'interrupted'),
      job('cancelled', 'cancelled')
    )

    const { store } = open(f)

    await flush()
    await store.refresh()
    await vi.advanceTimersByTimeAsync(1000)

    expect(f.api.run).not.toHaveBeenCalled()
  })

  it('새 등록에만 수동 최초 실행을 요청하고 완료를 갱신한다', async () => {
    const f = fixture()
    const { store, notices } = open(f)

    await flush()

    const result = await store.startDownload(
      '  https://example.invalid/post  '
    )

    expect(result.ok).toBe(true)

    await flush()

    expect(f.api.enqueue).toHaveBeenCalledWith({
      mode: 'create',
      url: 'https://example.invalid/post'
    })

    expect(f.api.run).toHaveBeenCalledWith({
      jobId: 'new-1',
      trigger: 'manual_initial'
    })

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(1)

    expect(
      notices.filter(
        (notice) => notice.type === 'success'
      )
    ).toHaveLength(1)
  })

  it('여러 실행 요청의 순서는 main에 맡긴다', async () => {
    const f = fixture()
    const a =
      deferred<DownloadResponse<DownloadRunDto>>()
    const b =
      deferred<DownloadResponse<DownloadRunDto>>()

    f.api.run
      .mockReturnValueOnce(a.promise)
      .mockReturnValueOnce(b.promise)

    const { store } = open(f)

    await flush()

    await store.startDownload(
      'https://example.invalid/a'
    )
    await store.startDownload(
      'https://example.invalid/b'
    )

    expect(f.api.run).toHaveBeenCalledTimes(2)
    expect(
      store.getSnapshot().requestedIds
    ).toHaveLength(2)

    a.resolve(
      ok({
        status: 'committed',
        jobId: 'new-1',
        attemptId: 'a',
        mediaIdSnapshot: 1
      })
    )

    b.resolve(
      ok({
        status: 'committed',
        jobId: 'new-2',
        attemptId: 'b',
        mediaIdSnapshot: 2
      })
    )

    await flush()

    expect(
      store.getSnapshot().requestedIds
    ).toEqual([])
  })

  it('실행 통신 실패는 원문 노출·자동 재요청 없이 보류한다', async () => {
    const f = fixture()

    f.api.run.mockRejectedValueOnce(
      new Error('secret-path')
    )

    const { store, notices } = open(f)

    await flush()

    await store.startDownload(
      'https://example.invalid/post'
    )

    await flush()

    expect(
      store.getSnapshot().halted
    ).not.toBeNull()

    expect(
      JSON.stringify(notices)
    ).not.toContain('secret-path')

    expect(
      (
        await store.startDownload(
          'https://example.invalid/next'
        )
      ).ok
    ).toBe(false)

    await vi.advanceTimersByTimeAsync(3000)

    expect(f.api.run).toHaveBeenCalledTimes(1)
    expect(f.api.enqueue).toHaveBeenCalledTimes(1)
  })

  it('blocked 결과를 완료로 표시하지 않는다', async () => {
    const f = fixture()

    f.api.run.mockResolvedValueOnce(
      ok({
        status: 'blocked',
        jobId: 'new-1',
        reason: 'ENGINE_STATE_UNKNOWN'
      })
    )

    const { store, notices } = open(f)

    await flush()

    await store.startDownload(
      'https://example.invalid/post'
    )

    await flush()

    expect(
      store.getSnapshot().halted
    ).not.toBeNull()

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(0)

    expect(
      notices.some(
        (notice) => notice.type === 'success'
      )
    ).toBe(false)
  })

  it('정리 필요 결과는 완료와 구분한다', async () => {
    const f = fixture()

    f.api.run.mockResolvedValueOnce(
      ok({
        status: 'cleanup_required',
        jobId: 'new-1',
        attemptId: 'a',
        taskId: 'cleanup'
      })
    )

    const { store, notices } = open(f)

    await flush()

    await store.startDownload(
      'https://example.invalid/post'
    )

    await flush()

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(0)

    expect(
      store.getSnapshot().halted
    ).toBeNull()

    expect(
      notices.some(
        (notice) => notice.type === 'info'
      )
    ).toBe(true)
  })

  it('poll과 실행 응답이 같은 완료를 알려도 한 번만 갱신한다', async () => {
    const f = fixture()
    const result =
      deferred<DownloadResponse<DownloadRunDto>>()

    f.api.run.mockReturnValueOnce(result.promise)

    const { store } = open(f)

    await flush()

    await store.startDownload(
      'https://example.invalid/post'
    )

    Object.assign(f.rows[0], {
      state: 'completed',
      phase: 'finished',
      currentAttemptId: 'a'
    })

    await store.refresh()

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(1)

    result.resolve(
      ok({
        status: 'committed',
        jobId: 'new-1',
        attemptId: 'a',
        mediaIdSnapshot: 1
      })
    )

    await flush()

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(1)
  })

  it('다른 페이지에서 다시 본 과거 완료를 새 완료로 세지 않는다', async () => {
    const f = fixture()

    for (let i = 0; i < 60; i++) {
      f.rows.push(job(String(i), 'completed'))
    }

    const { store } = open(f)

    await flush()
    await store.refresh(50)
    await store.refresh(0)

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(0)

    expect(f.api.run).not.toHaveBeenCalled()
  })

  it('입력 객체가 바뀌어도 이전 snapshot은 유지한다', async () => {
    const f = fixture()
    f.rows.push(job('old'))

    const { store } = open(f)

    await flush()

    const previous = store.getSnapshot()

    Object.assign(f.rows[0], {
      state: 'completed',
      phase: 'finished',
      currentAttemptId: 'a'
    })

    await store.refresh()

    expect(
      previous.queue[0].state
    ).toBe('pending')

    expect(
      store.getSnapshot().queue[0].state
    ).toBe('completed')

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(1)
  })

  it('늦게 도착한 이전 페이지가 현재 페이지를 덮어쓰지 않는다', async () => {
    const f = fixture()

    for (let i = 0; i < 60; i++) {
      f.rows.push(job(String(i)))
    }

    const { store } = open(f)

    await flush()

    const pending =
      deferred<DownloadResponse<DownloadPageDto>>()

    f.api.list.mockReturnValueOnce(pending.promise)

    const old = store.refresh(0)

    await store.refresh(50)

    pending.resolve(
      ok({
        data: [job('stale')],
        limit: 50,
        offset: 0,
        hasNextPage: false
      })
    )

    await old

    expect(store.getSnapshot().offset).toBe(50)
    expect(
      store.getSnapshot().queue[0].id
    ).toBe('50')
  })

  it('NOT_READY 동안 실행하지 않고 이후 조회 성공으로 연결한다', async () => {
    const f = fixture()

    f.api.list.mockResolvedValueOnce(
      fail('NOT_READY')
    )

    const { store, notices } = open(f)

    await flush()

    expect(store.getSnapshot().ready).toBe(false)

    expect(
      (
        await store.startDownload(
          'https://example.invalid/post'
        )
      ).ok
    ).toBe(false)

    expect(f.api.enqueue).not.toHaveBeenCalled()
    expect(notices).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)

    expect(store.getSnapshot().ready).toBe(true)
  })

  it('등록 도중 해제되면 늦은 응답으로 실행하지 않는다', async () => {
    const f = fixture()
    const pending =
      deferred<DownloadResponse<DownloadJobDto>>()

    f.api.enqueue.mockReturnValueOnce(
      pending.promise
    )

    const { store, stop } = open(f)

    await flush()

    const result = store.startDownload(
      'https://example.invalid/post'
    )

    stop()

    pending.resolve(ok(job('late')))

    await result
    await flush()

    expect(f.api.run).not.toHaveBeenCalled()
    expect(store.getSnapshot().ready).toBe(false)
  })

  it('취소 수락만으로 최종 취소 상태를 만들지 않는다', async () => {
    const f = fixture()

    f.rows.push({
      ...job('active', 'running'),
      phase: 'downloading',
      currentAttemptId: 'a'
    })

    const { store } = open(f)

    await flush()
    await store.cancelDownload('active')

    expect(
      store.getSnapshot().queue[0].state
    ).toBe('running')

    f.rows[0].state = 'cancelled'

    await store.refresh()

    expect(
      store.getSnapshot().queue[0].state
    ).toBe('cancelled')

    expect(
      store.getSnapshot().mediaRevision
    ).toBe(0)
  })

  it('committing 취소 거절을 화면 오류로 전달한다', async () => {
    const f = fixture()

    f.rows.push({
      ...job('active', 'running'),
      phase: 'committing',
      currentAttemptId: 'a'
    })

    f.api.cancel.mockResolvedValueOnce(
      fail('CANNOT_CANCEL_COMMITTING')
    )

    const { store, notices } = open(f)

    await flush()
    await store.cancelDownload('active')

    expect(
      store.getSnapshot().queue[0].state
    ).toBe('running')

    expect(notices).toContainEqual({
      message: 'CANNOT_CANCEL_COMMITTING',
      type: 'error'
    })
  })

  it('같은 실행 요청을 중복 전송하지 않고 수동 trigger를 보존한다', async () => {
    const f = fixture()
    f.rows.push(job('failed', 'failed'))

    const pending =
      deferred<DownloadResponse<DownloadRunDto>>()

    f.api.run.mockReturnValueOnce(pending.promise)

    const { store } = open(f)

    await flush()

    const first = store.runJob(
      'failed',
      'manual_retry'
    )

    await store.runJob(
      'failed',
      'manual_retry'
    )

    expect(f.api.run).toHaveBeenCalledTimes(1)

    expect(f.api.run).toHaveBeenCalledWith({
      jobId: 'failed',
      trigger: 'manual_retry'
    })

    pending.resolve(
      fail('REVISION_CONFLICT')
    )

    await first

    expect(
      store.getSnapshot().halted
    ).toBeNull()
  })

  it('취소 통신 실패의 원문을 노출하지 않는다', async () => {
    const f = fixture()
    f.rows.push(job('active', 'running'))

    f.api.cancel.mockRejectedValueOnce(
      new Error('secret-path')
    )

    const { store, notices } = open(f)

    await flush()
    await store.cancelDownload('active')

    expect(
      JSON.stringify(notices)
    ).not.toContain('secret-path')

    expect(
      store.getSnapshot().queue[0].state
    ).toBe('running')
  })

  it('목록은 페이지 크기로 제한하고 전체 작업을 순회하지 않는다', async () => {
    const f = fixture()

    for (let i = 0; i < 200; i++) {
      f.rows.push(job(String(i)))
    }

    const { store } = open(f)

    await flush()

    expect(
      store.getSnapshot().queue
    ).toHaveLength(DOWNLOAD_PAGE_SIZE)

    expect(f.api.list).toHaveBeenCalledTimes(1)

    expect(f.api.list).toHaveBeenCalledWith({
      limit: DOWNLOAD_PAGE_SIZE,
      offset: 0
    })

    expect(f.api.get).not.toHaveBeenCalled()
  })
})