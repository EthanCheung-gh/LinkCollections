import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useSortStore, type SortableBookmark } from '../src/renderer/stores/sort'

interface Row extends SortableBookmark {
  id: string
}

const row = (id: string, extra: Partial<Row> = {}): Row => ({ id, ...extra })

describe('sort store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('默认状态不排序，且 pinned 优先', () => {
    const store = useSortStore()
    const list = [row('a', { pinned: false }), row('b', { pinned: true }), row('c')]
    expect(store.hasSort).toBe(false)
    expect(store.applySort(list).map(item => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('同键再次 setSort 会反转方向', () => {
    const store = useSortStore()
    store.setSort('title')
    expect(store.sortDirection).toBe('asc')
    store.setSort('title')
    expect(store.sortDirection).toBe('desc')
  })

  it('显式传方向则直接设置', () => {
    const store = useSortStore()
    store.setSort('visitCount', 'desc')
    expect(store.sortKey).toBe('visitCount')
    expect(store.sortDirection).toBe('desc')
  })

  it('切到 default 会复位', () => {
    const store = useSortStore()
    store.setSort('title', 'desc')
    store.setSort('default')
    expect(store.hasSort).toBe(false)
    expect(store.sortDirection).toBe('asc')
  })

  it('置顶先于任意排序规则，且组内仍按所选键排序', () => {
    const store = useSortStore()
    const list = [
      row('low', { visitCount: 1 }),
      row('pinnedLow', { visitCount: 5, pinned: true }),
      row('high', { visitCount: 100 }),
      row('pinnedHigh', { visitCount: 50, pinned: true })
    ]
    store.setSort('visitCount', 'desc')
    expect(store.applySort(list).map(item => item.id)).toEqual([
      'pinnedHigh',
      'pinnedLow',
      'high',
      'low'
    ])
  })

  it('title 使用 localeCompare（大小写不敏感）', () => {
    const store = useSortStore()
    store.setSort('title', 'asc')
    const list = [row('b', { title: 'beta' }), row('a', { title: 'Alpha' }), row('c')]
    expect(store.applySort(list).map(item => item.id)).toEqual(['c', 'a', 'b'])
  })

  it('createdAt 非法值排在最旧一侧，不产生 NaN 抖动', () => {
    const store = useSortStore()
    store.setSort('createdAt', 'asc')
    const list = [
      row('new', { createdAt: '2024-05-01T00:00:00.000Z' }),
      row('bad', { createdAt: 'not-a-date' }),
      row('old', { createdAt: '2023-01-01T00:00:00.000Z' })
    ]
    expect(store.applySort(list).map(item => item.id)).toEqual(['bad', 'old', 'new'])
  })

  it('lastVisited 为 null 视为最久未访问（降序排最后）', () => {
    const store = useSortStore()
    store.setSort('lastVisited', 'desc')
    const list = [
      row('never'),
      row('yesterday', { lastVisited: '2024-05-02T00:00:00.000Z' }),
      row('today', { lastVisited: '2024-05-03T00:00:00.000Z' })
    ]
    expect(store.applySort(list).map(item => item.id)).toEqual(['today', 'yesterday', 'never'])
  })

  it('visitCount 缺失/非法按 0 处理', () => {
    const store = useSortStore()
    store.setSort('visitCount', 'asc')
    const list = [row('five', { visitCount: 5 }), row('none'), row('nan', { visitCount: NaN })]
    expect(store.applySort(list).map(item => item.id)).toEqual(['none', 'nan', 'five'])
  })

  it('不修改入参数组（纯函数语义）', () => {
    const store = useSortStore()
    store.setSort('title', 'asc')
    const list = [row('b', { title: 'b' }), row('a', { title: 'a' })]
    const snapshot = list.map(item => item.id)
    store.applySort(list)
    expect(list.map(item => item.id)).toEqual(snapshot)
  })

  it('空数组安全', () => {
    const store = useSortStore()
    store.setSort('title', 'asc')
    expect(store.applySort([])).toEqual([])
  })
})
