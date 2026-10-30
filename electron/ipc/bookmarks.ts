import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { readJsonFile, writeJsonFile } from '../utils/storage'
// 访问历史与书签写在两个文件里：这里**直接调用函数**而不是走 IPC，
// 避免主进程自己 invoke 自己的通道（多一层序列化，且错误语义会被 wrap 成字符串）。
import { appendVisit, clearHistory, removeBookmarksHistory } from './history'
// 重复书签合并的「计划」是纯函数，主进程与渲染层共用同一份（含 URL 归一化规则）
import { planDuplicateMerges } from '../../shared/duplicates'

/**
 * 回收站保留期（天）。
 *
 * 软删除超过这个天数的记录会在应用启动时（迁移之后、建窗之前）被**永久**清理，
 * 见 {@link purgeExpiredTrash}。30 天是产品约定：既给用户足够的反悔窗口，
 * 又避免回收站无限膨胀（每次写盘都要重写整个 bookmarks.json）。
 */
export const TRASH_RETENTION_DAYS = 30

/** 一天的毫秒数（保留期计算用，避免魔法数字散落在函数体里） */
const DAY_MS = 86_400_000

interface Bookmark {
  id: string
  url: string
  title: string
  description: string
  favicon: string
  color: string
  folderId: string
  tags: string[]
  visitCount: number
  lastVisited: string | null
  /** 置顶标记：落盘对象里恒为布尔（旧数据由 utils/schema.ts 的迁移补齐） */
  pinned: boolean
  /**
   * 软删除标记（回收站）。
   *
   * - `null` / 缺失 = **未删除**（正常书签）；
   * - 非空 ISO 字符串 = 删除时刻，记录进入回收站，超过
   *   {@link TRASH_RETENTION_DAYS} 天后由启动清理永久删除；
   *
   * 落盘对象里恒存在该键（旧数据由 utils/schema.ts 的 v3 迁移补 `null`），
   * 但读取侧仍按「缺失 = 未删除」兜底，避免第三方/手工编辑的数据出现意外。
   */
  deletedAt?: string | null
  /**
   * 死链检查结果（可选，缺失 = 从未检查过）。
   *
   * **只由主进程 `check-links`（ipc/links.ts）写入**：`update-bookmark` 与
   * `bulk-update-bookmarks` 的字段白名单里都没有它，渲染层无法改写。
   * `ok: null` = unknown（401/403/429/5xx 等无法判定的情况）。
   *
   * 因为字段可选，旧数据天然兼容，**不需要新的 schema 迁移**。
   */
  linkStatus?: {
    ok: boolean | null
    status: number | null
    checkedAt: string
    error?: string
  }
  createdAt: string
  updatedAt: string
}

const BOOKMARKS_FILE = 'bookmarks.json'
const DEFAULT_COLOR = '#3B82F6'

function getBookmarks(): Bookmark[] {
  return readJsonFile<Bookmark[]>(BOOKMARKS_FILE, [])
}

function saveBookmarks(bookmarks: Bookmark[]): boolean {
  return writeJsonFile(BOOKMARKS_FILE, bookmarks)
}

/* ------------------------------------------------------------------ *
 * 软删除（回收站）判定：全部读路径共用的唯一口径
 * ------------------------------------------------------------------ */

/**
 * 记录是否在回收站里。
 *
 * 只有**非空字符串**才算已删除：`null` / 缺失 / `''` / 其它脏值都视为未删除
 * （「缺失 = 未删除」是数据模型的一部分，不能让一条脏数据把书签藏起来）。
 */
export function isDeleted(bookmark: { deletedAt?: string | null } | null | undefined): boolean {
  if (!bookmark || typeof bookmark !== 'object') return false
  const { deletedAt } = bookmark
  return typeof deletedAt === 'string' && deletedAt !== ''
}

/** 未删除的记录（保序，元素仍是原引用）；纯函数，不改入参。 */
export function activeBookmarks<T extends { deletedAt?: string | null }>(
  list: readonly T[]
): T[] {
  const items = Array.isArray(list) ? list : []
  return items.filter(bookmark => !isDeleted(bookmark))
}

