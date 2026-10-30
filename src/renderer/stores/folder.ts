import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Folder, FolderTreeNode } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useBookmarkStore } from './bookmark'

/** 父级语义归一：`''` / `null` / `undefined` / 纯空白 → `''`（顶层） */
const normalizeParentId = (value: unknown): string => {
  if (typeof value !== 'string') return ''
  return value.trim()
}

const orderOf = (folder: Folder): number =>
  typeof folder.order === 'number' && Number.isFinite(folder.order) ? folder.order : 0

export const useFolderStore = defineStore('folder', () => {
  const { t } = useI18n()
  const folders = ref<Folder[]>([])
  /**
   * 当前选中的文件夹 id。**`''` 是有效语义值，不是"未初始化"**：
   * `''` 表示「全部书签」——即不按文件夹过滤，展示所有书签（含 folderId === '' 的未分类书签）。
   * 主进程会把被删除文件夹下书签的 folderId 置为 ''（electron/ipc/folders.ts:76-81、:113-118），
   * 因此 UI 必须保证 `currentFolderId === ''` 时能显示全部书签，否则这些书签将永久不可见。
   */
  const currentFolderId = ref<string>('')
  const loading = ref(false)

  const fetchFolders = async () => {
    try {
      loading.value = true
      folders.value = await window.electronAPI.getFolders()
      // 注意：此处**不再**自动选中第一个文件夹。
      // 自动选中会让 currentFolderId 永不为 ''，"全部书签" 语义无法成立，
      // folderId === '' 的书签在列表里永久不可见（审计 B2）。
    } catch (error) {
      ElMessage.error(t('message.folderLoadFailed'))
      console.error(error)
    } finally {
      loading.value = false
    }
  }

  const addFolder = async (folder: Partial<Folder>) => {
    try {
      const folderData = {
        name: folder.name || '',
        icon: folder.icon || null,
        color: folder.color || '#3B82F6',
        // 空值（''）语义 = 顶层，统一交给主进程存 null（主进程再做「父级是否存在」的校验）
        parentId: normalizeParentId(folder.parentId) || null
      }
      const newFolder = await window.electronAPI.addFolder(folderData)
      folders.value.push(newFolder)
      ElMessage.success(t('message.folderAdded'))
      return newFolder
    } catch (error) {
      ElMessage.error(t('message.folderAddFailed'))
      console.error(error)
      throw error
    }
  }

  /**
   * 删除/清空文件夹后同步渲染层书签副本（审计 B3）。
   * 单独 try/catch：刷新失败不能把「已经成功的删除」变成「删除失败」，
   * 也不能吞掉成功提示，因此这里只记录日志、不 rethrow。
   */
  const refreshBookmarks = async () => {
    try {
      await useBookmarkStore().fetchBookmarks()
    } catch (error) {
      console.warn('Failed to refresh bookmarks after folder change:', error)
    }
  }

  /**
   * 某文件夹的全部后代 id（**含自身**）。用于两处：
   *  - 主视图过滤（`currentFolderSubtreeIds`）；
   *  - 编辑弹窗排除「自身 + 全部后代」的父级选项。
   * 用显式队列 + visited 集合遍历，脏数据里的环 / 重复 id / 自引用都不会死循环。
   */
  const descendantIdsOf = (id: string): string[] => {
    const rootId = normalizeParentId(id)
    if (rootId === '') return []

    const childrenByParent = new Map<string, string[]>()
    folders.value.forEach(folder => {
      if (!folder || typeof folder.id !== 'string') return
      const parentId = normalizeParentId(folder.parentId)
      if (parentId === '') return
      const siblings = childrenByParent.get(parentId)
      if (siblings) {
        siblings.push(folder.id)
      } else {
        childrenByParent.set(parentId, [folder.id])
      }
    })

    const visited = new Set<string>([rootId])
    const queue: string[] = [rootId]
    while (queue.length > 0) {
      const current = queue.shift() as string
      for (const childId of childrenByParent.get(current) || []) {
        if (visited.has(childId)) continue
        visited.add(childId)
        queue.push(childId)
      }
    }
    return [...visited]
  }

  /**
   * 侧栏 / 下拉框用的扁平树：按 `order` 升序、父在前子在后（深度优先）展开。
   * 孤儿（父级 id 不存在）与自引用节点按顶层处理——脏数据也不会丢节点。
   */
  const folderTree = computed<FolderTreeNode[]>(() => {
    const list = folders.value.filter(folder => folder && typeof folder.id === 'string')
    const knownIds = new Set(list.map(folder => folder.id))

    const roots: Folder[] = []
    const childrenByParent = new Map<string, Folder[]>()
    list.forEach(folder => {
      const parentId = normalizeParentId(folder.parentId)
      const hasKnownParent = parentId !== '' && parentId !== folder.id && knownIds.has(parentId)
      if (!hasKnownParent) {
        roots.push(folder)
        return
      }
      const siblings = childrenByParent.get(parentId)
      if (siblings) {
        siblings.push(folder)
      } else {
        childrenByParent.set(parentId, [folder])
      }
    })

    const byOrder = (a: Folder, b: Folder) => orderOf(a) - orderOf(b)
    const result: FolderTreeNode[] = []
    const rendered = new Set<string>()

    const walk = (folder: Folder, depth: number) => {
      // 重复 id / 成环的兜底：同一 id 只渲染一次，且不再向下递归
      if (rendered.has(folder.id)) return
      rendered.add(folder.id)

      const children = (childrenByParent.get(folder.id) || [])
        .filter(child => !rendered.has(child.id))
        .sort(byOrder)

      result.push({ ...folder, depth, hasChildren: children.length > 0 })
      children.forEach(child => walk(child, depth + 1))
    }

    roots.sort(byOrder).forEach(root => walk(root, 0))
    // 兜底：既不是根、也没被任何祖先链走到（只可能出现在父子链成环的脏数据里），
    // 按顶层追加，保证「不丢节点」
    list.forEach(folder => {
      if (!rendered.has(folder.id)) walk(folder, 0)
    })

    return result
  })

  /**
   * 当前选中文件夹的「子树 id 集合」（含自身）。
   * `currentFolderId === ''`（全部书签）时返回 `null`，表示**不按文件夹过滤**——
   * 这是既有约定（见上方 currentFolderId 注释），不要改成空集合。
   */
  const currentFolderSubtreeIds = computed<Set<string> | null>(() => {
    if (currentFolderId.value === '') return null
    return new Set(descendantIdsOf(currentFolderId.value))
  })

  /**
   * 删除时的「最近有效祖先」= 主进程 delete-folder 的上提目标（两处必须一致）：
   * 直接子文件夹会挂到它下面；若它不存在（顶层 / 脏数据孤儿 / 自引用）则返回 `null`（顶层）。
   */
  const nearestExistingAncestorOf = (id: string): string | null => {
    const parentId = normalizeParentId(folders.value.find(folder => folder.id === id)?.parentId)
    if (parentId === '' || parentId === id) return null
    return folders.value.some(folder => folder.id === parentId) ? parentId : null
  }

  const deleteFolder = async (id: string) => {
    // 必须在 folders.value 被改写之前算好：删除后既用于「子级上提」，也用于
    // currentFolderId 回退到最近的有效祖先。
    const ancestorFolderId = nearestExistingAncestorOf(id)

    try {
      await window.electronAPI.deleteFolder(id)
      // 主进程会先把直接子文件夹「上提」到被删文件夹的父级，本地副本必须同步做同样的
      // 上提，否则 folderTree 会把这些子文件夹当成孤儿显示在顶层（层级跳变）。
      folders.value = folders.value
        .filter(f => f.id !== id)
        .map(f =>
          normalizeParentId(f.parentId) === id ? { ...f, parentId: ancestorFolderId } : f
        )
      const stillExists =
        currentFolderId.value === '' || folders.value.some(f => f.id === currentFolderId.value)
      if (!stillExists) {
        // 绝不把 currentFolderId 指向已删除的 id：回退到最近的有效祖先，没有则回退到 ''
        // （'' = 全部书签，主进程已把被删文件夹内书签的 folderId 置为 ''，回退到这里它们仍可见）。
        currentFolderId.value = ancestorFolderId ?? ''
      }
      // 主进程级联已清理 bookmarks 的 folderId，渲染层必须重新拉取以同步本地副本（审计 B3）。
      // 顺序：删除成功 → 刷新书签 → 提示。
      await refreshBookmarks()
      ElMessage.success(t('message.folderDeleted'))
    } catch (error) {
      ElMessage.error(t('message.folderDeleteFailed'))
      console.error(error)
      throw error
    }
  }

  const setCurrentFolder = (id: string) => {
    currentFolderId.value = id
  }

  const updateFolder = async (id: string, updates: Partial<Folder>) => {
    try {
      const updatedFolder = await window.electronAPI.updateFolder(id, updates)
      const index = folders.value.findIndex(f => f.id === id)
      if (index > -1) {
        folders.value[index] = updatedFolder
      }
      ElMessage.success(t('message.folderUpdated'))
    } catch (error) {
      ElMessage.error(t('message.folderAddFailed'))
      console.error(error)
      throw error
    }
  }

  const currentFolder = computed(() => {
    return folders.value.find(f => f.id === currentFolderId.value) || null
  })

  const clearAllFolders = async () => {
    try {
      await window.electronAPI.clearAllFolders()
      folders.value = []
      currentFolderId.value = ''
      // 主进程清空文件夹后会把所有书签的 folderId 置为 ''，同步刷新本地书签副本（审计 B3）
      await refreshBookmarks()
      ElMessage.success(t('message.allCleared'))
    } catch (error) {
      ElMessage.error(t('message.folderDeleteFailed'))
      throw error
    }
  }

  return {
    folders,
    folderTree,
    descendantIdsOf,
    currentFolderSubtreeIds,
    currentFolderId,
    currentFolder,
    loading,
    fetchFolders,
    addFolder,
    updateFolder,
    deleteFolder,
    setCurrentFolder,
    clearAllFolders
  }
})
