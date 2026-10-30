export interface Folder {
  id: string
  name: string
  icon: string | null
  color: string
  createdAt: string
  order: number
  /**
   * 父文件夹 id。保持**可选**：旧数据（HTML 导入前写入的 folders.json）没有这个字段，
   * 缺失 / `null` / `''` 三者语义一致，都表示「顶层文件夹」。
   */
  parentId?: string | null
}

/**
 * 侧栏 / 下拉框渲染用的扁平化节点：`folders` 经深度优先展开后的结果。
 * `depth` 为缩进层级（顶层为 0），`hasChildren` 决定是否渲染折叠箭头。
 */
export interface FolderTreeNode extends Folder {
  depth: number
  hasChildren: boolean
}
