import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { readJsonFile, writeJsonFile } from '../utils/storage'

interface Tag {
  id: string
  name: string
  color: string
  createdAt: string
}

interface Bookmark {
  id: string
  tags: string[]
}

const TAGS_FILE = 'tags.json'
const BOOKMARKS_FILE = 'bookmarks.json'
const DEFAULT_COLOR = '#3B82F6'

/**
 * 只接受字符串，其余（`undefined` / `null` / 数字…）折叠为空串。
 * 默认值由调用方在 `||` 之后补，确保入参永远无法覆盖主进程的默认值。
 */
function toSafeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getTags(): Tag[] {
  return readJsonFile<Tag[]>(TAGS_FILE, [])
}

function saveTags(tags: Tag[]): boolean {
  return writeJsonFile(TAGS_FILE, tags)
}

function getBookmarks(): Bookmark[] {
  return readJsonFile<Bookmark[]>(BOOKMARKS_FILE, [])
}

function saveBookmarks(bookmarks: Bookmark[]): boolean {
  return writeJsonFile(BOOKMARKS_FILE, bookmarks)
}

export function registerTagHandlers(): void {
  ipcMain.handle('get-tags', () => {
    return getTags()
  })

  ipcMain.handle('add-tag', (_, tagData: Partial<Tag>) => {
    const tags = getTags()
    const now = new Date().toISOString()
    const input: Partial<Tag> = tagData && typeof tagData === 'object' ? tagData : {}

    // C15：显式白名单赋值（与 ipc/bookmarks.ts 的 add-bookmark 同风格）。
    // 旧写法末尾有 `...tagData`，渲染层传 `{ id: undefined }` 时会把主进程生成的 id
    // 覆盖成 undefined 并落盘，产生无法编辑/删除的坏记录。
    const newTag: Tag = {
      id: uuidv4(),
      name: toSafeString(input.name) || 'New Tag',
      color: toSafeString(input.color) || DEFAULT_COLOR,
      createdAt: now
    }

    tags.push(newTag)
    if (saveTags(tags)) {
      return newTag
    }
    throw new Error('Failed to save tag')
  })

  ipcMain.handle('delete-tag', (_, id: string) => {
    const tags = getTags()
    const filtered = tags.filter(t => t.id !== id)

    if (filtered.length === tags.length) {
      throw new Error('Tag not found')
    }

    // 先清理书签里的标签引用，再删除标签：任一步写入失败都不会留下
    // 「书签引用已不存在的标签」的悬空引用（会显示为 Unknown 标签）
    const bookmarks = getBookmarks()
    const updatedBookmarks = bookmarks.map(b => ({
      ...b,
      tags: b.tags.filter(tagId => tagId !== id)
    }))

    if (!saveBookmarks(updatedBookmarks)) {
      throw new Error('Failed to update bookmarks')
    }

    if (!saveTags(filtered)) {
      throw new Error('Failed to delete tag')
    }

    return
  })

  ipcMain.handle('update-tag', (_, id: string, updates: Partial<Tag>) => {
    const tags = getTags()
    const index = tags.findIndex(t => t.id === id)

    if (index === -1) {
      throw new Error('Tag not found')
    }

    const current = tags[index]
    const patch: Partial<Tag> = updates && typeof updates === 'object' ? updates : {}

    // C15（同类）：同样按字段白名单合并，`id` / `createdAt` 不允许被渲染层改写，
    // 也不允许把 name/color 更新成 undefined 或非字符串。
    const updatedTag: Tag = { ...current }
    if (typeof patch.name === 'string') {
      updatedTag.name = patch.name
    }
    if (typeof patch.color === 'string' && patch.color) {
      updatedTag.color = patch.color
    }

    tags[index] = updatedTag

    if (!saveTags(tags)) {
      throw new Error('Failed to update tag')
    }

    return updatedTag
  })

  ipcMain.handle('clearAllTags', () => {
    // 同上：先清空书签里的标签引用，再清空标签列表
    const bookmarks = getBookmarks()
    const updatedBookmarks = bookmarks.map(b => ({ ...b, tags: [] }))

    if (!saveBookmarks(updatedBookmarks)) {
      throw new Error('Failed to update bookmarks')
    }

    if (!saveTags([])) {
      throw new Error('Failed to clear tags')
    }

    return true
  })
}
