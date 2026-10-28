import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useBookmarkStore } from './bookmark'
import { useTagStore } from './tag'

export const useSearchStore = defineStore('search', () => {
  const query = ref('')
  const isSearching = ref(false)
  const searchHistory = ref<string[]>([])

  const bookmarkStore = useBookmarkStore()
  const tagStore = useTagStore()

  const searchResults = computed(() => {
    if (!query.value.trim()) {
      return []
    }

    const lowerQuery = query.value.toLowerCase()
    // 逐字段 typeof 兜底：存量/导入数据里可能存在 undefined 的 title/url/description/tags
    // （审计 C15），直接 .toLowerCase()/.includes() 会抛 TypeError 并让整个搜索结果面板崩溃。
    const matches = (value: string | undefined | null) =>
      typeof value === 'string' && value.toLowerCase().includes(lowerQuery)

    return bookmarkStore.bookmarks.filter(bookmark => {
      const titleMatch = matches(bookmark.title)
      const urlMatch = matches(bookmark.url)
      const descMatch = matches(bookmark.description)

      const bookmarkTagIds = Array.isArray(bookmark.tags) ? bookmark.tags : []
      const bookmarkTags = tagStore.tags.filter(tag => bookmarkTagIds.includes(tag.id))
      const tagMatch = bookmarkTags.some(tag => matches(tag.name))

      return titleMatch || urlMatch || descMatch || tagMatch
    })
  })

  const performSearch = (searchQuery: string) => {
    query.value = searchQuery
    isSearching.value = searchQuery.trim().length > 0

    if (searchQuery.trim()) {
      addToHistory(searchQuery)
    }
  }

  const clearSearch = () => {
    query.value = ''
    isSearching.value = false
  }

  const addToHistory = (searchQuery: string) => {
    const trimmed = searchQuery.trim()
    if (!trimmed) return

    const existingIndex = searchHistory.value.indexOf(trimmed)
    if (existingIndex > -1) {
      searchHistory.value.splice(existingIndex, 1)
    }

    searchHistory.value.unshift(trimmed)

    if (searchHistory.value.length > 10) {
      searchHistory.value = searchHistory.value.slice(0, 10)
    }
  }

  const clearHistory = () => {
    searchHistory.value = []
  }

  const removeFromHistory = (searchQuery: string) => {
    const index = searchHistory.value.indexOf(searchQuery)
    if (index > -1) {
      searchHistory.value.splice(index, 1)
    }
  }

  return {
    query,
    isSearching,
    searchHistory,
    searchResults,
    performSearch,
    clearSearch,
    addToHistory,
    clearHistory,
    removeFromHistory
  }
})
