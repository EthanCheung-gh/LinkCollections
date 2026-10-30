import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Bookmark } from '../types'
import type { BulkBookmarkPatch, LinkCheckResult } from '../types/global'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'

/**
 * 批量补丁：直接复用 `types/global.d.ts` 里的 IPC 契约类型，
 * 保证渲染层传给 preload 的对象形状与主进程白名单一致（不跨端 import）。
 */
export type BulkPatch = BulkBookmarkPatch

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
      // 置顶切换复用同一个 update 通道：只转发布尔值，脏值交给主进程白名单丢弃
      if (typeof updates.pinned === 'boolean') {
        updateData.pinned = updates.pinned
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

  /**
   * 切换置顶状态。
   *
   * 复用既有的 `updateBookmark`（`showMessage = false`）：置顶是高频的轻量操作，
   * 每次点击都弹成功 toast 会打断操作，因此**成功不提示、失败才提示**。
   * 不新增 IPC 通道：主进程 `update-bookmark` 已经支持 `pinned` 布尔白名单。
   */
  const togglePin = async (id: string) => {
    const current = bookmarks.value.find(b => b.id === id)
    if (!current) {
      console.warn(`togglePin: bookmark ${id} not found in local state`)
      return
    }

    try {
      return await updateBookmark(id, { pinned: !current.pinned }, false)
    } catch (error) {
      ElMessage.error(t('message.bookmarkUpdateFailed'))
      console.error(error)
      return
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

  /**
   * 批量更新（移动文件夹 / 追加标签 / 移除标签 / 设置颜色 / 置顶）。
   *
   * **一次 IPC = 主进程一次读 + 一次写**：不要在渲染层循环调用 `updateBookmark`，
   * 每次单条更新都会重写整个 bookmarks.json（20 条 = 20 次读 + 20 次写）。
   *
   * 成功只发**一条**汇总 toast（`message.bulkUpdated`，带实际更新条数）；
   * 失败提示 `message.bookmarkUpdateFailed` 并 rethrow，由调用方决定是否保留选中态。
   * 返回实际更新条数（主进程返回的 `updated.length`，不含 `missing`）。
   *
   * 说明：这里**不**直接操作 selection store —— 选择模式由调用方（BulkActionBar）
   * 在执行成功后 `exit()`，store 之间保持单向依赖（folder/tag → bookmark），无环。
   */
  const bulkUpdate = async (ids: string[], patch: BulkPatch): Promise<number> => {
    try {
      const result = await window.electronAPI.bulkUpdateBookmarks(ids, patch)
      const updatedList = Array.isArray(result?.updated) ? result.updated : []

      if (updatedList.length > 0) {
        // 逐条替换进本地数组（按 id 建索引，避免 O(n²) 的 findIndex）
        const updatedById = new Map(updatedList.map(bookmark => [bookmark.id, bookmark]))
        bookmarks.value = bookmarks.value.map(bookmark => updatedById.get(bookmark.id) ?? bookmark)
      }

      // 注意参数名是 count：i18n 里 bulkUpdated 需要 {count}
      ElMessage.success(t('message.bulkUpdated', { count: updatedList.length }))
      return updatedList.length
    } catch (error) {
      ElMessage.error(t('message.bookmarkUpdateFailed'))
      console.error(error)
      throw error
    }
  }

  /**
   * 批量删除：同样**一次 IPC = 一次读 + 一次写**。
   * 本地按请求的 id 移除（主进程会删掉其中所有存在的记录），
   * toast 用主进程返回的 `deleted`（真实删除条数）。
   */
  const bulkDelete = async (ids: string[]): Promise<number> => {
    try {
      const result = await window.electronAPI.bulkDeleteBookmarks(ids)
      const deleted = typeof result?.deleted === 'number' ? result.deleted : ids.length

      const removedIds = new Set(ids)
      bookmarks.value = bookmarks.value.filter(bookmark => !removedIds.has(bookmark.id))

      ElMessage.success(t('message.bulkDeleted', { count: deleted }))
      return deleted
    } catch (error) {
      ElMessage.error(t('message.bookmarkDeleteFailed'))
      console.error(error)
      throw error
    }
  }

  /**
   * 死链检查（`check-links`）。
   *
   * 与批量通道同一形状：**一次 IPC = 主进程一次读 + 一次写**，网络探测全在主进程做
   * （渲染进程受 CSP `connect-src 'self'` 限制，也拿不到 8s 超时/并发控制）。
   *
   * - 省略 `ids` = 检查全部书签；
   * - 成功后按 id 把返回的书签替换进本地数组（只替换本次检查过的那些）；
   * - **不弹成功 toast**：结果由 `LinkCheckDialog` 展示，多一条提示只会打扰用户；
   * - 失败提示 `message.linkCheckFailed` 并 rethrow，由调用方决定后续动作。
   */
  const checkLinks = async (ids?: string[]): Promise<LinkCheckResult> => {
    try {
      const result = await window.electronAPI.checkLinks(ids)
      const updatedList = Array.isArray(result?.bookmarks) ? result.bookmarks : []

      if (updatedList.length > 0) {
        // 逐条替换进本地数组（按 id 建索引，避免 O(n²) 的 findIndex）
        const updatedById = new Map(updatedList.map(bookmark => [bookmark.id, bookmark]))
        bookmarks.value = bookmarks.value.map(bookmark => updatedById.get(bookmark.id) ?? bookmark)
      }

      return result
    } catch (error) {
      ElMessage.error(t('message.linkCheckFailed'))
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
    togglePin,
    deleteBookmark,
    bulkUpdate,
    bulkDelete,
    checkLinks,
    incrementVisitCount,
    clearAllBookmarks,
    searchBookmarks
  }
})
