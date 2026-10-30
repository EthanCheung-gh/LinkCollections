import { ipcMain } from 'electron'
import { readJsonFile, writeJsonFile } from '../utils/storage'

/**
 * 逐次访问历史（`history.json`）。
 *
 * 为什么单独存一份：`Bookmark` 只有 `visitCount` + `lastVisited` 两个**聚合**字段，
 * 无法还原「哪一天访问了几次」，统计页的趋势图需要逐条记录。
 *
 * 文件形状是**数组** `VisitRecord[]`，不包 `{ version, items }`：与
 * `bookmarks.json` / `folders.json` / `tags.json` 保持同一契约（版本信息统一放在
 * `meta.json`，见 `utils/schema.ts`），这样 `utils/storage.ts` 的「默认值形状校验」
 * 与原子写/损坏备份都能原样复用。
 *
 * 不做历史回填（有意为之）：老用户升级后 `history.json` 只是一个空数组，趋势图从 0
 * 开始累积。旧数据里只有聚合的 `visitCount` / `lastVisited`，把它们「摊」到过去若干天
 * 等于伪造从未记录过的访问时间，会直接误导用户，因此这里选择从升级那天起如实记录。
 */

/** 访问历史文件名（与 bookmarks.json 同目录：`userData/data/`） */
export const HISTORY_FILE = 'history.json'

/**
 * 保留窗口：只保留最近 **90 天** 的记录。
 *
 * 更早的访问对「最近 7/30/90 天趋势」没有意义，而无上限累积会让
 * 「读 → push → 裁剪 → 整文件重写」的成本随使用时长线性增长。
 */
export const HISTORY_RETENTION_DAYS = 90

/**
 * 数量上限：最多保留 **5000 条**（超出时丢弃最旧的）。
 *
 * 90 天窗口管住「时间维度」，这个上限管住「强度维度」：高频用户一天点几百次时，
 * 单靠时间窗口仍可能攒出几十万条记录，整文件重写会明显变慢。
 */
export const HISTORY_MAX_RECORDS = 5000

/** 一天的毫秒数（裁剪窗口用，避免魔法数字散落在函数体里） */
const DAY_MS = 86_400_000

/** 落盘的一条访问记录；`visitedAt` 是 ISO 时间字符串（UTC 表示，展示时再转本地时区）。 */
export interface VisitRecord {
  bookmarkId: string
  visitedAt: string
}

/** 解析后的中间形态：多带一个已算好的时间戳，避免裁剪时重复 `Date.parse`。 */
interface ParsedVisitRecord {
  bookmarkId: string
  visitedAt: string
  time: number
}

/**
 * 脏元素过滤的**唯一**入口。
 *
 * 读取侧（{@link readHistory}）与裁剪侧（{@link pruneHistory}）共用同一套规则，
 * 因此无论脏数据是「文件被手工编辑过」还是「调用方直接传进来的对象」，判定都一致：
 * 非对象、`bookmarkId` 不是非空字符串、`visitedAt` 不是字符串或不可解析 → 丢弃。
 * （`bookmarkId === ''` 也丢弃：空 id 一定指向不存在的书签，留着只会变成悬空记录。）
 */
function parseVisitRecord(value: unknown): ParsedVisitRecord | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const candidate = value as Record<string, unknown>
  const { bookmarkId, visitedAt } = candidate

  if (typeof bookmarkId !== 'string' || bookmarkId === '') return null
  if (typeof visitedAt !== 'string') return null

  const time = Date.parse(visitedAt)
  if (!Number.isFinite(time)) return null

  return { bookmarkId, visitedAt, time }
}

/**
 * 读取访问历史（默认 `[]`）。
 *
 * 任何脏元素都被过滤掉而不是让整个文件失效：单条坏记录不应该让用户丢掉全部趋势数据。
 * 文件缺失 / JSON 损坏 / 顶层不是数组时，`utils/storage.ts` 已经做了备份并返回默认值。
 */
export function readHistory(): VisitRecord[] {
  const raw = readJsonFile<unknown[]>(HISTORY_FILE, [])

  if (!Array.isArray(raw)) {
    return []
  }

  const records: VisitRecord[] = []
  for (const item of raw) {
    const parsed = parseVisitRecord(item)
    if (!parsed) continue
    records.push({ bookmarkId: parsed.bookmarkId, visitedAt: parsed.visitedAt })
  }
  return records
}

