/**
 * 单条死链检查结果（`bookmarks.json` 里 `Bookmark.linkStatus` 的形状）。
 *
 * - `ok: true` = 可访问（2xx/3xx）；`ok: false` = 死链（404/410、DNS/连接失败）；
 *   `ok: null` = unknown（401/403/429/5xx、反爬、重定向到登录页…，**不判死链**）；
 * - `status: null` 表示没拿到任何 HTTP 状态码（超时/被中止/非 http 协议）；
 * - 这个字段**只由主进程写入**（IPC `check-links`），渲染层的
 *   `updateBookmark` / `bulkUpdate` 白名单里没有它。
 */
export interface LinkStatus {
  ok: boolean | null
  status: number | null
  checkedAt: string
  error?: string
}

export interface Bookmark {
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
  /**
   * 置顶标记。可选：旧数据/第三方导入数据可能完全没有该字段，
   * 语义上「缺失 === 未置顶」，渲染层一律按 `=== true` 判断。
   */
  pinned?: boolean
  /**
   * 死链检查结果。可选：旧数据没有该字段，缺失即「从未检查过」，
   * 因此本功能**不需要 schema 迁移**。
   */
  linkStatus?: LinkStatus
  /**
   * 软删除标记（回收站）。
   *
   * - `null` / 缺失 = 未删除（正常书签）；
   * - 非空 ISO 字符串 = 删除时刻，记录在回收站里，超过保留期（30 天）会被永久清理。
   *
   * 主进程的 `get-bookmarks` 只返回未删除的记录，因此 `bookmarks` store 里的对象
   * 恒为「未删除」；回收站列表走 `get-deleted-bookmarks`（store 的 `trashedBookmarks`）。
   */
  deletedAt?: string | null
  createdAt: string
  updatedAt: string
}
