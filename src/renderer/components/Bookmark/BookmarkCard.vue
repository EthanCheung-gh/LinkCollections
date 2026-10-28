<template>
  <div
    class="bookmark-card"
    :style="{ '--card-accent': cardAccent }"
  >
    <div class="card-header">
      <div
        class="favicon-wrapper"
        :title="t('bookmark.refreshFavicon')"
        @click="refreshFavicon"
      >
        <img
          v-if="bookmark.favicon"
          :src="bookmark.favicon"
          :alt="bookmark.title"
          class="favicon"
          @error="() => handleFaviconError(bookmark)"
        >
        <i
          v-else
          class="i-heroicons-globe-alt default-icon"
        />
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
      <h3
        class="title"
        @click.stop
        v-html="highlightedTitle"
      />
      <p
        class="description"
        @click.stop
        v-html="highlightedDescription"
      />
    </div>

    <div
      v-if="bookmarkTags.length > 0"
      class="card-tags"
    >
      <span
        v-for="tag in bookmarkTags"
        :key="tag.id"
        class="tag"
        :style="{ backgroundColor: tagBackgroundColor(tag.color), color: tagTextColor(tag.color) }"
        @click.stop
      >
        {{ tag.name }}
      </span>
    </div>

    <div
      class="card-footer"
      @click.stop
    >
      <div class="visit-count">
        <i class="i-heroicons-chart-bar" />
        <span>{{ bookmark.visitCount }}</span>
      </div>
      <div class="actions">
        <el-dropdown
          trigger="click"
          @command="handleMoreAction"
        >
          <el-button
            text
            size="small"
            class="action-btn"
            @click.stop
          >
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
              <el-dropdown-item
                divided
                command="open-default"
              >
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
              <el-dropdown-item
                divided
                command="delete"
              >
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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import type { Bookmark, Tag } from '../../types'
import { useBookmarkStore, useTagStore, useUIStore } from '../../stores'
import { highlightText } from '../../utils/highlight'
import { getFaviconUrl } from '../../utils/favicon'
import { isValidColor } from '../../utils/validation'

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

const { t } = useI18n()

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

// B1 / C16: `color` 可能被持久化成 null 或非法值（编辑弹窗 Clear / show-alpha），
// 统一做空值 + 格式兜底，回退到 --lc-accent。
const safeColor = (color?: string | null): string => {
  return color && isValidColor(color) ? color : 'var(--lc-accent)'
}

const cardAccent = computed(() => safeColor(props.bookmark.color))

const tagBackgroundColor = (color?: string | null): string => {
  return `color-mix(in srgb, ${safeColor(color)} 13%, transparent)`
}

const tagTextColor = (color?: string | null): string => safeColor(color)

const formatLastVisitedDate = (date: string) => {
  const visited = new Date(date)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - visited.getTime()) / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return t('bookmark.today')
  if (diffDays === 1) return t('bookmark.yesterday')

  const year = visited.getFullYear()
  const month = String(visited.getMonth() + 1).padStart(2, '0')
  const day = String(visited.getDate()).padStart(2, '0')
  return `${year}/${month}/${day}`
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
  const newFavicon = getFaviconUrl(props.bookmark.url)
  if (newFavicon) {
    bookmarkStore.updateBookmark(props.bookmark.id, { favicon: newFavicon }, false)
  }
}

const handleShare = () => {
  const text = `${t('form.url')}: ${props.bookmark.url}\n${t('form.title')}: ${props.bookmark.title}\n${t('form.description')}: ${props.bookmark.description}`
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
    handleShare()
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
  position: relative;
  display: flex;
  flex-direction: column;
  padding: var(--lc-space-4);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-lg);
  background-color: var(--lc-bg-surface);
  /* 色相层：只用变量 + color-mix，深色下随 --lc-bg-surface 自动变暗，
     不再用行内 background 渐变（会被深色全局覆盖压掉） */
  background-image: linear-gradient(
    135deg,
    color-mix(in srgb, var(--card-accent, var(--lc-accent)) 6%, var(--lc-bg-surface)),
    color-mix(in srgb, var(--card-accent, var(--lc-accent)) 12%, var(--lc-bg-surface))
  );
  box-shadow: var(--lc-shadow-card);
  cursor: pointer;
  overflow: hidden;
  transition:
    box-shadow var(--lc-duration-fast) var(--lc-ease-standard),
    transform var(--lc-duration-fast) var(--lc-ease-standard);
}

.bookmark-card:hover {
  box-shadow: var(--lc-shadow-raised);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
  margin-bottom: var(--lc-space-3);
}

.favicon-wrapper {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--lc-radius-pill);
  background-color: var(--lc-bg-subtle);
  overflow: hidden;
  cursor: pointer;
  transition: transform var(--lc-duration-fast) var(--lc-ease-standard);
}

.favicon-wrapper:hover {
  transform: scale(1.05);
}

.favicon {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.default-icon {
  font-size: 18px;
  color: var(--lc-text-muted);
}

.last-visited {
  margin-left: auto;
  padding: var(--lc-space-1) var(--lc-space-2);
  border-radius: var(--lc-radius-pill);
  background-color: var(--lc-bg-subtle);
  color: var(--lc-text-muted);
  font-size: var(--lc-font-xs);
  line-height: var(--lc-leading-tight);
  white-space: nowrap;
}

.card-body {
  margin-bottom: var(--lc-space-3);
}

.url-link {
  display: block;
  margin-bottom: var(--lc-space-1);
  color: var(--lc-text-muted);
  font-size: var(--lc-font-xs);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color var(--lc-duration-fast) var(--lc-ease-standard);
}

.url-link:hover {
  color: var(--lc-accent);
  text-decoration: underline;
}

.title {
  margin: 0 0 var(--lc-space-1);
  color: var(--lc-text-primary);
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  line-height: var(--lc-leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  margin: 0;
  color: var(--lc-text-muted);
  font-size: var(--lc-font-sm);
  line-height: var(--lc-leading-normal);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* 常规流排布，避免与 favicon / 最近访问时间抢右上角 */
.card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lc-space-1);
  margin-top: var(--lc-space-2);
}

.tag {
  padding: var(--lc-space-1);
  border-radius: var(--lc-radius-sm);
  font-size: var(--lc-font-xs);
  font-weight: var(--lc-weight-medium);
  line-height: var(--lc-leading-tight);
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--lc-space-2);
  margin-top: auto;
  padding-top: var(--lc-space-2);
  border-top: 1px solid var(--lc-border-subtle);
}

.visit-count {
  display: flex;
  align-items: center;
  gap: var(--lc-space-1);
  color: var(--lc-text-muted);
  font-size: var(--lc-font-xs);
}

.actions {
  display: flex;
  align-items: center;
  gap: var(--lc-space-1);
}

.action-btn {
  width: var(--lc-control-sm);
  height: var(--lc-control-sm);
  padding: 0;
  opacity: 0;
  transition: opacity var(--lc-duration-fast) var(--lc-ease-standard);
}

.bookmark-card:hover .action-btn,
.action-btn:focus-visible {
  opacity: 1;
}

.action-btn:hover {
  background-color: var(--lc-bg-hover);
}

:deep(mark) {
  background-color: color-mix(in srgb, var(--lc-warning) 35%, transparent);
  color: inherit;
  padding: 0 var(--lc-space-1);
  border-radius: var(--lc-radius-sm);
  font-weight: var(--lc-weight-semibold);
}
</style>
