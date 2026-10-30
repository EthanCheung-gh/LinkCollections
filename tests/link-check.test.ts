import { describe, expect, it, vi } from 'vitest'

/**
 * 只测 `electron/ipc/links.ts` 的**纯函数**：不发任何真实网络请求。
 *
 * 该模块顶层 `import { ipcMain } from 'electron'`，并且通过 `utils/storage` 依赖
 * `app.getPath('userData')`（模块加载时就会执行），因此仍然需要 electron 桩。
 */
vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

const { classifyStatus, shouldRetryWithGet, runWithConcurrency, mergeLinkStatus } =
  await import('../electron/ipc/links')

const CHECKED_AT = '2024-05-01T12:00:00.000Z'

describe('classifyStatus', () => {
  it('2xx / 3xx 判为 ok', () => {
    expect(classifyStatus(200)).toBe('ok')
    expect(classifyStatus(204)).toBe('ok')
    expect(classifyStatus(301)).toBe('ok')
  })

  it('404 / 410 判为 broken', () => {
    expect(classifyStatus(404)).toBe('broken')
    expect(classifyStatus(410)).toBe('broken')
  })

  it('0（没有状态码 = 连接层失败）判为 broken', () => {
    expect(classifyStatus(0)).toBe('broken')
  })

  it('401 / 403 / 429 / 5xx 判为 unknown（可能是反爬或服务端问题）', () => {
    expect(classifyStatus(401)).toBe('unknown')
    expect(classifyStatus(403)).toBe('unknown')
    expect(classifyStatus(429)).toBe('unknown')
    expect(classifyStatus(500)).toBe('unknown')
    expect(classifyStatus(503)).toBe('unknown')
  })

  it('异常值不抛错，归到 unknown', () => {
    expect(classifyStatus(Number.NaN)).toBe('broken')
    expect(classifyStatus(100)).toBe('unknown')
    expect(classifyStatus(-1)).toBe('broken')
  })
})

describe('shouldRetryWithGet（HEAD → GET 回退）', () => {
  it('405 / 501 表示服务器不支持 HEAD', () => {
    expect(shouldRetryWithGet({ status: 405 })).toBe(true)
    expect(shouldRetryWithGet({ status: 501 })).toBe(true)
  })

  it('403 也重试（不少 WAF 只拦 HEAD）', () => {
    expect(shouldRetryWithGet({ status: 403 })).toBe(true)
  })

  it('网络错误/超时（只有 error 没有状态码）需要重试', () => {
    expect(shouldRetryWithGet({ error: 'ENOTFOUND' })).toBe(true)
    expect(shouldRetryWithGet({ status: undefined, error: 'timeout after 8000ms' })).toBe(true)
    expect(shouldRetryWithGet({})).toBe(true)
  })

  it('2xx 已经有结论，不再多发一次请求', () => {
    expect(shouldRetryWithGet({ status: 200 })).toBe(false)
    expect(shouldRetryWithGet({ status: 404 })).toBe(false)
  })
})

describe('runWithConcurrency', () => {
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

  it('并发度不超过 limit', async () => {
    let active = 0
    let peak = 0
    const items = Array.from({ length: 12 }, (_, index) => index)

    const results = await runWithConcurrency(items, 4, async item => {
      active += 1
      peak = Math.max(peak, active)
      await sleep(5)
      active -= 1
      return item * 2
    })

    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
    expect(results).toEqual(items.map(item => item * 2))
  })

  it('保持输入顺序（即使完成顺序相反）', async () => {
    const delays = [30, 10, 20, 1]
    const results = await runWithConcurrency(delays, 4, async delay => {
      await sleep(delay)
      return delay
    })

    expect(results).toEqual(delays)
  })

  it('空数组直接返回空数组，不调用 worker', async () => {
    let calls = 0
    const results = await runWithConcurrency([], 4, async () => {
      calls += 1
      return 1
    })

    expect(results).toEqual([])
    expect(calls).toBe(0)
  })

  it('limit = 0 兜底为串行（不会一个都不跑）', async () => {
    let active = 0
    let peak = 0

    const results = await runWithConcurrency([1, 2, 3], 0, async item => {
      active += 1
      peak = Math.max(peak, active)
      await sleep(2)
      active -= 1
      return item
    })

    expect(peak).toBe(1)
    expect(results).toEqual([1, 2, 3])
  })
})

describe('mergeLinkStatus', () => {
  it('ok：2xx → ok:true，status 原样保留', () => {
    expect(mergeLinkStatus('b1', { status: 200 }, CHECKED_AT)).toEqual({
      ok: true,
      status: 200,
      checkedAt: CHECKED_AT
    })
  })

  it('broken：404 → ok:false', () => {
    expect(mergeLinkStatus('b2', { status: 404 }, CHECKED_AT)).toEqual({
      ok: false,
      status: 404,
      checkedAt: CHECKED_AT
    })
  })

  it('unknown：403 → ok:null', () => {
    expect(mergeLinkStatus('b3', { status: 403 }, CHECKED_AT)).toEqual({
      ok: null,
      status: 403,
      checkedAt: CHECKED_AT
    })
  })

  it('网络错误：无状态码时判 broken，并记录错误原因', () => {
    expect(mergeLinkStatus('b4', { error: 'getaddrinfo ENOTFOUND' }, CHECKED_AT)).toEqual({
      ok: false,
      status: null,
      checkedAt: CHECKED_AT,
      error: 'getaddrinfo ENOTFOUND'
    })
  })

  it('error 截断到 200 字符', () => {
    const longError = 'x'.repeat(500)
    const result = mergeLinkStatus('b5', { status: 500, error: longError }, CHECKED_AT)

    expect(result.status).toBe(500)
    expect(result.ok).toBe(null)
    expect(result.error).toHaveLength(200)
  })

  it('checkedAt 由调用方透传（同一轮检查共用一个时间戳）', () => {
    const checkedAt = '2030-01-02T03:04:05.678Z'
    expect(mergeLinkStatus('b6', { status: 301 }, checkedAt).checkedAt).toBe(checkedAt)
  })
})
