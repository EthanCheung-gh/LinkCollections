import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempUserData } from './helpers/electron-stub'

vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

const DAY = 86_400_000

describe('pruneHistory（访问历史保留策略）', () => {
  beforeEach(() => {
    useTempUserData()
  })

  it('丢弃超过 90 天的记录', async () => {
    const { pruneHistory } = await import('../electron/ipc/history')
    const now = Date.parse('2024-06-01T00:00:00.000Z')
    const records = [
      { bookmarkId: 'a', visitedAt: new Date(now - 91 * DAY).toISOString() },
      { bookmarkId: 'b', visitedAt: new Date(now - 10 * DAY).toISOString() }
    ]
    expect(pruneHistory(records, now).map(r => r.bookmarkId)).toEqual(['b'])
  })

  it('正好 90 天保留（边界用 >=）', async () => {
    const { pruneHistory } = await import('../electron/ipc/history')
    const now = Date.parse('2024-06-01T00:00:00.000Z')
    const records = [{ bookmarkId: 'a', visitedAt: new Date(now - 90 * DAY).toISOString() }]
    expect(pruneHistory(records, now)).toHaveLength(1)
  })

  it('超过 5000 条时保留最新的 5000 条', async () => {
    const { pruneHistory } = await import('../electron/ipc/history')
    const now = Date.parse('2024-06-01T00:00:00.000Z')
    const records = Array.from({ length: 6000 }, (_, i) => ({
      bookmarkId: `b${i}`,
      visitedAt: new Date(now - 60 * DAY + i * 1000).toISOString()
    }))
    const pruned = pruneHistory(records, now)
    expect(pruned).toHaveLength(5000)
    expect(pruned[0].bookmarkId).toBe('b1000')
    expect(pruned[pruned.length - 1].bookmarkId).toBe('b5999')
  })

  it('过滤脏元素（非对象 / 缺字段 / 时间不可解析）', async () => {
    const { pruneHistory } = await import('../electron/ipc/history')
    const now = Date.parse('2024-06-01T00:00:00.000Z')
    const records = [
      null,
      'string',
      { bookmarkId: 123, visitedAt: new Date(now).toISOString() },
      { bookmarkId: '', visitedAt: new Date(now).toISOString() },
      { bookmarkId: 'ok', visitedAt: 'not-a-date' },
      { bookmarkId: 'good', visitedAt: new Date(now).toISOString() }
    ] as unknown as Array<{ bookmarkId: string; visitedAt: string }>
    expect(pruneHistory(records, now).map(r => r.bookmarkId)).toEqual(['good'])
  })

  it('不修改入参数组', async () => {
    const { pruneHistory } = await import('../electron/ipc/history')
    const now = Date.now()
    const records = [{ bookmarkId: 'a', visitedAt: new Date(now).toISOString() }]
    const copy = [...records]
    pruneHistory(records, now)
    expect(records).toEqual(copy)
  })

  it('空数组返回空数组', async () => {
    const { pruneHistory } = await import('../electron/ipc/history')
    expect(pruneHistory([], Date.now())).toEqual([])
  })

  it('appendVisit 写盘后立即满足保留策略', async () => {
    const { appendVisit, readHistory, HISTORY_MAX_RECORDS } = await import('../electron/ipc/history')
    for (let i = 0; i < 5; i += 1) {
      appendVisit(`b${i}`)
    }
    const records = readHistory()
    expect(records).toHaveLength(5)
    expect(records.length).toBeLessThanOrEqual(HISTORY_MAX_RECORDS)
    expect(records.every(r => typeof r.bookmarkId === 'string')).toBe(true)
  })
})