/**
 * 已删除的记录，按 `deletedAt` **倒序**（最近删除的排最前）。
 *
 * 时间不可解析的脏值排在最后（不能因为一条脏数据把整个回收站排序打乱）；
 * 排序稳定，同一毫秒的多条记录保持落盘顺序。纯函数，不改入参。
 */
export function deletedBookmarks<T extends { deletedAt?: string | null }>(
  list: readonly T[]
): T[] {
  const trashed = (Array.isArray(list) ? list : []).filter(bookmark => isDeleted(bookmark))

  const timeOf = (bookmark: { deletedAt?: string | null }): number => {
    const time = Date.parse(String(bookmark.deletedAt))
    return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY
  }

  return trashed
    .map((bookmark, index) => ({ bookmark, index, time: timeOf(bookmark) }))
    .sort((a, b) => b.time - a.time || a.index - b.index)
    .map(entry => entry.bookmark)
}

/**
 * 永久删除这些 id 对应的访问历史。
 *
 * 历史清理失败只记日志：书签已经（软/硬）删除并落盘，不能反过来报「删除失败」。
 * 这里刻意**不**在软删除路径上调用 —— 软删除是可恢复的，历史必须留着
 * （趋势图仍统计回收站里的书签，见 `purgeExpiredTrash` / `purge-bookmarks`）。
 */
function dropHistoryQuietly(ids: readonly string[], reason: string): void {
  try {
    removeBookmarksHistory(ids)
  } catch (error) {
    console.error(`[history] Failed to remove visit history after ${reason}:`, error)
  }
}


/**
 * 只接受字符串，其余（`undefined` / `null` / 数字…）折叠为空串。
 * 这里的「拒收 null」是 B1 的服务端侧防线：`color: null` 落盘会让渲染层的
 * `hex.slice()` 抛 TypeError。
 */
function toSafeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 可空字符串归一化：字符串原样返回，`null` 视为「清空」，其余视为「未提供」 */
function normalizeNullableString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === null) return ''
  return undefined
}

function toSafeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((tag): tag is string => typeof tag === 'string')
}

/**
 * 批量操作的补丁白名单：只有这 5 个字段会生效，写盘之外的任何字段都无法被批量修改。
 *
 * 语义约定（与渲染层 `BulkActionBar` 对齐，改动时两处同步）：
 *  - `folderId: ''` 是**有效值**，表示「未分类」（主进程 delete-folder 也用 '' 表示未分类）；
 *  - `color: ''` 视为「未提供」——颜色不能被批量清空，空串不参与合并；
 *  - `addTags` / `removeTags` 可同时给，先按 id 去重追加、再剔除 removeTags 中的 id。
 */
export interface BulkBookmarkPatch {
  folderId?: string
  color?: string
  pinned?: boolean
  addTags?: string[]
  removeTags?: string[]
}

/** `bulk-update-bookmarks` 的返回：真正落盘的记录 + 未找到的 id（不视为错误）。 */
export interface BulkUpdateResult {
  updated: Bookmark[]
  missing: string[]
}

/** `bulk-delete-bookmarks` 的返回：实际**软删除**条数 + 未找到（或已在回收站）的 id。 */
export interface BulkDeleteResult {
  deleted: number
  missing: string[]
}

/** `restore-bookmarks` 的返回：实际恢复条数 + 未找到的 id + 恢复后的**未删除**列表。 */
export interface RestoreBookmarksResult {
  restored: number
  missing: string[]
  bookmarks: Bookmark[]
}

/** `purge-bookmarks` 的返回：永久删除条数 + 剩余未删除列表 + 剩余回收站列表。 */
export interface PurgeBookmarksResult {
  purged: number
  bookmarks: Bookmark[]
  trashed: Bookmark[]
}

/** `empty-trash` 的返回：永久删除条数 + 剩余未删除列表（回收站必然已清空）。 */
export interface EmptyTrashResult {
  purged: number
  bookmarks: Bookmark[]
}

/** `merge-duplicates` 的返回：合并的组数 + 软删除条数 + 合并后的未删除列表。 */
export interface MergeDuplicatesResult {
  groups: number
  removed: number
  bookmarks: Bookmark[]
}

