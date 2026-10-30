import { describe, expect, it } from 'vitest'
import { buildDailySeries, toLocalDateKey } from '../src/renderer/stores/history'

const at = (iso: string) => ({ bookmarkId: 'b', visitedAt: iso })

describe('toLocalDateKey', () => {
  it('按本地时区补零输出 YYYY-MM-DD', () => {
    const d = new Date(2024, 0, 5, 23, 30)
    expect(toLocalDateKey(d)).toBe('2024-01-05')
  })
})

describe('buildDailySeries', () => {
  const now = new Date(2024, 4, 10, 12, 0, 0) // 本地时间 2024-05-10 12:00

  it('长度等于请求天数，且按日期升序', () => {
    const series = buildDailySeries([], 7, now)
    expect(series).toHaveLength(7)
    expect(series[0].date).toBe('2024-05-04')
    expect(series[6].date).toBe('2024-05-10')
    expect(series.every(p => p.count === 0)).toBe(true)
  })

  it('缺日补 0，同一天多次访问累加', () => {
    const records = [
      at(new Date(2024, 4, 10, 9, 0).toISOString()),
      at(new Date(2024, 4, 10, 20, 0).toISOString()),
      at(new Date(2024, 4, 8, 8, 0).toISOString())
    ]
    const series = buildDailySeries(records, 3, now)
    expect(series).toEqual([
      { date: '2024-05-08', count: 1 },
      { date: '2024-05-09', count: 0 },
      { date: '2024-05-10', count: 2 }
    ])
  })

  it('范围外的记录被忽略', () => {
    const records = [at(new Date(2024, 3, 1, 10, 0).toISOString())]
    const series = buildDailySeries(records, 7, now)
    expect(series.reduce((sum, p) => sum + p.count, 0)).toBe(0)
  })

  it('跨月与跨年连续', () => {
    const jan = new Date(2024, 0, 2, 10, 0, 0)
    const series = buildDailySeries([], 3, jan)
    expect(series.map(p => p.date)).toEqual(['2023-12-31', '2024-01-01', '2024-01-02'])
  })

  it('非法天数返回空数组', () => {
    expect(buildDailySeries([], 0, now)).toEqual([])
    expect(buildDailySeries([], -5, now)).toEqual([])
    expect(buildDailySeries([], Number.NaN, now)).toEqual([])
  })

  it('30 / 90 天长度正确', () => {
    expect(buildDailySeries([], 30, now)).toHaveLength(30)
    expect(buildDailySeries([], 90, now)).toHaveLength(90)
  })
})
