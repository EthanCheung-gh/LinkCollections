export * from './bookmark'
export * from './folder'
export * from './tag'
export * from './settings'

/**
 * 一条逐次访问记录（`history.json` 的数组元素，主进程 `electron/ipc/history.ts` 定义）。
 *
 * `visitedAt` 是 ISO 时间字符串（UTC 表示）；按「哪一天」聚合时必须先转成本地时区，
 * 详见 `stores/history.ts` 的 `buildDailySeries`。
 */
export interface VisitRecord {
  bookmarkId: string
  visitedAt: string
}
