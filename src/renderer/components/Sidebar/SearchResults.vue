<template>
  <div
    v-if="isSearching"
    class="search-results"
  >
    <div
      v-if="searchResults.length === 0"
      class="no-results"
    >
      <i class="i-heroicons-magnifying-glass" />
      <p>{{ t('search.noResults') }}</p>
    </div>

    <div
      v-else
      class="results-list"
    >
      <div class="results-header">
        <span>{{ t('search.results', { count: searchResults.length }) }}</span>
        <el-button
          text
          size="small"
          @click="handleClear"
        >
          {{ t('common.cancel') }}
        </el-button>
      </div>

      <div
        v-for="bookmark in searchResults"
        :key="bookmark.id"
        class="result-item"
        @click="handleSelectBookmark(bookmark)"
      >
        <div
          v-if="bookmark.favicon"
          class="result-favicon"
        >
          <img
            :src="bookmark.favicon"
            alt=""
            @error="handleFaviconError(bookmark)"
          >
        </div>
        <div
          v-else
          class="result-favicon"
        >
          <i class="i-heroicons-globe-alt" />
        </div>

        <div class="result-content">
          <div class="result-title">
            {{ bookmark.title }}
          </div>
          <div class="result-url">
            {{ bookmark.url }}
          </div>
        </div>
      </div>
    </div>

    <div
      v-if="searchHistory.length > 0"
      class="search-history"
    >
      <div class="history-header">
        <span>{{ t('search.recentSearches') }}</span>
        <el-button
          text
          size="small"
          @click="handleClearHistory"
        >
          {{ t('common.cancel') }}
        </el-button>
      </div>

      <div
        v-for="(item, index) in searchHistory"
        :key="index"
        class="history-item"
        @click="handleHistoryClick(item)"
      >
        <i class="i-heroicons-clock" />
        <span>{{ item }}</span>
        <el-button
          text
          size="small"
          class="remove-btn"
          @click.stop="handleRemoveHistory(item)"
        >
          <i class="i-heroicons-x-mark" />
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useSearchStore } from '../../stores/search'
import { useBookmarkStore, useUIStore } from '../../stores'
import type { Bookmark } from '../../types'

const { t } = useI18n()
const searchStore = useSearchStore()
const bookmarkStore = useBookmarkStore()
const uiStore = useUIStore()
const { isSearching, searchResults, searchHistory } = storeToRefs(searchStore)
const { settings } = storeToRefs(uiStore)
const { performSearch, clearSearch, removeFromHistory, clearHistory } = searchStore

// B10: 与 BookmarkCard/ListView 保持一致的开链路径（系统默认浏览器 + 访问计数）
const handleSelectBookmark = async (bookmark: Bookmark) => {
  await bookmarkStore.incrementVisitCount(bookmark.id)

  const defaultBrowser = settings.value?.defaultBrowser || ''
  const browserPath =
    typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser?.path || ''

  await window.electronAPI.openBrowser(bookmark.url, browserPath)
}

const handleFaviconError = (bookmark: Bookmark) => {
  bookmarkStore.updateBookmark(bookmark.id, { favicon: '' }, false)
}

const handleClear = () => {
  clearSearch()
}

const handleHistoryClick = (item: string) => {
  performSearch(item)
}

const handleRemoveHistory = (item: string) => {
  removeFromHistory(item)
}

const handleClearHistory = () => {
  clearHistory()
}
</script>

<style scoped>
.search-results {
  margin-bottom: var(--lc-space-4);
  border-top: 1px solid var(--lc-border-subtle);
  padding-top: var(--lc-space-3);
}

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--lc-space-2);
  padding: var(--lc-space-6) var(--lc-space-4);
  color: var(--lc-text-muted);
}

.no-results i {
  font-size: 32px;
}

.no-results p {
  margin: 0;
  font-size: var(--lc-font-base);
}

.results-list {
  max-height: 300px;
  overflow-y: auto;
}

.results-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 横向 padding 归零：与侧栏其它内容共用一条左边缘 */
  padding: var(--lc-space-2) 0;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  font-weight: var(--lc-weight-semibold);
}

.result-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  padding: var(--lc-space-2) 0;
  cursor: pointer;
  border-radius: var(--lc-radius-sm);
  color: var(--lc-text-regular);
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.result-item:hover {
  background-color: var(--lc-bg-hover);
}

.result-favicon {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.result-favicon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.result-favicon i {
  font-size: 16px;
  color: var(--lc-text-muted);
}

.result-content {
  flex: 1;
  min-width: 0;
}

.result-title {
  font-size: var(--lc-font-sm);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: var(--lc-space-1);
}

.result-url {
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-history {
  margin-top: var(--lc-space-3);
  border-top: 1px solid var(--lc-border-subtle);
  padding-top: var(--lc-space-3);
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--lc-space-2) 0;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  font-weight: var(--lc-weight-semibold);
}

.history-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  padding: var(--lc-space-2) 0;
  cursor: pointer;
  border-radius: var(--lc-radius-sm);
  position: relative;
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.history-item:hover {
  background-color: var(--lc-bg-hover);
}

.history-item i {
  font-size: 16px;
  color: var(--lc-text-muted);
  flex-shrink: 0;
}

.history-item span {
  flex: 1;
  min-width: 0;
  font-size: var(--lc-font-sm);
  color: var(--lc-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-btn {
  padding: var(--lc-space-1);
  opacity: 0;
  transition: opacity var(--lc-duration-fast) var(--lc-ease-standard);
}

.history-item:hover .remove-btn,
.remove-btn:focus-visible {
  opacity: 1;
}

.remove-btn i {
  font-size: 16px;
}
</style>
