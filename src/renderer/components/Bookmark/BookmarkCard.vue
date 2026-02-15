<template>
  <div class="bookmark-card" :style="{ background: cardGradient }">
    <div class="card-header">
      <div class="favicon-wrapper" title="Click to refresh favicon" @click="refreshFavicon">
        <img
          v-if="bookmark.favicon"
          :src="bookmark.favicon"
          :alt="bookmark.title"
          class="favicon"
          @error="() => handleFaviconError(bookmark)"
        />
        <i v-else class="i-heroicons-globe-alt default-icon" />
      </div>
      <div class="last-visited">
        <span v-if="bookmark.lastVisited">{{ formatLastVisitedDate(bookmark.lastVisited) }}</span>
        <span v-else>-</span>
      </div>
    </div>

    <div class="card-body">
      <a
        :href="bookmark.url"
        class="url-link"
        @click.prevent.stop="handleUrlClick"
        v-html="highlightedUrl"
      />
      <h3 class="title" @click.stop v-html="highlightedTitle" />
      <p class="description" @click.stop v-html="highlightedDescription" />
    </div>

    <div v-if="bookmarkTags.length > 0" class="card-tags">
      <span
        v-for="tag in bookmarkTags"
        :key="tag.id"
        class="tag"
        :style="{ backgroundColor: tagBackgroundColor(tag.color), color: tag.color }"
        @click.stop
      >
        {{ tag.name }}
      </span>
    </div>

    <div class="card-footer" @click.stop>
      <div class="visit-count">
        <i class="i-heroicons-chart-bar" />
        <span>{{ bookmark.visitCount }}</span>
      </div>
      <div class="actions">
        <el-dropdown trigger="click" @command="handleMoreAction">
          <el-button text size="small" class="action-btn" @click.stop>
            <i class="i-heroicons-ellipsis-vertical" />
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="edit">
                <i class="i-heroicons-pencil mr-2" />
                Edit
              </el-dropdown-item>
              <el-dropdown-item command="share">
                <i class="i-heroicons-share mr-2" />
                Share
              </el-dropdown-item>
              <el-dropdown-item divided command="open-default">
                <i class="i-heroicons-arrow-top-right-on-square mr-2" />
                Open in Default Browser
              </el-dropdown-item>
              <el-dropdown-item
                v-for="(browser, index) in browsers"
                :key="index"
                :command="`open-browser-${index}`"
              >
                <i class="i-heroicons-globe-alt mr-2" />
                {{ browser.name || `Browser ${index + 1}` }}
              </el-dropdown-item>
              <el-dropdown-item divided command="delete">
                <i class="i-heroicons-trash mr-2" />
                Delete
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { Bookmark, Tag } from '../../types'
import { useBookmarkStore, useTagStore, useUIStore } from '../../stores'
import { highlightText } from '../../utils/highlight'
import { getFaviconUrl } from '../../utils/favicon'
import EditDialog from '../Modal/EditDialog.vue'

interface Props {
  bookmark: Bookmark
  searchQuery?: string
}

interface Emits {
  (e: 'edit', bookmark: Bookmark): void
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: ''
})
const emit = defineEmits<Emits>()

const bookmarkStore = useBookmarkStore()
const tagStore = useTagStore()
const uiStore = useUIStore()
const { tags } = storeToRefs(tagStore)
const { settings } = storeToRefs(uiStore)
const { incrementVisitCount } = bookmarkStore

const browsers = computed(() => {
  if (!settings.value?.availableBrowsers) return []
  return settings.value.availableBrowsers.filter(b => b.path.trim() !== '')
})

const bookmarkTags = computed(() => {
  return props.bookmark.tags
    .map(tagId => tags.value.find(t => t.id === tagId))
    .filter(Boolean) as Tag[]
})

const highlightedTitle = computed(() => {
  return highlightText(props.bookmark.title, props.searchQuery)
})

const highlightedDescription = computed(() => {
  return highlightText(props.bookmark.description, props.searchQuery)
})

const highlightedUrl = computed(() => {
  return highlightText(props.bookmark.url, props.searchQuery)
})

