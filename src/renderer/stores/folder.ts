import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Folder } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { useBookmarkStore } from './bookmark'

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
        color: folder.color || '#3B82F6'
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

  const deleteFolder = async (id: string) => {
    try {
      await window.electronAPI.deleteFolder(id)
      folders.value = folders.value.filter(f => f.id !== id)
      if (currentFolderId.value === id) {
        // 回退到「全部书签」（''），而不是其他文件夹：
        // 主进程已把被删文件夹内书签的 folderId 置为 ''，回退到 '' 才能让它们继续可见。
        currentFolderId.value = ''
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
