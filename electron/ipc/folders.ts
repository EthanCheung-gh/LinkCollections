import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { readJsonFile, writeJsonFile } from '../utils/storage'

interface Folder {
  id: string
  name: string
  icon: string | null
  color: string
  createdAt: string
  order: number
}

interface Bookmark {
  id: string
  folderId: string
}

const FOLDERS_FILE = 'folders.json'
const BOOKMARKS_FILE = 'bookmarks.json'

function getFolders(): Folder[] {
  return readJsonFile<Folder[]>(FOLDERS_FILE, [])
}

function saveFolders(folders: Folder[]): boolean {
  return writeJsonFile(FOLDERS_FILE, folders)
}

function getBookmarks(): Bookmark[] {
  return readJsonFile<Bookmark[]>(BOOKMARKS_FILE, [])
}

function saveBookmarks(bookmarks: Bookmark[]): boolean {
  return writeJsonFile(BOOKMARKS_FILE, bookmarks)
}

export function registerFolderHandlers(): void {
  ipcMain.handle('get-folders', () => {
    return getFolders()
  })

  ipcMain.handle('add-folder', (_, folderData: Partial<Folder>) => {
    const folders = getFolders()
    const now = new Date().toISOString()
    const maxOrder = folders.length > 0 ? Math.max(...folders.map(f => f.order)) : 0

    const newFolder: Folder = {
      id: uuidv4(),
      name: folderData.name || 'New Folder',
      icon: folderData.icon || null,
      color: folderData.color || '#3B82F6',
      createdAt: now,
      order: maxOrder + 1
    }

    folders.push(newFolder)
    if (saveFolders(folders)) {
      return newFolder
    }
    throw new Error('Failed to save folder')
  })

  ipcMain.handle('delete-folder', (_, id: string) => {
    const folders = getFolders()
    const filtered = folders.filter(f => f.id !== id)

    if (filtered.length === folders.length) {
      throw new Error('Folder not found')
    }

    // 先清理书签里的引用，再删除文件夹：若任一步写入失败，都不会留下
    // 「书签指向已不存在的文件夹」的悬空 folderId（写入顺序保证可安全重试）
    const bookmarks = getBookmarks()
    const updatedBookmarks = bookmarks.map(b => (b.folderId === id ? { ...b, folderId: '' } : b))

    if (!saveBookmarks(updatedBookmarks)) {
      throw new Error('Failed to update bookmarks')
    }

    if (!saveFolders(filtered)) {
      throw new Error('Failed to delete folder')
    }

    return
  })

  ipcMain.handle('update-folder', (_, id: string, updates: Partial<Folder>) => {
    const folders = getFolders()
    const index = folders.findIndex(f => f.id === id)

    if (index === -1) {
      throw new Error('Folder not found')
    }

    const current = folders[index]
    const patch: Partial<Folder> = updates && typeof updates === 'object' ? updates : {}

    // C15（同类）：按字段白名单合并，`id` / `createdAt` / `order` 不被渲染层改写，
    // 也不再允许把 name/color 覆盖成 undefined（旧写法 `...updates` 会这样）。
    const updatedFolder: Folder = { ...current }
    if (typeof patch.name === 'string' && patch.name) {
      updatedFolder.name = patch.name
    }
    if (typeof patch.color === 'string' && patch.color) {
      updatedFolder.color = patch.color
    }
    if (typeof patch.icon === 'string' || patch.icon === null) {
      updatedFolder.icon = patch.icon
    }

    folders[index] = updatedFolder

    if (!saveFolders(folders)) {
      throw new Error('Failed to update folder')
    }

    return updatedFolder
  })

  ipcMain.handle('clearAllFolders', () => {
    // 同上：先清空书签引用，再清空文件夹列表
    const bookmarks = getBookmarks()
    const updatedBookmarks = bookmarks.map(b => ({ ...b, folderId: '' }))

    if (!saveBookmarks(updatedBookmarks)) {
      throw new Error('Failed to update bookmarks')
    }

    if (!saveFolders([])) {
      throw new Error('Failed to clear folders')
    }

    return true
  })
}
