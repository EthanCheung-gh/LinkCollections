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
  /** 父文件夹 id；缺失 / `null` / `''` 都表示顶层（旧数据兼容，字段保持可选） */
  parentId?: string | null
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

/**
 * 统一父级语义：`''` / `null` / `undefined` / 纯空白 → `null`（顶层），
 * 其余 trim 后作为父级 id 返回。旧数据没有 `parentId` 字段，因此入参按 unknown 处理。
 */
function normalizeParentId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function collectFolderIds(folders: Folder[]): Set<string> {
  const ids = new Set<string>()
  folders.forEach(folder => {
    if (folder && typeof folder.id === 'string') ids.add(folder.id)
  })
  return ids
}

/**
 * 父级「必须在已有文件夹里」时使用：未知 id（含已被删除的）一律存 `null`（顶层）。
 * 与 add-folder 的约定一致——旧数据 / 过期渲染层不应让整批写入失败。
 */
function resolveKnownParentId(folders: Folder[], value: unknown): string | null {
  const parentId = normalizeParentId(value)
  if (parentId === null) return null
  return collectFolderIds(folders).has(parentId) ? parentId : null
}

/**
 * 收集 `id` 的全部后代 id（**不含**自身），用于 update-folder 的防环校验。
 * 用显式栈 + visited 集合遍历，脏数据里的环 / 重复 id 不会造成死循环。
 */
function collectDescendantIds(folders: Folder[], id: string): Set<string> {
  const childrenByParent = new Map<string, string[]>()
  folders.forEach(folder => {
    if (!folder || typeof folder.id !== 'string') return
    const parentId = normalizeParentId(folder.parentId)
    if (parentId === null) return
    const siblings = childrenByParent.get(parentId)
    if (siblings) {
      siblings.push(folder.id)
    } else {
      childrenByParent.set(parentId, [folder.id])
    }
  })

  const descendants = new Set<string>()
  const stack = [...(childrenByParent.get(id) || [])]
  while (stack.length > 0) {
    const current = stack.pop() as string
    if (current === id || descendants.has(current)) continue
    descendants.add(current)
    const children = childrenByParent.get(current)
    if (children) stack.push(...children)
  }
  return descendants
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
      order: maxOrder + 1,
      // 父级：接受渲染层传入的 parentId；指向不存在的文件夹时存 null（不抛错，
      // 避免旧数据 / 过期渲染层让整批新增失败）。id/createdAt/order 仍只由主进程生成。
      parentId: resolveKnownParentId(folders, folderData?.parentId)
    }

    folders.push(newFolder)
    if (saveFolders(folders)) {
      return newFolder
    }
    throw new Error('Failed to save folder')
  })

  ipcMain.handle('delete-folder', (_, id: string) => {
    const folders = getFolders()
    const target = folders.find(f => f.id === id)

    if (!target) {
      throw new Error('Folder not found')
    }

    // 子文件夹「上提」而非级联删除：直接子级的 parentId 改为被删文件夹的 parentId
    // （顶层则改为 null）。若被删文件夹的父级本身已不存在（脏数据孤儿），
    // 退化为顶层，避免把孤儿引用原样传给下一层。
    const remainingFolders = folders.filter(f => f.id !== id)
    const remainingIds = collectFolderIds(remainingFolders)
    const targetParentId = normalizeParentId(target.parentId)
    const promotedParentId =
      targetParentId !== null && targetParentId !== id && remainingIds.has(targetParentId)
        ? targetParentId
        : null

    const updatedFolders = remainingFolders.map(folder =>
      normalizeParentId(folder.parentId) === id
        ? { ...folder, parentId: promotedParentId }
        : folder
    )

    // 写入顺序：先清理书签引用（置 ''），再写回「上提 + 删除」后的文件夹列表。
    // 若第一步成功、第二步失败，第一步是幂等的，重试后不会留下
    // 「书签指向已不存在的文件夹」的悬空 folderId（写入顺序保证可安全重试）
    const bookmarks = getBookmarks()
    const updatedBookmarks = bookmarks.map(b => (b.folderId === id ? { ...b, folderId: '' } : b))

    if (!saveBookmarks(updatedBookmarks)) {
      throw new Error('Failed to update bookmarks')
    }

    if (!saveFolders(updatedFolders)) {
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
    // 白名单新增 parentId：`string` 表示挂到该父级（`''` 视作顶层），`null` 表示顶层。
    // 防环校验：父级不得是自身，也不得是自身的任一后代（先算后代集合再判断）。
    // 指向不存在的文件夹时按顶层处理，与 add-folder 保持一致。
    if (typeof patch.parentId === 'string' || patch.parentId === null) {
      const requestedParentId = normalizeParentId(patch.parentId)
      if (requestedParentId !== null) {
        if (requestedParentId === id) {
          throw new Error('Invalid parent folder')
        }
        if (collectDescendantIds(folders, id).has(requestedParentId)) {
          throw new Error('Invalid parent folder')
        }
      }
      updatedFolder.parentId = resolveKnownParentId(folders, requestedParentId)
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
