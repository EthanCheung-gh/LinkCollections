/**
 * `window.electronAPI` 的类型契约。
 *
 * 必须与 `electron/preload.ts` 暴露的 25 个方法**逐一对应**：
 * openBrowser / getBookmarks / addBookmark / updateBookmark / deleteBookmark /
 * bulkUpdateBookmarks / bulkDeleteBookmarks /
 * incrementVisitCount / clearAllBookmarks / getVisitHistory / clearVisitHistory /
 * getFolders / addFolder / updateFolder /
 * deleteFolder / clearAllFolders / getTags / addTag / updateTag / deleteTag /
 * clearAllTags / getSettings / updateSettings / exportData / importData
 *
 * 返回值均以对应 `ipcMain.handle` 的实际返回值为准；失败时主进程 `throw`，
 * 渲染进程侧表现为 rejected Promise（不是 `{ success: false }`）。
 */
import type { Bookmark, Folder, Tag, Settings, VisitRecord } from './index'

/** `ipcMain.handle('export-data')` 的返回：用户取消时 `canceled: true` 且无 `filePath`。 */
export interface ExportResult {
  success: boolean
  canceled?: boolean
  filePath?: string
}

/**
 * `ipcMain.handle('import-data')` 的返回。
 *
 * `imported` 仅在 `success === true` 时存在：用户取消 / 失败的分支返回
 * `{ success: false, canceled: true }`，因此这里是可选字段。
 */
export interface ImportResult {
  success: boolean
  canceled?: boolean
  imported?: {
    bookmarks: number
    folders: number
    tags: number
  }
}

/**
 * `bulk-update-bookmarks` 的补丁契约（与 `electron/ipc/bookmarks.ts` 的
 * `BulkBookmarkPatch` **字段一致但不跨端 import**：主进程与渲染层各自持有定义，
 * 避免渲染层把 electron 侧代码打进 bundle）。
 *
 * `folderId: ''` 是有效值（= 未分类）；`color: ''` 视为未提供（不能批量清空颜色）。
 */
export interface BulkBookmarkPatch {
  folderId?: string
  color?: string
  pinned?: boolean
  addTags?: string[]
  removeTags?: string[]
}

/** `bulk-update-bookmarks` 的返回：真正改动的记录 + 未找到的 id（不视为错误）。 */
export interface BulkUpdateBookmarksResult {
  updated: Bookmark[]
  missing: string[]
}

/** `bulk-delete-bookmarks` 的返回：实际删除条数 + 未找到的 id。 */
export interface BulkDeleteBookmarksResult {
  deleted: number
  missing: string[]
}

export interface ElectronAPI {
  /** `open-browser`：失败可能 reject（主进程校验/启动失败）。 */
  openBrowser: (url: string, browserPath?: string) => Promise<void>
  getBookmarks: () => Promise<Bookmark[]>
  addBookmark: (bookmark: Partial<Bookmark>) => Promise<Bookmark>
  updateBookmark: (id: string, bookmark: Partial<Bookmark>) => Promise<Bookmark>
  deleteBookmark: (id: string) => Promise<void>
  /**
   * `bulk-update-bookmarks`：一次 IPC 完成 N 条更新（主进程一次读 + 一次写）。
   * 空 ids / 空 patch 时返回 `{ updated: [], missing: [] }` 且不写盘。
   */
  bulkUpdateBookmarks: (
    ids: string[],
    patch: BulkBookmarkPatch
  ) => Promise<BulkUpdateBookmarksResult>
  /** `bulk-delete-bookmarks`：`deleted` 为实际删除条数，`missing` 为未找到的 id。 */
  bulkDeleteBookmarks: (ids: string[]) => Promise<BulkDeleteBookmarksResult>
  /** `increment-visit-count`：返回更新后的书签（含新的 visitCount/lastVisited）。 */
  incrementVisitCount: (id: string) => Promise<Bookmark>
  /** `clearAllBookmarks`：成功恒为 `true`，失败 reject。 */
  clearAllBookmarks: () => Promise<boolean>
  /**
   * `get-visit-history`：逐次访问记录（**未聚合**，按落盘顺序）。
   * 已由主进程过滤脏元素，且只包含 90 天 / 5000 条以内的数据。
   */
  getVisitHistory: () => Promise<VisitRecord[]>
  /** `clear-visit-history`：成功恒为 `true`，失败 reject。 */
  clearVisitHistory: () => Promise<boolean>
  getFolders: () => Promise<Folder[]>
  addFolder: (folder: Partial<Folder>) => Promise<Folder>
  updateFolder: (id: string, updates: Partial<Folder>) => Promise<Folder>
  deleteFolder: (id: string) => Promise<void>
  /** `clearAllFolders`：成功后已存在书签的 `folderId` 被置为 `''`。 */
  clearAllFolders: () => Promise<boolean>
  getTags: () => Promise<Tag[]>
  addTag: (tag: Partial<Tag>) => Promise<Tag>
  updateTag: (id: string, updates: Partial<Tag>) => Promise<Tag>
  deleteTag: (id: string) => Promise<void>
  /** `clearAllTags`：成功后已存在书签的 `tags` 被清空。 */
  clearAllTags: () => Promise<boolean>
  getSettings: () => Promise<Settings>
  updateSettings: (settings: Partial<Settings>) => Promise<Settings>
  exportData: (format: 'json' | 'html') => Promise<ExportResult>
  importData: (format: 'json' | 'html', mergeMode: 'replace' | 'merge') => Promise<ImportResult>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
