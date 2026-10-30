/**
 * `window.electronAPI` 的类型契约。
 *
 * 必须与 `electron/preload.ts` 暴露的 35 + 5 + 2 = **42** 个方法**逐一对应**：
 * openBrowser / getBookmarks / addBookmark / updateBookmark / deleteBookmark /
 * bulkUpdateBookmarks / bulkDeleteBookmarks / getDeletedBookmarks /
 * restoreBookmarks / purgeBookmarks / emptyTrash / mergeDuplicates / checkLinks /
 * incrementVisitCount / clearAllBookmarks / getVisitHistory / clearVisitHistory /
 * getFolders / addFolder / updateFolder /
 * deleteFolder / clearAllFolders / getTags / addTag / updateTag / deleteTag /
 * clearAllTags / getSettings / updateSettings / exportData / importData /
 * closeQuickAdd / notifyBookmarksChanged / onBookmarksChanged / onTrayOpenView /
 * getUpdateStatus / checkForUpdates / downloadUpdate / installUpdate / onUpdateStatus /
 * detectBrowserBookmarks / importBrowserBookmarks
 *
 * 返回值均以对应 `ipcMain.handle` 的实际返回值为准；失败时主进程 `throw`，
 * 渲染进程侧表现为 rejected Promise（不是 `{ success: false }`）。
 *
 * 例外是「自动更新」的 5 个方法：它们**恒 resolve**，失败通过
 * `UpdaterActionResult.success === false` 表达（更新失败是常态，不该让调用方 try/catch）。
 *
 * 后 4 个是「系统托盘 + 快速添加浮窗」引入的：
 * - `closeQuickAdd` / `notifyBookmarksChanged`：invoke，无返回值；
 * - `onBookmarksChanged` / `onTrayOpenView`：订阅式，返回**取消订阅函数**（不是 Promise）。
 *
 * 最后 5 个是「自动更新」引入的（4 invoke + 1 订阅式）。
 *
 * 新增 2 个是「浏览器书签直读」引入的（均为 invoke，无订阅式）：
 * - `detectBrowserBookmarks` / `importBrowserBookmarks`，返回体类型定义在
 *   `electron/ipc/browser-import.ts`（主进程是唯一来源），这里转出。同样只能用 `import type`。
 */
import type { Bookmark, Folder, LinkStatus, Tag, Settings, VisitRecord } from './index'
import type {
  UpdaterActionResult,
  UpdateState,
  UpdateStatus,
  UpdateStatusSnapshot
} from '../../../electron/updater'
import type {
  BrowserBookmarkCandidate,
  BrowserBookmarkDetection,
  BrowserBookmarkImportResult
} from '../../../electron/ipc/browser-import'

/**
 * 更新状态机与相关返回值的类型**定义在 `electron/updater.ts`**（单一来源：
 * 主进程状态机与渲染层展示必须严格同一份形状），这里转出，便于渲染层只看 `types/global`。
 *
 * 注意：只能用 `import type`。渲染层绝不能把 `electron/updater.ts` 的**运行期代码**
 * 打进 bundle（它会 require('electron') 与 'electron-updater'）。
 */
export type { UpdaterActionResult, UpdateState, UpdateStatus, UpdateStatusSnapshot }

/**
 * `Bookmark.linkStatus` 的形状定义在 `types/bookmark.ts`（与字段所有者放在一起），
 * 这里转出，便于 IPC 契约的消费方从同一个入口引用。
 */
export type { LinkStatus }

/**
 * 浏览器书签直读的返回体（定义在 `electron/ipc/browser-import.ts`，这里转出）。
 *
 * `BrowserBookmarkCandidate.path` 只用于**展示**和原样回传；渲染层不得据此推导逻辑
 * （主进程只接受本次探测白名单里的路径）。
 */
export type { BrowserBookmarkCandidate, BrowserBookmarkDetection, BrowserBookmarkImportResult }

/**
 * `ipcMain.handle('check-links')` 的返回。
 *
 * `bookmarks` 只包含**本次实际检查过**的记录（已带新的 `linkStatus`），
 * 渲染层按 id 替换本地记录即可（与 `bulk-update-bookmarks` 的 `updated` 同语义）。
 */
export interface LinkCheckResult {
  checked: number
  broken: number
  unknown: number
  ok: number
  bookmarks: Bookmark[]
}

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

/** `bulk-delete-bookmarks` 的返回：实际**软删除**条数 + 未找到（或已在回收站）的 id。 */
export interface BulkDeleteBookmarksResult {
  deleted: number
  missing: string[]
}

/**
 * `restore-bookmarks` 的返回：实际恢复条数 + 未找到的 id + **恢复后的未删除列表**。
 *
 * `bookmarks` 是全量快照，渲染层据此整体替换本地数组；回收站列表另由
 * `getDeletedBookmarks()` 重新拉取（恢复后那几条就不在里面了）。
 */
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

/**
 * `merge-duplicates` 的返回：合并的组数 + 软删除（进回收站）的条数 + **未删除列表**。
 *
 * `bookmarks` 是全量快照，渲染层据此整体替换本地数组（比按 id 增量合并更可靠：
 * donors 消失、keeper 字段被改写，两者一次到位）。
 */
