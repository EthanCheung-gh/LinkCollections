import { contextBridge, ipcRenderer } from 'electron'

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
    ipcRenderer.invoke('import-data', format, mergeMode)
})
