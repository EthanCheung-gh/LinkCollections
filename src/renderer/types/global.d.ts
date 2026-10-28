/**
 * `window.electronAPI` 的类型契约。
 *
 * 必须与 `electron/preload.ts` 暴露的 21 个方法**逐一对应**（审计 H4 结论：21/21 通道已匹配）：
 * openBrowser / getBookmarks / addBookmark / updateBookmark / deleteBookmark /
 * incrementVisitCount / clearAllBookmarks / getFolders / addFolder / updateFolder /
 * deleteFolder / clearAllFolders / getTags / addTag / updateTag / deleteTag /
 * clearAllTags / getSettings / updateSettings / exportData / importData
 *
 * 返回值均以对应 `ipcMain.handle` 的实际返回值为准；失败时主进程 `throw`，
 * 渲染进程侧表现为 rejected Promise（不是 `{ success: false }`）。
 */
import type { Bookmark, Folder, Tag, Settings } from './index'

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

export interface ElectronAPI {
  /** `open-browser`：失败可能 reject（主进程校验/启动失败）。 */
  openBrowser: (url: string, browserPath?: string) => Promise<void>
  getBookmarks: () => Promise<Bookmark[]>
  addBookmark: (bookmark: Partial<Bookmark>) => Promise<Bookmark>
  updateBookmark: (id: string, bookmark: Partial<Bookmark>) => Promise<Bookmark>
  deleteBookmark: (id: string) => Promise<void>
  /** `increment-visit-count`：返回更新后的书签（含新的 visitCount/lastVisited）。 */
  incrementVisitCount: (id: string) => Promise<Bookmark>
  /** `clearAllBookmarks`：成功恒为 `true`，失败 reject。 */
  clearAllBookmarks: () => Promise<boolean>
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