export interface MergeDuplicatesResult {
  groups: number
  removed: number
  bookmarks: Bookmark[]
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
  /** `bulk-delete-bookmarks`：`deleted` 为实际软删除条数，`missing` 为未找到的 id。 */
  bulkDeleteBookmarks: (ids: string[]) => Promise<BulkDeleteBookmarksResult>
  /** `get-deleted-bookmarks`：回收站列表（只含已删除记录，按 `deletedAt` 倒序）。 */
  getDeletedBookmarks: () => Promise<Bookmark[]>
  /**
   * `restore-bookmarks`：把 `deletedAt` 置 null（一次 IPC = 主进程一次读 + 一次写）。
   * 不存在 / 本来未删除的 id 计入 `missing`（不报错）。
   */
  restoreBookmarks: (ids: string[]) => Promise<RestoreBookmarksResult>
  /** `purge-bookmarks`：**永久**删除并清理访问历史（不可恢复）。 */
  purgeBookmarks: (ids: string[]) => Promise<PurgeBookmarksResult>
  /** `empty-trash`：永久删除全部回收站记录并清理其访问历史。 */
  emptyTrash: () => Promise<EmptyTrashResult>
  /**
   * `merge-duplicates`：合并重复书签（一次 IPC = 主进程一次读 + 一次写）。
   * 无重复时主进程不写盘，直接返回 `{ groups: 0, removed: 0, bookmarks }`。
   */
  mergeDuplicates: () => Promise<MergeDuplicatesResult>
  /**
   * `check-links`：死链检查。省略 `ids` = 检查全部书签。
   * 主进程一次读盘 + 一次写盘并返回汇总；目标为空时返回全 0 且不写盘。
   */
  checkLinks: (ids?: string[]) => Promise<LinkCheckResult>
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
  /**
   * `detect-browser-bookmarks`：探测本机 Chromium 家族（Chrome / Edge / Brave / Chromium）
   * 的书签文件。恒 resolve —— 没装某个浏览器、目录无权限、文件损坏都只是「少一个候选」。
   *
   * 只覆盖 Chromium：Firefox（`places.sqlite`）与 Safari（二进制 plist）
   * 请让用户先「导出 HTML」再走 `importData('html', …)`。
   */
  detectBrowserBookmarks: () => Promise<BrowserBookmarkDetection>
  /**
   * `import-browser-bookmarks`：导入一个**本次探测到**的书签文件（`path` 原样回传自候选）。
   *
   * 主进程会拒绝不在探测白名单里的路径，并在读取前复核「是文件且 < 20MB」。
   * `mergeMode` 省略/非法时按 `merge` 处理；返回体与 `importData` 一致。
   */
  importBrowserBookmarks: (request: {
    path: string
    mergeMode: 'replace' | 'merge'
  }) => Promise<BrowserBookmarkImportResult>
  /**
   * `close-quick-add`：隐藏快速添加浮窗（**不销毁**）。
   *
   * 无返回值的语义是「请求已受理」，不代表窗口已经关闭（浮窗下次呼出仍是同一个渲染进程）。
   */
  closeQuickAdd: () => Promise<void>
  /**
   * `notify-bookmarks-changed`：让主进程向**除本窗口外**的所有窗口广播 `bookmarks-changed`。
   *
   * 快速添加浮窗保存成功后调用；主窗口收到广播后重新拉取书签列表。
   */
  notifyBookmarksChanged: () => Promise<void>
  /**
   * 订阅「书签数据已变更」广播。
   *
   * @returns 取消订阅函数 —— 组件卸载时必须调用（`ipcRenderer.on` 的监听不会随组件销毁自动移除）。
   */
  onBookmarksChanged: (listener: () => void) => () => void
  /**
   * 订阅托盘「统计 / 设置」请求。主进程只表达意图，实际切页由 `uiStore.setCurrentView` 完成。
   *
   * @returns 取消订阅函数（同上）。
   */
  onTrayOpenView: (listener: (view: 'stats' | 'settings') => void) => () => void
  /**
   * `get-update-status`：更新状态快照 + 当前版本 + 是否支持自动更新（打包环境）。
   *
   * 恒 resolve：未打包时就是 `{ state: 'disabled', enabled: false }`。
   */
  getUpdateStatus: () => Promise<UpdateStatusSnapshot>
  /**
   * `check-for-updates`：手动检查更新。
   *
   * 用户关闭「自动更新」时**仍然可用**（该设置只约束后台静默检查）。
   * 失败返回 `{ success: false, error }`，同时主进程会广播 `error` 状态。
   */
  checkForUpdates: () => Promise<UpdaterActionResult>
  /** `download-update`：下载已发现的新版本（`autoDownload = false`，必须显式调用）。 */
  downloadUpdate: () => Promise<UpdaterActionResult>
  /** `install-update`：`quitAndInstall()`；成功后应用会退出并安装，不会 resolve 到 UI。 */
  installUpdate: () => Promise<UpdaterActionResult>
  /**
   * 订阅更新状态广播（主进程 `webContents.send('update-status', status)`）。
   *
   * @returns 取消订阅函数 —— 组件卸载时必须调用。
   */
  onUpdateStatus: (listener: (status: UpdateStatus) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

export {}