/** 归一化后的补丁：可空字段用于「未提供」，标签数组恒为去重后的字符串数组 */
interface NormalizedBulkPatch {
  folderId?: string
  color?: string
  pinned?: boolean
  addTags: string[]
  removeTags: string[]
}

/** 只保留字符串并去重（保持首次出现顺序）；非数组、非字符串元素一律丢弃。 */
function dedupeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/** 与 {@link dedupeStrings} 相同，语义上专用于 id 列表（批量通道的第一步） */
function dedupeIds(value: unknown): string[] {
  return dedupeStrings(value)
}

/** {@link filterBookmarksByIds} 的返回：剩余记录 + 实际删除条数 + 未找到的 id。 */
export interface FilterBookmarksResult<T> {
  remaining: T[]
  deleted: number
  missing: string[]
}

/**
 * 「按 id 集合过滤」的**唯一**实现 —— `purge-bookmarks` 用它做永久删除
 * （软删除路径不能移除记录，因此 `bulk-delete-bookmarks` / `merge-duplicates`
 * 改成写 `deletedAt` 后不再调用它）。
 *
 * 纯函数：不读写盘、不改入参（`remaining` 是新数组，元素仍是原引用）。
 * `missing` 只收集「请求了但数据里不存在」的 id（按 `ids` 的首次出现顺序），不视为错误。
 * 重复的 id 先按首次出现去重，因此 `deleted` 统计的是**实际被移除的记录条数**。
 */
export function filterBookmarksByIds<T extends { id: string }>(
  bookmarks: readonly T[],
  ids: readonly string[]
): FilterBookmarksResult<T> {
  const list = Array.isArray(bookmarks) ? bookmarks : []
  const uniqueIds = dedupeStrings(ids)

  if (uniqueIds.length === 0) {
    return { remaining: [...list], deleted: 0, missing: [] }
  }

  const requested = new Set(uniqueIds)
  const existingIds = new Set(list.map(bookmark => bookmark.id))

  const missing = uniqueIds.filter(id => !existingIds.has(id))
  const remaining = list.filter(bookmark => !requested.has(bookmark.id))

  return { remaining, deleted: list.length - remaining.length, missing }
}

/**
 * 白名单 + 类型校验。渲染层可以传来任何东西（preload 不做校验），
 * 这里必须把「类型不对的字段」当成「未提供」，而不是写进数据文件。
 */
function normalizeBulkPatch(patch: unknown): NormalizedBulkPatch {
  const input = (patch && typeof patch === 'object' ? patch : {}) as BulkBookmarkPatch

  const normalized: NormalizedBulkPatch = { addTags: [], removeTags: [] }

  // '' 是「未分类」的有效值，只拒收非字符串
  if (typeof input.folderId === 'string') normalized.folderId = input.folderId
  // 空串无法表达「清除颜色」，只接受非空字符串
  if (typeof input.color === 'string' && input.color !== '') normalized.color = input.color
  // 置顶只认真布尔，脏值视为未提供
  if (typeof input.pinned === 'boolean') normalized.pinned = input.pinned

  normalized.addTags = dedupeStrings(input.addTags)
  normalized.removeTags = dedupeStrings(input.removeTags)

  return normalized
}

/** 归一化后是否还有「任何会改变数据」的内容（空 patch / 空标签数组不算） */
function hasEffectiveChange(patch: NormalizedBulkPatch): boolean {
  return (
    patch.folderId !== undefined ||
    patch.color !== undefined ||
    patch.pinned !== undefined ||
    patch.addTags.length > 0 ||
    patch.removeTags.length > 0
  )
}

/**
 * 把补丁合并进单条记录，返回**新对象**（不原地改，便于把结果直接回传给渲染层）。
 * `updatedAt` 每次都会刷新：批量操作是真实的写操作，必须能在时间维度上被观察到。
 */
