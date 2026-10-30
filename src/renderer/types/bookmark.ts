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
  createdAt: string
  updatedAt: string
}
