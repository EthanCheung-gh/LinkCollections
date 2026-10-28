import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Bookmark } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

export const useBookmarkStore = defineStore('bookmark', () => {
  const { t } = useI18n()
  const bookmarks = ref<Bookmark[]>([])
  const loading = ref(false)

  const fetchBookmarks = async () => {
    try {
      loading.value = true
      bookmarks.value = await window.electronAPI.getBookmarks()
    } catch (error) {
      ElMessage.error(t('message.bookmarkLoadFailed'))
      console.error(error)
    } finally {
      loading.value = false
    }
  }

  const addBookmark = async (bookmark: Partial<Bookmark>) => {
    try {
      const bookmarkData = {
        url: bookmark.url || '',
        title: bookmark.title || '',
        description: bookmark.description || '',
        favicon: bookmark.favicon || '',
        color: bookmark.color || '#3B82F6',
        folderId: bookmark.folderId || '',
        tags: Array.isArray(bookmark.tags) ? [...bookmark.tags] : []
      }
      const newBookmark = await window.electronAPI.addBookmark(bookmarkData)
      bookmarks.value.push(newBookmark)
      ElMessage.success(t('message.bookmarkAdded'))
      return newBookmark
    } catch (error) {
      ElMessage.error(t('message.bookmarkAddFailed'))
      console.error(error)
      throw error
    }
  }

  const updateBookmark = async (id: string, updates: Partial<Bookmark>, showMessage = true) => {
    try {
      const updateData: Partial<Bookmark> = {}

      if (updates.title !== undefined) {
        updateData.title = updates.title
      }
      if (updates.description !== undefined) {
        updateData.description = updates.description
      }
      if (updates.folderId !== undefined) {
        updateData.folderId = updates.folderId
      }
      if (updates.tags !== undefined) {
        updateData.tags = Array.isArray(updates.tags) ? [...updates.tags] : []
      }
      if (updates.color !== undefined) {
        updateData.color = updates.color
      }
      if (updates.favicon !== undefined) {
        updateData.favicon = updates.favicon
      }

      const updated = await window.electronAPI.updateBookmark(id, updateData)
      if (updated) {
        const index = bookmarks.value.findIndex(b => b.id === id)
        if (index > -1) {
          bookmarks.value[index] = updated
        }
      } else {
        // IPC 契约异常（返回空）时不要把 undefined 写进数组，否则后续渲染/过滤会抛错。
        console.warn(`updateBookmark: empty result for bookmark ${id}, local state left unchanged`)
      }
      if (showMessage) {
        ElMessage.success(t('message.bookmarkUpdated'))
      }
      return updated
    } catch (error) {
      if (showMessage) {
        ElMessage.error(t('message.bookmarkUpdateFailed'))
      }
      console.error(error)
      throw error
    }
  }

  const deleteBookmark = async (id: string) => {
    try {
      await window.electronAPI.deleteBookmark(id)
      bookmarks.value = bookmarks.value.filter(b => b.id !== id)
      ElMessage.success(t('message.bookmarkDeleted'))
    } catch (error) {
      ElMessage.error(t('message.bookmarkDeleteFailed'))
      console.error(error)
      throw error
    }
  }

  const incrementVisitCount = async (id: string) => {
    try {
      // 类型来自 types/global.d.ts 的 ElectronAPI.incrementVisitCount，
      // 主进程 increment-visit-count 返回更新后的 Bookmark（electron/ipc/bookmarks.ts:96-115）
      const updated = await window.electronAPI.incrementVisitCount(id)
      if (!updated) {
        console.warn(`incrementVisitCount: empty result for bookmark ${id}`)
        return
      }
      const index = bookmarks.value.findIndex(b => b.id === id)
      if (index > -1) {
        bookmarks.value[index] = updated
      }
    } catch (error) {
      // 访问计数失败不应打断用户打开链接，所以这里不 rethrow；
      // 但必须可观测，不能留空的 catch 块。
      console.warn(`incrementVisitCount failed for bookmark ${id}:`, error)
    }
  }

  const clearAllBookmarks = async () => {
    try {
      await window.electronAPI.clearAllBookmarks()
      bookmarks.value = []
      ElMessage.success(t('message.allCleared'))
    } catch (error) {
      ElMessage.error(t('message.bookmarkDeleteFailed'))
      throw error
    }
  }

  const searchBookmarks = (keyword: string) => {
    if (!keyword.trim()) {
      return bookmarks.value
    }

    const lowerKeyword = keyword.toLowerCase()
    // 逐字段做 typeof 兜底：存量/导入数据里可能存在 undefined 的 title/url/description（审计 C15），
    // 直接 .toLowerCase() 会抛 TypeError 并打断整次搜索。
    const matches = (value: string | undefined | null) =>
      typeof value === 'string' && value.toLowerCase().includes(lowerKeyword)

    return bookmarks.value.filter(
      bookmark =>
        matches(bookmark.title) || matches(bookmark.url) || matches(bookmark.description)
    )
  }

  return {
    bookmarks,
    loading,
    fetchBookmarks,
    addBookmark,
    updateBookmark,
    deleteBookmark,
    incrementVisitCount,
    clearAllBookmarks,
    searchBookmarks
  }
})