/**
 * 裁剪策略（**顺序不可交换**）：
 *
 * 1. 先按**时间窗口**过滤：`visitedAt >= now - 90 天`（正好 90 天**保留**，用 `>=`）；
 * 2. 再按**数量**截取：按 `visitedAt` 升序排序后保留尾部（最新）的 5000 条。
 *
 * 先时间后数量：反过来的话，若记录数已经超过 5000，先截断会把「最新的 5000 条」
 * 选出来却发现其中一部分已过期，最终文件里可能只剩远少于窗口容量的记录。
 * 现状顺序保证「窗口内最旧的记录」先被丢弃，符合「只关心最近访问」的产品语义。
 *
 * 排序是稳定的（`Array.prototype.sort` 在现代 V8 上稳定）：同一毫秒的多条记录保持
 * 原始先后顺序，`slice` 的边界因此可预测。
 *
 * 纯函数：不读写盘、不改入参，`now` 可注入（便于离线测试），因此导出。
 */
export function pruneHistory(records: VisitRecord[], now: number = Date.now()): VisitRecord[] {
  if (!Array.isArray(records)) {
    return []
  }

  const cutoff = now - HISTORY_RETENTION_DAYS * DAY_MS
  const kept: VisitRecord[] = []

  for (const record of records) {
    const parsed = parseVisitRecord(record)
    if (!parsed) continue
    if (parsed.time < cutoff) continue
    kept.push({ bookmarkId: parsed.bookmarkId, visitedAt: parsed.visitedAt })
  }

  // `<=` 提前返回还有一个隐含作用：不足上限时保持原有（追加）顺序，不做无意义的排序
  if (kept.length <= HISTORY_MAX_RECORDS) {
    return kept
  }

  const sorted = kept
    .map((record, index) => ({ record, index, time: Date.parse(record.visitedAt) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)

  return sorted.slice(-HISTORY_MAX_RECORDS).map(entry => entry.record)
}

/** 唯一的写盘入口：每次写入前先裁剪，保证「写入即合规」（窗口 + 上限同时生效）。 */
function writeHistory(records: VisitRecord[]): void {
  writeJsonFile<VisitRecord[]>(HISTORY_FILE, records)
}

/**
 * 追加一次访问。由 `ipc/bookmarks.ts` 的 `increment-visit-count` 在书签写回**之后**调用。
 *
 * 失败时**抛出**（不吞异常）：是否需要让上层失败由调用方决定 —— 访问计数是主数据，
 * 不能因为历史文件写失败而回滚，所以调用方会 catch 后只记日志。
 */
export function appendVisit(bookmarkId: string): void {
  if (typeof bookmarkId !== 'string' || bookmarkId === '') {
    // 空 id 记录进去只会变成永远的悬空数据，直接忽略
    return
  }

  const records = readHistory()
  records.push({ bookmarkId, visitedAt: new Date().toISOString() })
  writeHistory(pruneHistory(records))
}

/**
 * 删除某个书签的全部历史（`delete-bookmark` 成功后调用），避免留下悬空 id
 * 让趋势图继续统计一个已经不存在的书签。
 *
 * 一条都没匹配到时不写盘：删除不存在的书签历史不该产生磁盘写入。
 */
export function removeBookmarkHistory(bookmarkId: string): void {
  if (typeof bookmarkId !== 'string' || bookmarkId === '') {
    return
  }

  const records = readHistory()
  if (records.length === 0) return

  const remaining = records.filter(record => record.bookmarkId !== bookmarkId)
  if (remaining.length === records.length) return

  writeHistory(remaining)
}

/** 清空全部历史（`clearAllBookmarks` 之后调用，让「清空数据」是彻底的）。 */
export function clearHistory(): void {
  writeHistory([])
}

/**
 * 批量删除多个书签的历史（`bulk-delete-bookmarks` / replace 导入后调用）。
 *
 * 一次读、一次写，避免逐条 `removeBookmarkHistory` 反复重写整个文件；
 * 一个都没有匹配到时不写盘。
 */
export function removeBookmarksHistory(bookmarkIds: readonly string[]): void {
  const targets = new Set(bookmarkIds.filter(id => typeof id === 'string' && id !== ''))
  if (targets.size === 0) {
    return
  }

  const records = readHistory()
  if (records.length === 0) return

  const remaining = records.filter(record => !targets.has(record.bookmarkId))
  if (remaining.length === records.length) return

  writeHistory(remaining)
}

/**
 * 历史快照 / 还原：供 `import-data` 的 replace 模式把它纳入同一个写入事务
 * （替换全部数据时旧书签会被丢弃，其访问历史也必须一并清掉；失败则回滚）。
 */
export function snapshotHistory(): VisitRecord[] {
  return readHistory()
}

export function restoreHistory(records: VisitRecord[]): boolean {
  writeHistory(records)
  return true
}

export function registerHistoryHandlers(): void {
  /** 统计页趋势图的数据来源：直接返回数组（不做任何聚合，聚合在渲染层按本地时区做） */
  ipcMain.handle('get-visit-history', () => {
    return readHistory()
  })

  ipcMain.handle('clear-visit-history', () => {
    clearHistory()
    return true
  })
}
