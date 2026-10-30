import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { VisitRecord } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

/** 趋势图上的一个点：`date` 是**本地**日期键 `YYYY-MM-DD`，`count` 为该天的访问次数。 */
export interface DailyPoint {
  date: string
  count: number
}

/** 补零到两位（`2024-5-6` → `2024-05-06`），保证日期键可比较、可当作 ECharts 类目轴取值 */
const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value))

/**
 * 本地日期键 `YYYY-MM-DD`。
 *
 * **不要**用 `toISOString().slice(0, 10)`：那是 UTC 日期，在东八区 08:00 之前会把
 * 「今天」算成昨天，趋势图的最后一根柱子会永远差一天。这里一律用本地字段拼接。
 */
export const toLocalDateKey = (date: Date): string =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

/**
 * 把逐次访问记录聚合成「按天」序列（纯函数，导出以便离线测试）。
 *
 * - 返回 **`days` 个点，从 (今天 - days + 1) 到今天，升序**；没有访问的日期补 0
 *   （折线图的 x 轴必须是连续日期，不能跳日）；
 * - 聚合按**本地时区**进行：`visitedAt` 是 UTC 的 ISO 串，先 `new Date(...)` 再取本地
 *   年月日，跨时区的用户看到的「哪天访问了什么」才符合直觉；
 * - 日期推进用 `new Date(y, m, d - offset)` 而不是「毫秒减法」：夏令时切换日一天可能是
 *   23 或 25 小时，毫秒减法会在切换点吞掉/重复一天；
 * - 窗口外的记录（更早或未来）直接忽略；不可解析的 `visitedAt` 忽略（防御脏数据）。
 *
 * @param records 逐次访问记录（主进程已过滤，但这里仍做类型防御）
 * @param days 统计天数，非正数/非法值返回空数组
 * @param now 锚点时间，默认当前时间（仅测试注入）
 */
export function buildDailySeries(
  records: VisitRecord[],
  days: number,
  now: Date = new Date()
): DailyPoint[] {
  const total = Number.isFinite(days) ? Math.floor(days) : 0
  if (total <= 0) {
    return []
  }

  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const series: DailyPoint[] = []
  const indexByDate = new Map<string, number>()

  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const day = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - offset)
    const date = toLocalDateKey(day)
    indexByDate.set(date, series.length)
    series.push({ date, count: 0 })
  }

  if (!Array.isArray(records)) {
    return series
  }

  for (const record of records) {
    if (!record || typeof record.visitedAt !== 'string') continue

    const time = Date.parse(record.visitedAt)
    if (!Number.isFinite(time)) continue

    const index = indexByDate.get(toLocalDateKey(new Date(time)))
    if (index === undefined) continue

    series[index].count += 1
  }

  return series
}

export const useHistoryStore = defineStore('history', () => {
  const { t } = useI18n()
  const records = ref<VisitRecord[]>([])

  /**
   * 与其它 store 的 `loading` 语义一致：只表示「正在拉取」。
   * 趋势图不用它做骨架屏（数据不足时直接显示「暂无访问记录」），因此只导出备用。
   */
  const loading = ref(false)

  const fetchHistory = async () => {
    try {
      loading.value = true
      records.value = await window.electronAPI.getVisitHistory()
    } catch (error) {
      // 历史拉取失败不能阻塞统计页的其它数据（书签/文件夹/标签各自独立 fetch），
      // 所以这里只提示 + 记日志，不 rethrow。
      ElMessage.error(t('message.historyLoadFailed'))
      console.error(error)
    } finally {
      loading.value = false
    }
  }

  /**
   * 清空访问历史。
   *
   * 目前没有 UI 入口（`clearAllBookmarks` 已在主进程里顺带清空历史），保留这个动作是
   * 为了让「历史」拥有与其它 store 一致的可控边界。失败时记日志并 rethrow：
   * 调用方需要知道清空没成功，不能静默把本地 `records` 置空。
   */
  const clearHistory = async () => {
    try {
      await window.electronAPI.clearVisitHistory()
      records.value = []
    } catch (error) {
      console.error('Failed to clear visit history:', error)
      throw error
    }
  }

  /** 最近 `days` 天的按天序列（升序，缺日补 0） */
  const dailySeries = (days: number): DailyPoint[] => buildDailySeries(records.value, days)

  /** 最近 `days` 天范围内的总访问次数 */
  const inRangeTotal = (days: number): number =>
    dailySeries(days).reduce((sum, point) => sum + point.count, 0)

  return {
    records,
    loading,
    fetchHistory,
    clearHistory,
    dailySeries,
    inRangeTotal
  }
})