function applyBulkPatch(current: Bookmark, patch: NormalizedBulkPatch, now: string): Bookmark {
  const next: Bookmark = { ...current }

  if (patch.folderId !== undefined) next.folderId = patch.folderId
  if (patch.color !== undefined) next.color = patch.color
  if (patch.pinned !== undefined) next.pinned = patch.pinned

  if (patch.addTags.length > 0 || patch.removeTags.length > 0) {
    const baseTags = Array.isArray(current.tags) ? current.tags : []
    const merged: string[] = []
    // 先「去重追加」（顺带修掉脏数据里的重复 id）
    for (const tag of [...baseTags, ...patch.addTags]) {
      if (typeof tag !== 'string') continue
      if (merged.includes(tag)) continue
      merged.push(tag)
    }
    // 再「剔除」（addTags + removeTags 同时给时，以 removeTags 为准）
    next.tags = merged.filter(tag => !patch.removeTags.includes(tag))
  }

  next.updatedAt = now
  return next
}

export function registerBookmarkHandlers(): void {
  /**
   * 主列表：**只返回未删除**的记录（回收站里的记录由 `get-deleted-bookmarks` 提供）。
   *
   * 过滤放在主进程而不是渲染层：`bookmarks` store / 统计 / 搜索 / 侧边栏计数
   * 全都基于这一个返回值，多一处漏过滤就会让「已删除」的书签漏到界面上。
   */
  ipcMain.handle('get-bookmarks', () => {
    return activeBookmarks(getBookmarks())
  })

  /** 回收站列表：只返回已删除的记录，按 `deletedAt` 倒序（最近删除的排最前）。 */
  ipcMain.handle('get-deleted-bookmarks', () => {
    return deletedBookmarks(getBookmarks())
  })

  ipcMain.handle('add-bookmark', (_, bookmarkData: Partial<Bookmark>) => {
    const bookmarks = getBookmarks()
    const now = new Date().toISOString()
    const input: Partial<Bookmark> = bookmarkData && typeof bookmarkData === 'object' ? bookmarkData : {}

    // 显式白名单赋值：默认值最后生效，任何 `undefined` / `null` 都无法覆盖它
    const newBookmark: Bookmark = {
      id: uuidv4(),
      url: toSafeString(input.url),
      title: toSafeString(input.title) || toSafeString(input.url),
      description: toSafeString(input.description),
      favicon: toSafeString(input.favicon),
      color: toSafeString(input.color) || DEFAULT_COLOR,
      folderId: toSafeString(input.folderId),
      tags: toSafeTags(input.tags),
      visitCount: 0,
      lastVisited: null,
      // 只认真布尔：`'true'` / 1 / undefined 一律落成 false
      pinned: input.pinned === true,
      // 新建的书签永远不在回收站里：`deletedAt` 不接受渲染层传入（不能被「顺手复活」）
      deletedAt: null,
      createdAt: now,
      updatedAt: now
    }

    bookmarks.push(newBookmark)

    if (saveBookmarks(bookmarks)) {
      return newBookmark
    }
    throw new Error('Failed to save bookmark')
  })

  ipcMain.handle('update-bookmark', (_, id: string, updates: Partial<Bookmark>) => {
    const bookmarks = getBookmarks()
    // 已删除的记录对写路径不可见：修改一条回收站里的书签视为「未找到」，
    // 而不是「顺手把它复活」（恢复必须显式走 `restore-bookmarks`）。
    const index = bookmarks.findIndex(b => b.id === id && !isDeleted(b))

    if (index === -1) {
      throw new Error('Bookmark not found')
    }

    const current = bookmarks[index]
    const patch: Partial<Bookmark> = updates && typeof updates === 'object' ? updates : {}

    // 同样按字段白名单合并：既不让 `null` 落盘，也不允许改 id/createdAt
    const next: Bookmark = { ...current, updatedAt: new Date().toISOString() }

    const url = normalizeNullableString(patch.url)
    if (url !== undefined) next.url = url

    const title = normalizeNullableString(patch.title)
    if (title !== undefined) next.title = title

    const description = normalizeNullableString(patch.description)
    if (description !== undefined) next.description = description

    const favicon = normalizeNullableString(patch.favicon)
    if (favicon !== undefined) next.favicon = favicon

    const folderId = normalizeNullableString(patch.folderId)
    if (folderId !== undefined) next.folderId = folderId

    const color = normalizeNullableString(patch.color)
    if (color !== undefined) next.color = color || DEFAULT_COLOR

    if (Array.isArray(patch.tags)) {
      next.tags = toSafeTags(patch.tags)
    }

    if (typeof patch.visitCount === 'number' && Number.isFinite(patch.visitCount)) {
      next.visitCount = patch.visitCount
    }

    if (patch.lastVisited === null || typeof patch.lastVisited === 'string') {
      next.lastVisited = patch.lastVisited
    }

    // 置顶只接受布尔；脏值（`'yes'` / 1 / null）视为「未提供」，保持原值不变
    if (typeof patch.pinned === 'boolean') {
      next.pinned = patch.pinned
    }

    bookmarks[index] = next

    if (saveBookmarks(bookmarks)) {
      return next
    }
    throw new Error('Failed to update bookmark')
  })

  /**
   * 单条删除 = **软删除**（进回收站）。
   *
   * - 只写 `deletedAt`（+ `updatedAt`），记录仍留在 `bookmarks.json` 里，可被
   *   `restore-bookmarks` 恢复；
   * - **不再清理访问历史**：软删除是可恢复的，历史必须跟着记录一起留在原地，
   *   否则「恢复后访问次数/趋势图归零」；
   * - 已经删除过的 id 视为「未找到」（重复删除不是有效操作，也不该刷新 `deletedAt`）。
   */
  ipcMain.handle('delete-bookmark', (_, id: string) => {
    const bookmarks = getBookmarks()
    const index = bookmarks.findIndex(b => b.id === id && !isDeleted(b))

    if (index === -1) {
      throw new Error('Bookmark not found')
    }

    const now = new Date().toISOString()
    bookmarks[index] = { ...bookmarks[index], deletedAt: now, updatedAt: now }

    if (saveBookmarks(bookmarks)) {
      return
    }
    throw new Error('Failed to delete bookmark')
  })

  ipcMain.handle('increment-visit-count', (_, id: string) => {
    const bookmarks = getBookmarks()
    // 同 update-bookmark：回收站里的记录不能被「顺手复活」
    const index = bookmarks.findIndex(b => b.id === id && !isDeleted(b))

    if (index === -1) {
      throw new Error('Bookmark not found')
    }

    const current = bookmarks[index]
    // 存量数据里 visitCount 可能缺失/为 null，直接 `+1` 会写出 NaN
    const baseCount = Number.isFinite(current.visitCount) ? current.visitCount : 0
    const now = new Date().toISOString()

    const updated: Bookmark = {
      ...current,
      visitCount: baseCount + 1,
      lastVisited: now,
      updatedAt: now
    }

    bookmarks[index] = updated

    if (saveBookmarks(bookmarks)) {
      // 书签（visitCount/lastVisited）先落盘，再追加一条逐次记录。
      // 两次文件写入是有意的取舍：bookmarks.json 与 history.json 各自原子写，
      // 不做跨文件事务（Electron 侧没有这个能力，实现成本远超收益）。
      // 历史写失败不能让「访问」整体失败 —— 计数已经成功落盘了，
      // 因此这里只记日志，仍然返回更新后的书签。
      try {
        appendVisit(id)
      } catch (error) {
        console.error(`[history] Failed to append visit for bookmark ${id}:`, error)
      }
      return updated
    }
    throw new Error('Failed to update visit count')
  })

  ipcMain.handle('clearAllBookmarks', () => {
    if (saveBookmarks([])) {
      // 「清空全部数据」必须是彻底的：书签没了，历史记录留着全是悬空 id。
      // 与其它两处一致：历史清理失败只记日志，不让已经成功的清空变成失败。
      try {
        clearHistory()
      } catch (error) {
        console.error('[history] Failed to clear visit history:', error)
      }
      return true
    }
    throw new Error('Failed to clear bookmarks')
  })

  /**
   * 批量更新：**一次读 + 一次写**。
   *
   * 渲染层不允许循环调用 `update-bookmark`（每个写操作都会重写整个 JSON，
   * 逐个更新 N 条 = N 次读 + N 次写），因此批量动作必须走这条通道。
   * 空 ids / 空 patch / 全部 id 都不存在时都不写盘（结果里用 `missing` 表达）。
   */
  ipcMain.handle(
    'bulk-update-bookmarks',
    (_, ids: string[], patch: BulkBookmarkPatch): BulkUpdateResult => {
      const uniqueIds = dedupeIds(ids)
      const normalized = normalizeBulkPatch(patch)

      if (uniqueIds.length === 0 || !hasEffectiveChange(normalized)) {
        return { updated: [], missing: [] }
      }

      // ---- 第 1 次（也是唯一一次）读盘 ----
      const bookmarks = getBookmarks()

      // 同一 id 在脏数据里可能出现多次：只改第一条，其余原样保留
      const indexById = new Map<string, number>()
      bookmarks.forEach((bookmark, index) => {
        // 回收站里的记录不参与批量更新：命中它等于「复活」，而复活只能走 restore-bookmarks
        if (isDeleted(bookmark)) return
        if (!indexById.has(bookmark.id)) indexById.set(bookmark.id, index)
      })

      const now = new Date().toISOString()
      const updated: Bookmark[] = []
      const missing: string[] = []

      for (const id of uniqueIds) {
        const index = indexById.get(id)
        if (index === undefined) {
          // 不存在的 id 不是错误：可能已被其它窗口/流程删除
          missing.push(id)
          continue
        }
        const next = applyBulkPatch(bookmarks[index], normalized, now)
        bookmarks[index] = next
        updated.push(next)
      }

      // 没有任何匹配项时也不写盘（避免「只选中了已失效的 id」也重写整个文件）
      if (updated.length === 0) {
        return { updated, missing }
      }

      // ---- 第 2 次（也是唯一一次）写盘 ----
      if (!saveBookmarks(bookmarks)) {
        throw new Error('Failed to bulk update bookmarks')
      }
      return { updated, missing }
    }
  )

  /**
   * 批量删除 = **批量软删除**：**一次读 + 一次写**。
   *
   * - `deleted` 是实际**软删除**的条数（不含不存在、或已经在回收站里的 id），
   *   `missing` 收集这些没有生效的 id；
   * - 只写 `deletedAt` / `updatedAt`，记录仍留在文件里，可被 `restore-bookmarks` 恢复；
   * - **不清历史**（软删除可恢复，历史必须留着）；永久清理在 `purge-bookmarks` /
   *   `empty-trash` / 启动时的 `purgeExpiredTrash` 里做；
   * - 一条都没命中时不写盘（避免「只选中了已失效的 id」也重写整个文件）。
   */
  ipcMain.handle('bulk-delete-bookmarks', (_, ids: string[]): BulkDeleteResult => {
    const uniqueIds = dedupeIds(ids)
    if (uniqueIds.length === 0) {
      return { deleted: 0, missing: [] }
    }

    // ---- 唯一一次读盘 ----
    const bookmarks = getBookmarks()

    // 只对「存在且未删除」的记录生效；同一 id 在脏数据里出现多次时全部一起软删除
    const requested = new Set(uniqueIds)
    const existingActiveIds = new Set<string>()
    const now = new Date().toISOString()
    let deleted = 0

    for (let index = 0; index < bookmarks.length; index += 1) {
      const bookmark = bookmarks[index]
      if (!requested.has(bookmark.id)) continue
      if (isDeleted(bookmark)) continue

      bookmarks[index] = { ...bookmark, deletedAt: now, updatedAt: now }
      deleted += 1
      existingActiveIds.add(bookmark.id)
    }

    const missing = uniqueIds.filter(id => !existingActiveIds.has(id))

    if (deleted === 0) {
      return { deleted: 0, missing }
    }

    // ---- 唯一一次写盘 ----
    if (!saveBookmarks(bookmarks)) {
      throw new Error('Failed to bulk delete bookmarks')
    }

    return { deleted, missing }
  })

  /**
   * 重复书签合并：**一次读 + 一次写**。
   *
   * 计划由 `shared/duplicates.ts` 的纯函数算出（与渲染层预览用的是同一份逻辑），
   * 本通道只做三件事：
   *  1. 唯一一次读盘；
   *  2. 把每个 keeper 的合并字段写回它的位置，并把 donors **软删除**
   *     （写 `deletedAt`，进回收站；记录本身仍留在文件里，因此 keeper 位置与
   *     其余记录顺序都不变）；
   *  3. 唯一一次写盘。
   *
   * 已删除（回收站里）的记录**不参与分组、也不会被合并**：计划层直接跳过它们
   * （见 `shared/duplicates.ts` 的 `groupDuplicates`），因此它们原样留在文件里。
   *
   * 无重复时不写盘（返回原列表），避免一次无意义的整文件重写。
   * 写盘失败统一抛 `Failed to merge duplicate bookmarks`。
   * donors 的访问历史**不清理**：它们只是进了回收站，`restore-bookmarks` 之后
   * 历史必须还在（趋势图仍统计回收站里的书签）。
   */
  ipcMain.handle('merge-duplicates', (): MergeDuplicatesResult => {
    // ---- 唯一一次读盘 ----
    const bookmarks = getBookmarks()
    const plan = planDuplicateMerges(bookmarks, new Date())

    if (plan.duplicateGroups === 0) {
      return { groups: 0, removed: 0, bookmarks: activeBookmarks(bookmarks) }
    }

    const fieldsById = new Map(plan.keepers.map(keeper => [keeper.id, keeper.fields]))
    const donorIds = new Set(plan.donorIds)
    const now = new Date().toISOString()

    // 保序改写：donors 打上 deletedAt（软删除），keepers 写回合并后的字段，
    // 其余记录（含回收站里的）原样保留 —— 数组长度不变，因此下标天然稳定。
    const merged: Bookmark[] = bookmarks.map(bookmark => {
      if (donorIds.has(bookmark.id)) {
        return { ...bookmark, deletedAt: now, updatedAt: now }
      }
      const fields = fieldsById.get(bookmark.id)
      return fields ? { ...bookmark, ...fields } : bookmark
    })

    // ---- 唯一一次写盘 ----
    try {
      if (!saveBookmarks(merged)) {
        throw new Error('saveBookmarks returned false')
      }
    } catch (error) {
      console.error('[bookmarks] Failed to merge duplicate bookmarks:', error)
      throw new Error('Failed to merge duplicate bookmarks')
    }

    return {
      groups: plan.duplicateGroups,
      removed: plan.donorIds.length,
      bookmarks: activeBookmarks(merged)
    }
  })

  /**
   * 从回收站恢复：**一次读 + 一次写**。
   *
   * - 只把 `deletedAt` 置 `null`（并刷新 `updatedAt`），其余字段（`visitCount` /
   *   `tags` / `linkStatus` …）原样保留 —— 软删除从不改写它们；
   * - 不存在、或本来就没删除的 id 计入 `missing`（不视为错误）；
   * - 空 ids / 一条都没恢复时不写盘；
   * - 返回的 `bookmarks` 是恢复后的**未删除**列表，渲染层整体替换本地数组即可。
   */
  ipcMain.handle('restore-bookmarks', (_, ids: string[]): RestoreBookmarksResult => {
    const uniqueIds = dedupeIds(ids)
    if (uniqueIds.length === 0) {
      return { restored: 0, missing: [], bookmarks: activeBookmarks(getBookmarks()) }
    }

    // ---- 唯一一次读盘 ----
    const bookmarks = getBookmarks()
    const requested = new Set(uniqueIds)
    const restoredIds = new Set<string>()
    const now = new Date().toISOString()

    for (let index = 0; index < bookmarks.length; index += 1) {
      const bookmark = bookmarks[index]
      if (!requested.has(bookmark.id)) continue
      if (!isDeleted(bookmark)) continue

      bookmarks[index] = { ...bookmark, deletedAt: null, updatedAt: now }
      restoredIds.add(bookmark.id)
    }

    const missing = uniqueIds.filter(id => !restoredIds.has(id))

    if (restoredIds.size === 0) {
      return { restored: 0, missing, bookmarks: activeBookmarks(bookmarks) }
    }

    // ---- 唯一一次写盘 ----
    if (!saveBookmarks(bookmarks)) {
      throw new Error('Failed to restore bookmarks')
    }

    return { restored: restoredIds.size, missing, bookmarks: activeBookmarks(bookmarks) }
  })

  /**
   * 永久删除指定记录（回收站里的「彻底删除」）：**一次读 + 一次写**。
   *
   * - 命中即从文件里彻底移除（不管它是否在回收站里 —— 这是用户显式的永久删除意图），
   *   返回剩余未删除列表 + 剩余回收站列表，渲染层两边都能整体替换；
   * - 写盘成功后清理这些记录的全部访问历史（失败只记日志：书签已经删掉了，
   *   不能反过来报「删除失败」）；
   * - 空 ids / 一条都没命中时不写盘。
   */
  ipcMain.handle('purge-bookmarks', (_, ids: string[]): PurgeBookmarksResult => {
    const uniqueIds = dedupeIds(ids)
    if (uniqueIds.length === 0) {
      const current = getBookmarks()
      return { purged: 0, bookmarks: activeBookmarks(current), trashed: deletedBookmarks(current) }
    }

    // ---- 唯一一次读盘 ----
    const bookmarks = getBookmarks()
    const { remaining, deleted } = filterBookmarksByIds(bookmarks, uniqueIds)

    if (deleted === 0) {
      return {
        purged: 0,
        bookmarks: activeBookmarks(bookmarks),
        trashed: deletedBookmarks(bookmarks)
      }
    }

    // ---- 唯一一次写盘 ----
    if (!saveBookmarks(remaining)) {
      throw new Error('Failed to purge bookmarks')
    }

    // 记录已经彻底消失：清掉它们的访问历史，避免趋势图继续统计不存在的书签。
    dropHistoryQuietly(uniqueIds, 'purging bookmarks')

    return {
      purged: deleted,
      bookmarks: activeBookmarks(remaining),
      trashed: deletedBookmarks(remaining)
    }
  })

  /**
   * 清空回收站：**一次读 + 一次写**。
   *
   * 永久删除全部已删除记录并清理它们的访问历史；没有回收站记录时不写盘。
   */
  ipcMain.handle('empty-trash', (): EmptyTrashResult => {
    // ---- 唯一一次读盘 ----
    const bookmarks = getBookmarks()
    const trashed = deletedBookmarks(bookmarks)

    if (trashed.length === 0) {
      return { purged: 0, bookmarks: activeBookmarks(bookmarks) }
    }

    const remaining = activeBookmarks(bookmarks)

    // ---- 唯一一次写盘 ----
    if (!saveBookmarks(remaining)) {
      throw new Error('Failed to empty trash')
    }

    dropHistoryQuietly(
      trashed.map(bookmark => bookmark.id),
      'emptying trash'
    )

    return { purged: trashed.length, bookmarks: remaining }
  })
}

