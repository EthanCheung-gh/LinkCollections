import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { readJsonFile, writeJsonFile } from '../utils/storage'

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
      return updated
    }
    throw new Error('Failed to update visit count')
  })

  ipcMain.handle('clearAllBookmarks', () => {
    if (saveBookmarks([])) {
      return true
    }
    throw new Error('Failed to clear bookmarks')
  })
}
