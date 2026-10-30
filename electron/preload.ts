import { contextBridge, ipcRenderer } from 'electron'

/**
 * IPC 通道总览（**31 → 35**，本文件与 `src/renderer/types/global.d.ts` 必须同步）：
 *
 * - 原有 31 个 `invoke` 通道（书签 / 回收站 / 合并 / 死链 / 历史 / 文件夹 / 标签 / 设置 / 导入导出）；
 * - 新增 4 个「外壳」通道：
 *   1. `close-quick-add`（invoke，单向无返回）：隐藏快速添加浮窗，不销毁；
 *   2. `notify-bookmarks-changed`（invoke，单向无返回）：主进程向**除发送者外**的所有窗口广播；
 *   3. `bookmarks-changed`（main → renderer，订阅式）：收到即重新拉取书签列表；
 *   4. `tray-open-view`（main → renderer，订阅式）：托盘「统计 / 设置」驱动视图切换。
 *
 * 2/3 是同一个动作的两半（渲染层发起 → 主进程扇出），计通道时按两个算，
 * 因此从 31 变成 35 而不是 34。订阅式通道必须返回取消订阅函数，否则热更新/组件重挂会叠加监听。
 */

contextBridge.exposeInMainWorld('electronAPI', {
  openBrowser: (url: string, browserPath?: string) =>
    ipcRenderer.invoke('open-browser', url, browserPath),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (bookmark: any) => ipcRenderer.invoke('add-bookmark', bookmark),
  updateBookmark: (id: string, bookmark: any) =>
    ipcRenderer.invoke('update-bookmark', id, bookmark),
  deleteBookmark: (id: string) => ipcRenderer.invoke('delete-bookmark', id),
  /**
   * 批量通道：一次 IPC = 主进程一次读 + 一次写。
   * 渲染层**不要**循环调用单个 update/delete（每个单条写操作都会重写整个 JSON）。
   */
  bulkUpdateBookmarks: (ids: string[], patch: any) =>
    ipcRenderer.invoke('bulk-update-bookmarks', ids, patch),
  bulkDeleteBookmarks: (ids: string[]) => ipcRenderer.invoke('bulk-delete-bookmarks', ids),
  /**
   * 回收站（软删除）通道。删除 = 写 `deletedAt`（可恢复），因此单条/批量删除、
   * 以及合并重复时被丢弃的副本都不再清理访问历史。
   *
   * - `getDeletedBookmarks`：只返回已删除记录，按 `deletedAt` 倒序；
   * - `restoreBookmarks`：`{ restored, missing, bookmarks }`，`bookmarks` 为未删除列表；
   * - `purgeBookmarks` / `emptyTrash`：**永久**删除并清理访问历史。
   */
  getDeletedBookmarks: () => ipcRenderer.invoke('get-deleted-bookmarks'),
  restoreBookmarks: (ids: string[]) => ipcRenderer.invoke('restore-bookmarks', ids),
  purgeBookmarks: (ids: string[]) => ipcRenderer.invoke('purge-bookmarks', ids),
  emptyTrash: () => ipcRenderer.invoke('empty-trash'),
  /**
   * 重复书签合并：一次 IPC = 主进程一次读 + 一次写。
   * 返回 `{ groups, removed, bookmarks }`，`bookmarks` 是合并后的**未删除列表**，
   * 渲染层整体替换本地数组即可（donors 已进回收站，keeper 字段已合并）。
   */
  mergeDuplicates: () => ipcRenderer.invoke('merge-duplicates'),
  /**
   * 死链检查：省略 `ids` = 检查全部书签。
   * 主进程侧一次读盘 + 一次写盘，返回汇总与本次检查过的书签（已带新 `linkStatus`）。
   * 同一时刻只允许一轮检查在跑（主进程有闸门，UI 也会禁用按钮）。
   */
  checkLinks: (ids?: string[]) => ipcRenderer.invoke('check-links', ids),
  incrementVisitCount: (id: string) => ipcRenderer.invoke('increment-visit-count', id),
  clearAllBookmarks: () => ipcRenderer.invoke('clearAllBookmarks'),
  /** 逐次访问记录（趋势图数据源）：数组，元素 `{ bookmarkId, visitedAt }` */
  getVisitHistory: () => ipcRenderer.invoke('get-visit-history'),
  clearVisitHistory: () => ipcRenderer.invoke('clear-visit-history'),
  getFolders: () => ipcRenderer.invoke('get-folders'),
  addFolder: (folder: any) => ipcRenderer.invoke('add-folder', folder),
  updateFolder: (id: string, updates: any) => ipcRenderer.invoke('update-folder', id, updates),
  deleteFolder: (id: string) => ipcRenderer.invoke('delete-folder', id),
  clearAllFolders: () => ipcRenderer.invoke('clearAllFolders'),
  getTags: () => ipcRenderer.invoke('get-tags'),
  addTag: (tag: any) => ipcRenderer.invoke('add-tag', tag),
  updateTag: (id: string, updates: any) => ipcRenderer.invoke('update-tag', id, updates),
  deleteTag: (id: string) => ipcRenderer.invoke('delete-tag', id),
  clearAllTags: () => ipcRenderer.invoke('clearAllTags'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  exportData: (format: 'json' | 'html') => ipcRenderer.invoke('export-data', format),
  importData: (format: 'json' | 'html', mergeMode: 'replace' | 'merge') =>
    ipcRenderer.invoke('import-data', format, mergeMode),
  /**
   * 隐藏快速添加浮窗（`close-quick-add`）。
   *
   * 只隐藏不销毁：窗口与渲染进程保持热态，第二次呼出无需重新加载。
   * Esc / 取消 / 保存成功后都走这里，因此**没有返回值**，也不代表「窗口已关闭」。
   */
  closeQuickAdd: (): Promise<void> => ipcRenderer.invoke('close-quick-add'),
  /**
   * 通知主进程「书签数据变了」（`notify-bookmarks-changed`）。
   *
   * 主进程向**除本窗口外**的所有窗口广播 `bookmarks-changed`，由各窗口自行重新拉取。
   * 浮窗保存后用这个通知主窗口刷新，而不是让浮窗自己维护主窗口的列表状态。
   */
  notifyBookmarksChanged: (): Promise<void> => ipcRenderer.invoke('notify-bookmarks-changed'),
  /**
   * 订阅「书签数据已变更」广播（主进程 `webContents.send`）。
   *
   * @returns 取消订阅函数：组件 `onUnmounted` 必须调用，否则重挂会叠加监听（重复拉取）。
   */
  onBookmarksChanged: (listener: () => void): (() => void) => {
    const handler = () => listener()
    ipcRenderer.on('bookmarks-changed', handler)
    return () => {
      ipcRenderer.removeListener('bookmarks-changed', handler)
    }
  },
  /**
   * 订阅托盘「统计 / 设置」请求（主进程 `webContents.send('tray-open-view', view)`）。
   *
   * 视图切换的**决定权在渲染层**（`uiStore.setCurrentView`）：主进程只表达「用户想进哪个页」。
   *
   * @returns 取消订阅函数（同上）。
   */
  onTrayOpenView: (listener: (view: 'stats' | 'settings') => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, view: 'stats' | 'settings') => listener(view)
    ipcRenderer.on('tray-open-view', handler)
    return () => {
      ipcRenderer.removeListener('tray-open-view', handler)
    }
  }
})
