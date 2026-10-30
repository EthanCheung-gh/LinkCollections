import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { readJsonFile, writeJsonFile } from '../utils/storage'
// 访问历史与书签写在两个文件里：这里**直接调用函数**而不是走 IPC，
// 避免主进程自己 invoke 自己的通道（多一层序列化，且错误语义会被 wrap 成字符串）。
import { appendVisit, clearHistory, removeBookmarkHistory, removeBookmarksHistory } from './history'

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

/** `bulk-delete-bookmarks` 的返回：实际删除条数 + 未找到的 id。 */
export interface BulkDeleteResult {
  deleted: number
  missing: string[]
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
  ipcMain.handle('get-bookmarks', () => {
    return getBookmarks()
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
    const index = bookmarks.findIndex(b => b.id === id)

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

  ipcMain.handle('delete-bookmark', (_, id: string) => {
    const bookmarks = getBookmarks()
    const filtered = bookmarks.filter(b => b.id !== id)

    if (filtered.length === bookmarks.length) {
      throw new Error('Bookmark not found')
    }

    if (saveBookmarks(filtered)) {
      // 书签已删除：同步删掉它的全部访问历史，避免悬空 id 继续被趋势图统计。
      // 历史清理失败只记日志 —— 书签已经删掉了，不能反过来报「删除失败」。
      try {
        removeBookmarkHistory(id)
      } catch (error) {
        console.error(`[history] Failed to remove visit history for bookmark ${id}:`, error)
      }
      return
    }
    throw new Error('Failed to delete bookmark')
  })

  ipcMain.handle('increment-visit-count', (_, id: string) => {
    const bookmarks = getBookmarks()
    const index = bookmarks.findIndex(b => b.id === id)

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
   * 批量删除：**一次读 + 一次写**。
   * `deleted` 是实际删除条数（不含不存在的 id），`missing` 收集未找到的 id。
   */
  ipcMain.handle('bulk-delete-bookmarks', (_, ids: string[]): BulkDeleteResult => {
    const uniqueIds = dedupeIds(ids)
    if (uniqueIds.length === 0) {
      return { deleted: 0, missing: [] }
    }

    // ---- 唯一一次读盘 ----
    const bookmarks = getBookmarks()
    const requested = new Set(uniqueIds)
    const existingIds = new Set(bookmarks.map(bookmark => bookmark.id))

    const missing = uniqueIds.filter(id => !existingIds.has(id))
    const remaining = bookmarks.filter(bookmark => !requested.has(bookmark.id))
    const deleted = bookmarks.length - remaining.length

    if (deleted === 0) {
      return { deleted: 0, missing }
    }

    // ---- 唯一一次写盘 ----
    if (!saveBookmarks(remaining)) {
      throw new Error('Failed to bulk delete bookmarks')
    }

    // 清理这些书签的访问历史（一次读写），否则趋势图会继续统计已删除的书签。
    // 历史清理失败不应让批量删除整体失败。
    try {
      removeBookmarksHistory([...requested])
    } catch (error) {
      console.error('[bookmarks] Failed to clean visit history after bulk delete:', error)
    }

    return { deleted, missing }
  })
}