/**
 * 启动时的回收站清理：永久删除 `deletedAt` 超过 {@link TRASH_RETENTION_DAYS} 天的记录。
 *
 * 由 `electron/main.ts` 在**数据迁移之后、注册 IPC/建窗之前**调用：
 * 迁移保证了 `deletedAt` 字段存在，建窗之前清理保证界面第一次读到的数据就是干净的。
 *
 * - 边界：正好 30 天**不算**过期（用 `<` 而不是 `<=`），与历史保留窗口的口径一致；
 * - `deletedAt` 无法解析的脏值**保留**（无法判定年龄时宁可不删，用户还能手动清理）；
 * - 一条都不过期时不写盘；
 * - 写盘成功后清理这些记录的访问历史（失败只记日志）。
 *
 * 返回 `{ purged }` 供调用方打日志；失败会抛出，由调用方决定是否中断启动。
 */
export function purgeExpiredTrash(now: number = Date.now()): { purged: number } {
  const bookmarks = getBookmarks()
  const cutoff = now - TRASH_RETENTION_DAYS * DAY_MS
  const expiredIds = new Set<string>()

  for (const bookmark of bookmarks) {
    if (!isDeleted(bookmark)) continue
    const deletedAt = Date.parse(String(bookmark.deletedAt))
    if (!Number.isFinite(deletedAt)) continue
    if (deletedAt < cutoff) expiredIds.add(bookmark.id)
  }

  if (expiredIds.size === 0) {
    return { purged: 0 }
  }

  const remaining = bookmarks.filter(bookmark => !expiredIds.has(bookmark.id))
  if (!saveBookmarks(remaining)) {
    throw new Error('Failed to purge expired trash')
  }

  dropHistoryQuietly([...expiredIds], 'purging expired trash')

  return { purged: expiredIds.size }
}

