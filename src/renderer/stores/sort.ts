import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

/** 排序键：'default' = 不排序（保持原始顺序） */
export type SortKey = 'default' | 'title' | 'createdAt' | 'visitCount' | 'lastVisited'
export type SortDirection = 'asc' | 'desc'

/**
 * `applySort` 需要的最小字段集合（结构约束，不依赖具体书签类型）。
 * `Bookmark` 天然满足：`pinned` 可选，缺失语义等同「未置顶」。
 */
export interface SortableBookmark {
  title?: string | null
  createdAt?: string | null
  visitCount?: number | null
  lastVisited?: string | null
  pinned?: boolean
}

/** 无数据/非法值统一排序值：日期类字段用它兜底，避免比较器里出现 NaN（NaN 比较恒 false） */
const NO_TIME = Number.NEGATIVE_INFINITY

/**
 * 置顶优先分组：先拼接置顶项、再拼接其余项，**组内保持入参顺序**
 * （`filter` 天然稳定；置顶绝不进入比较器，否则「组内排序」会被置顶位次污染）。
 */
const pinnedFirst = <T extends SortableBookmark>(list: readonly T[]): T[] => [
  ...list.filter(item => item.pinned === true),
  ...list.filter(item => item.pinned !== true)
]

/** 空标题按 `''` 处理，避免 null/undefined 进 localeCompare 抛错 */
const titleValue = (value?: string | null): string => value ?? ''

/** 日期字符串 → 时间戳；null / 空串 / 非法日期统一为 -Infinity */
const timeValue = (value?: string | null): number => {
  if (!value) return NO_TIME
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : NO_TIME
}

/** 访问次数：非有限数（NaN / Infinity / 缺失）按 0 */
const visitCountValue = (value?: number | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const compareNumbers = (a: number, b: number): number => (a < b ? -1 : a > b ? 1 : 0)

/** 单键比较器：方向由调用方以符号乘入，保证「相等」恒返回 0（稳定排序的前提） */
const compareByKey = (
  key: Exclude<SortKey, 'default'>,
  a: SortableBookmark,
  b: SortableBookmark
): number => {
  switch (key) {
    case 'title':
      return titleValue(a.title).localeCompare(titleValue(b.title), undefined, {
        sensitivity: 'base'
      })
    case 'createdAt':
      return compareNumbers(timeValue(a.createdAt), timeValue(b.createdAt))
    case 'visitCount':
      return compareNumbers(visitCountValue(a.visitCount), visitCountValue(b.visitCount))
    case 'lastVisited':
      return compareNumbers(timeValue(a.lastVisited), timeValue(b.lastVisited))
  }
}

/**
 * 排序状态（**只存内存**：不落 settings、不改数据结构）。
 * 卡片视图 / 列表视图共用这一份状态，切视图时排序保持不丢。
 */
export const useSortStore = defineStore('sort', () => {
  const sortKey = ref<SortKey>('default')
  /** sortKey === 'default' 时的方向无意义，统一保留 'asc' 便于复位 */
  const sortDirection = ref<SortDirection>('asc')

  const hasSort = computed(() => sortKey.value !== 'default')

  const reset = () => {
    sortKey.value = 'default'
    sortDirection.value = 'asc'
  }

  /**
   * - 显式给 direction：直接设置（表头 sort-change 走这条路径）；
   * - 同键再次调用且未给 direction：反转方向（工具条方向按钮 / 重复点同一排序项）；
   * - 换键：（非 default）从 asc 开始；
   * - 'default'：清除排序（方向无意义）。
   */
  const setSort = (key: SortKey, direction?: SortDirection) => {
    if (key === 'default') {
      reset()
      return
    }
    if (direction) {
      sortKey.value = key
      sortDirection.value = direction
      return
    }
    if (sortKey.value === key) {
      sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc'
      return
    }
    sortKey.value = key
    sortDirection.value = 'asc'
  }

  /**
   * 纯函数式：返回新数组，不修改入参。
   * 顺序 = 「先排序 → 再置顶分组拼接」，因此置顶项在任何排序下都恒在前，
   * 且置顶组内 / 非置顶组内各自按同一比较器排列。
   */
  const applySort = <T extends SortableBookmark>(list: T[]): T[] => {
    const key = sortKey.value
    if (key === 'default') {
      return pinnedFirst(list)
    }

    // 现代 V8 的 Array.prototype.sort 是稳定排序，直接用它即可
    const sign = sortDirection.value === 'desc' ? -1 : 1
    const sorted = [...list]
    sorted.sort((a, b) => sign * compareByKey(key, a, b))
    return pinnedFirst(sorted)
  }

  return {
    sortKey,
    sortDirection,
    hasSort,
    setSort,
    reset,
    applySort
  }
})