const hexToRgba = (hex: string, alpha: number): string => {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const cardGradient = computed(() => {
  const color = props.bookmark.color || '#3B82F6'
  return `linear-gradient(135deg, ${hexToRgba(color, 0.09)} 0%, ${hexToRgba(color, 0.15)} 100%)`
})

const tagBackgroundColor = (color: string): string => {
  return hexToRgba(color, 0.13)
}

const formatLastVisited = (date: string) => {
  const now = new Date()
  const visited = new Date(date)
  const diffMs = now.getTime() - visited.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

const formatLastVisitedDate = (date: string) => {
  const visited = new Date(date)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - visited.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return '今天'
  if (diffDays === 1) return '昨天'

  const year = visited.getFullYear()
  const month = String(visited.getMonth() + 1).padStart(2, '0')
  const day = String(visited.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
}

const handleCardClick = () => {
  handleUrlClick()
}

const handleUrlClick = async () => {
  await incrementVisitCount(props.bookmark.id)

  const defaultBrowser = settings.value?.defaultBrowser || ''
  const browserPath =
    typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser?.path || ''

  await window.electronAPI.openBrowser(props.bookmark.url, browserPath)
}

const handleFaviconError = (bookmark: Bookmark) => {
  bookmarkStore.updateBookmark(bookmark.id, { favicon: '' }, false)
}

const refreshFavicon = () => {
  const newFavicon = getFaviconUrl(
    props.bookmark.url,
    settings.value?.faviconService,
    settings.value?.useForeignFavicon
  )
  if (newFavicon) {
    bookmarkStore.updateBookmark(props.bookmark.id, { favicon: newFavicon }, false)
  }
}

const handleEdit = () => {
  emit('edit', props.bookmark)
}

const handleShare = () => {
  const text = `网址: ${props.bookmark.url}\n标题: ${props.bookmark.title}\n介绍: ${props.bookmark.description}`
  navigator.clipboard.writeText(text)
}

const handleMoreAction = async (command: string) => {
  if (command === 'delete') {
    await bookmarkStore.deleteBookmark(props.bookmark.id)
    return
  }

  if (command === 'edit') {
    emit('edit', props.bookmark)
    return
  }

  if (command === 'share') {
    const text = `网址: ${props.bookmark.url}\n标题: ${props.bookmark.title}\n介绍: ${props.bookmark.description}`
    navigator.clipboard.writeText(text)
    return
  }

  if (command === 'open-default') {
    const defaultBrowser = settings.value?.defaultBrowser
    const browserPath =
      typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser?.path || ''
    await window.electronAPI.openBrowser(props.bookmark.url, browserPath)
    await incrementVisitCount(props.bookmark.id)
    return
  }

  if (command.startsWith('open-browser-')) {
    const index = parseInt(command.split('-')[2])
    const browser = browsers.value[index]
    if (browser) {
      await window.electronAPI.openBrowser(props.bookmark.url, browser.path)
      await incrementVisitCount(props.bookmark.id)
    }
    return
  }

  const defaultBrowser = settings.value?.defaultBrowser || ''
  const browserPath =
    typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser?.path || ''
  await window.electronAPI.openBrowser(props.bookmark.url, browserPath)
  await incrementVisitCount(props.bookmark.id)
}
</script>

<style scoped>
.bookmark-card {
  background-color: #ffffff;
  border-radius: 6px;
  padding: 6px;
  padding-bottom: 4px;
  cursor: pointer;
  transition: all 0.3s;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.bookmark-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 5px;
}

.favicon-wrapper {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.favicon-wrapper:hover {
  transform: scale(1.05);
}

.favicon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.default-icon {
  font-size: 16px;
  color: var(--el-text-color-secondary);
}

.last-visited {
  font-size: 9px;
  color: var(--el-text-color-secondary);
  background-color: rgba(255, 255, 255, 0.6);
  padding: 2px 6px;
  border-radius: 12px;
  display: inline-block;
  white-space: nowrap;
}

html.dark .last-visited {
  background-color: rgba(255, 255, 255, 0.1);
  color: #e5eaf3;
}

.card-body {
  margin-bottom: 5px;
}

.url-link {
  display: block;
  color: var(--el-color-primary);
  font-size: 10px;
  text-decoration: none;
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-link:hover {
  text-decoration: underline;
}

.url-link:active {
  color: var(--el-color-primary-dark-2);
}

.title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 3px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  font-size: 11px;
  color: var(--el-text-color-regular);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.3;
}

.card-tags {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
  max-width: calc(100% - 36px);
}

.tag {
  font-size: 8px;
  padding: 2px 5px;
  border-radius: 5px;
  font-weight: 500;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  margin-top: auto;
  padding-top: 4px;
  padding-bottom: 0px;
}

.visit-count {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 10px;
  color: var(--el-text-color-secondary);
}

.actions {
  display: flex;
  gap: 3px;
  align-items: center;
}

.action-btn {
  padding: 2px 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.bookmark-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 0px;
}

.favicon-wrapper {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
  flex-shrink: 0;
}

.favicon-wrapper:hover {
  transform: scale(1.05);
}

.favicon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}

.default-icon {
  font-size: 16px;
  color: var(--el-text-color-secondary);
}

.last-visited {
  font-size: 8px;
  color: var(--el-text-color-secondary);
  background-color: rgba(255, 255, 255, 0.6);
  padding: 1px 5px;
  border-radius: 10px;
  display: inline-block;
  white-space: nowrap;
}

html.dark .last-visited {
  background-color: rgba(255, 255, 255, 0.1);
  color: #e5eaf3;
}

.card-body {
  margin-bottom: 0px;
}

.url-link {
  display: block;
  color: var(--el-color-primary);
  font-size: 9px;
  text-decoration: none;
  margin-bottom: 0px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.url-link:hover {
  text-decoration: underline;
}

.title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 0px 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  font-size: 10px;
  color: var(--el-text-color-regular);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.15;
  min-height: 35px;
}

.card-tags {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 2px;
  max-width: calc(100% - 32px);
}

.tag {
  font-size: 8px;
  padding: 1px 3px;
  border-radius: 4px;
  font-weight: 500;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  margin-top: auto;
  padding-top: 0px;
}

.visit-count {
  display: flex;
  align-items: center;
  gap: 1px;
  font-size: 9px;
  color: var(--el-text-color-secondary);
}

.actions {
  display: flex;
  gap: 0px;
}

.action-btn {
  padding: 0px 1px;
  opacity: 0;
  transition: opacity 0.2s;
}

.bookmark-card:hover .action-btn {
  opacity: 1;
}

.action-btn:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

:deep(mark) {
  background-color: #fef08a;
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 600;
}
</style>
