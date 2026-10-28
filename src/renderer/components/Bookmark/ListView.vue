<template>
  <div class="list-view">
    <div
      v-if="filteredBookmarks.length === 0"
      class="empty-state"
    >
      <i class="i-heroicons-list-bullet empty-icon" />
      <p class="empty-title">
        {{ searchQuery ? t('search.noMatch') : t('bookmark.empty') }}
      </p>
      <p
        v-if="!searchQuery"
        class="empty-hint"
      >        Add a bookmark using button above
      </p>
    </div>

    <el-table
      v-else
      :data="filteredBookmarks"
      stripe
      style="width: 100%"
      @sort-change="handleSortChange"
    >
      <el-table-column width="50">
        <template #default="{ row }">
          <div
            class="favicon-cell"
            :title="t('bookmark.refreshFavicon')"
            @click="refreshFavicon(row)"
          >            <img
              v-if="row.favicon"
              :src="row.favicon"
              :alt="row.title"
              class="favicon-small"
              @error="handleFaviconError(row)"
            />
            <i v-else class="i-heroicons-globe-alt default-icon-small" />
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="title" label="Title" min-width="200">
        <template #default="{ row }">
          <div class="title-cell">
            <div
              class="title"
              @click="handleUrlClick(row)"
              v-html="highlightText(row.title, props.searchQuery)"
            />
            <div
              class="url"
              @click="handleUrlClick(row)"
              v-html="highlightText(row.url, props.searchQuery)"
            />
          </div>
        </template>
      </el-table-column>

      <el-table-column
        prop="description"
        label="Description"
        min-width="250"
        class-name="responsive-col"
      >
        <template #default="{ row }">
          <div class="description-cell">
            <span v-html="highlightText(row.description || '-', props.searchQuery)" />
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="tags" label="Tags" width="200" class-name="responsive-col">
        <template #default="{ row }">
          <div class="tags-cell">
            <el-tag
              v-for="tagId in row.tags"
              :key="tagId"
              size="small"
              :color="tagBackgroundColor(getTagColor(tagId))"
              effect="plain"
            >
              <span v-html="highlightText(getTagName(tagId), props.searchQuery)" />
            </el-tag>
            <span v-if="row.tags.length === 0" class="no-tags">-</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column prop="visitCount" label="Visits" width="80" sortable="custom">
        <template #default="{ row }">
          <div class="visits-cell">
            <i class="i-heroicons-chart-bar" />
            <span>{{ row.visitCount || 0 }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column
        prop="lastVisited"
        :label="t('bookmark.lastVisited')"
        width="120"
        sortable="custom"
      >        <template #default="{ row }">
          <span class="last-visited-cell">
            {{ row.lastVisited ? formatLastVisited(row.lastVisited) : '-' }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="Actions" width="100" fixed="right">
        <template #default="{ row }">
          <div class="actions-cell">
            <el-dropdown
              trigger="click"
              @command="(cmd: string) => handleAction(cmd, row)"
            >
              <el-button
                text
                size="small"
              >
                <i class="i-heroicons-ellipsis-horizontal" />
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
          </div>        </template>
      </el-table-column>
    </el-table>

    <EditDialog v-model="editDialogVisible" :bookmark="editingBookmark" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useBookmarkStore, useFolderStore, useTagStore, useUIStore } from '../../stores'
import { highlightText } from '../../utils/highlight'
import { getFaviconUrl } from '../../utils/favicon'
import { isValidColor } from '../../utils/validation'
import EditDialog from '../Modal/EditDialog.vue'
import type { Bookmark } from '../../types'
import { useI18n } from 'vue-i18n'

interface Props {
  searchQuery?: string
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: ''
})

const { t } = useI18n()

const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const uiStore = useUIStore()
const { bookmarks } = storeToRefs(bookmarkStore)
const { currentFolderId } = storeToRefs(folderStore)
const { tags, selectedTagIds } = storeToRefs(tagStore)
const { settings } = storeToRefs(uiStore)
const { deleteBookmark, incrementVisitCount } = bookmarkStore

const editDialogVisible = ref(false)
const editingBookmark = ref<Bookmark | null>(null)
const sortProp = ref<string>('')
const sortOrder = ref<'ascending' | 'descending' | null>(null)

const browsers = computed(() => {
  if (!settings.value?.availableBrowsers) return []
  return settings.value.availableBrowsers.filter(b => b.path.trim() !== '')
})

const filteredBookmarks = computed(() => {
  let filtered = bookmarks.value

  if (currentFolderId.value) {
    filtered = filtered.filter(b => b.folderId === currentFolderId.value)
  }

  if (selectedTagIds.value && selectedTagIds.value.length > 0) {
    filtered = filtered.filter(b => selectedTagIds.value.some(tagId => b.tags.includes(tagId)))
  }

  if (props.searchQuery && props.searchQuery.trim()) {
    const query = props.searchQuery.toLowerCase()
    filtered = filtered.filter(
      b =>
        b.title.toLowerCase().includes(query) ||
        b.url.toLowerCase().includes(query) ||
        b.description.toLowerCase().includes(query)
    )
  }

  if (sortProp.value && sortOrder.value) {
    filtered = [...filtered].sort((a, b) => {
      let valA: any
      let valB: any

      switch (sortProp.value) {
        case 'visitCount':
          valA = a.visitCount || 0
          valB = b.visitCount || 0
          break
        case 'lastVisited':
          valA = a.lastVisited ? new Date(a.lastVisited).getTime() : 0
          valB = b.lastVisited ? new Date(b.lastVisited).getTime() : 0
          break
        default:
          return 0
      }

      if (sortOrder.value === 'ascending') {
        return valA > valB ? 1 : -1
      } else {
        return valA < valB ? 1 : -1
      }
    })
  }

  return filtered
})

const handleEdit = (bookmark: Bookmark) => {
  editingBookmark.value = bookmark
  editDialogVisible.value = true
}

const handleShare = (bookmark: Bookmark) => {
  const text = `${t('form.url')}: ${bookmark.url}\n${t('form.title')}: ${bookmark.title}\n${t('form.description')}: ${bookmark.description}`
  navigator.clipboard.writeText(text)
  ElMessage.success(t('bookmark.copySuccess'))
}

const handleUrlClick = async (bookmark: Bookmark) => {
  const defaultBrowser = settings.value?.defaultBrowser || ''
  const browserPath =
    typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser?.path || ''
  await window.electronAPI.openBrowser(bookmark.url, browserPath)
  await incrementVisitCount(bookmark.id)
}

const handleDelete = async (bookmark: Bookmark) => {
  try {
    await ElMessageBox.confirm(
      t('dialog.confirmDeleteBookmarkNamed', { name: bookmark.title }),
      t('dialog.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
    await deleteBookmark(bookmark.id)
  } catch (error) {
    // 取消确认时 ElMessageBox 会 reject（'cancel'/'close'），无需提示；
    // 真正的删除失败已在 store 内 toast 并 rethrow，这里只记录，避免未处理的 rejection。
    if (error !== 'cancel' && error !== 'close') {
      console.error('[ListView] Failed to delete bookmark:', error)
    }
  }
}

const handleAction = async (command: string, bookmark: Bookmark) => {
  if (command === 'delete') {
    await handleDelete(bookmark)
    return
  }

  if (command === 'edit') {
    handleEdit(bookmark)
    return
  }

  if (command === 'share') {
    handleShare(bookmark)
    return
  }

  if (command === 'open-default') {
    const defaultBrowser = settings.value?.defaultBrowser || ''
    const browserPath =
      typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser?.path || ''
    await window.electronAPI.openBrowser(bookmark.url, browserPath)
    await incrementVisitCount(bookmark.id)
    return
  }

  if (command.startsWith('open-browser-')) {
    const index = parseInt(command.split('-')[2])
    const browser = browsers.value[index]
    if (browser) {
      await window.electronAPI.openBrowser(bookmark.url, browser.path)
      await incrementVisitCount(bookmark.id)
    }
    return
  }
}

const handleSortChange = (prop: any) => {
  sortProp.value = prop.prop
  sortOrder.value = prop.order
}

const handleFaviconError = (bookmark: Bookmark) => {
  bookmarkStore.updateBookmark(bookmark.id, { favicon: '' }, false)
}

const refreshFavicon = (bookmark: Bookmark) => {
  const newFavicon = getFaviconUrl(
    bookmark.url,
    settings.value?.faviconService,
    settings.value?.useForeignFavicon
  )
  if (newFavicon) {
    bookmarkStore.updateBookmark(bookmark.id, { favicon: newFavicon }, false)
  }
}

const formatLastVisited = (date: string) => {
  const now = new Date()
  const visited = new Date(date)
  const diffMs = now.getTime() - visited.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return t('bookmark.justNow')
  if (diffMins < 60) return t('bookmark.minutesAgo', { n: diffMins })

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return t('bookmark.hoursAgo', { n: diffHours })

  const diffDays = Math.floor(diffHours / 24)
  return t('bookmark.daysAgo', { n: diffDays })
}

const getTagName = (tagId: string): string => {
  const found = tags.value.find(tag => tag.id === tagId)
  return found ? found.name : t('bookmark.unknown')
}

const getTagColor = (tagId: string): string => {
  const found = tags.value.find(tag => tag.id === tagId)
  // B1 / C16: tag.color 可能是 null（编辑弹窗 Clear）或非法值，交给 tagBackgroundColor 兜底
  return found && found.color ? found.color : ''
}

const tagBackgroundColor = (color?: string | null): string => {
  const safeColor = color && isValidColor(color) ? color : 'var(--lc-accent)'
  return `color-mix(in srgb, ${safeColor} 10%, transparent)`
}
</script>

<style scoped>
.list-view {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* 空态在内容区可用高度内垂直 + 水平居中（不再用 min-height:400px） */
.empty-state {
  flex: 1;
  min-height: 0;
  height: 100%;
  width: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--lc-space-4);
  text-align: center;
}

.empty-icon {
  font-size: 64px;
  color: var(--lc-text-muted);
}

.empty-title {
  margin: 0;
  font-size: var(--lc-font-lg);
  color: var(--lc-text-primary);
  line-height: var(--lc-leading-tight);
}

.empty-hint {
  margin: 0;
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
  line-height: var(--lc-leading-normal);
}

.favicon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--lc-space-1);
  border-radius: var(--lc-radius-sm);
  cursor: pointer;
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.favicon-cell:hover {
  background-color: var(--lc-bg-hover);
}

.favicon-small {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.default-icon-small {
  font-size: 18px;
  color: var(--lc-text-muted);
}

.title-cell {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-1);
}

.title {
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
  cursor: pointer;
  transition: color var(--lc-duration-fast) var(--lc-ease-standard);
}

.title:hover {
  color: var(--lc-accent);
}

.url {
  font-size: var(--lc-font-xs);
  color: var(--lc-accent);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color var(--lc-duration-fast) var(--lc-ease-standard);
}

.url:hover {
  color: var(--lc-accent-hover);
}

.description-cell {
  font-size: var(--lc-font-sm);
  color: var(--lc-text-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-cell {
  display: flex;
  flex-wrap: wrap;
  gap: var(--lc-space-1);
}

.tags-cell :deep(.el-tag) {
  margin: 0;
  border-radius: var(--lc-radius-pill);
}

.no-tags {
  color: var(--lc-text-muted);
}

.visits-cell {
  display: flex;
  align-items: center;
  gap: var(--lc-space-1);
  color: var(--lc-text-muted);
}

.last-visited-cell {
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
}

.actions-cell {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.actions-cell :deep(.el-button) {
  min-width: var(--lc-control-sm);
  height: var(--lc-control-sm);
  padding: 0;
}

.actions-cell :deep(.el-button:focus-visible) {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}

/* 表格皮肤统一走 EP 变量，随之而来的行高 / 分隔线 / 表头全部由 token 驱动 */
:deep(.el-table) {
  --el-table-bg-color: var(--lc-bg-surface);
  --el-table-tr-bg-color: var(--lc-bg-surface);
  --el-table-header-bg-color: var(--lc-bg-subtle);
  --el-table-border-color: var(--lc-border-subtle);
  --el-table-row-hover-bg-color: var(--lc-bg-hover);
  --el-table-header-text-color: var(--lc-text-primary);
  --el-table-text-color: var(--lc-text-regular);
  font-size: var(--lc-font-sm);
}

:deep(.el-table th.el-table__cell),
:deep(.el-table td.el-table__cell) {
  height: var(--lc-control-lg);
  border-bottom: 1px solid var(--lc-border-subtle);
}

:deep(.el-table th.el-table__cell) {
  background-color: var(--lc-bg-subtle);
  font-size: var(--lc-font-sm);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
}

:deep(.el-table__row) {
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

@media (max-width: 1200px) {
  :deep(.responsive-col) {
    display: none;
  }
}

@media (max-width: 900px) {
  :deep(.el-table-column--selection .cell) {
    padding-left: var(--lc-space-1);
    padding-right: var(--lc-space-1);
  }

  .visits-cell,
  .last-visited-cell {
    font-size: var(--lc-font-xs);
  }
}

@media (max-width: 600px) {
  .list-view {
    overflow-x: auto;
  }

  :deep(.el-table) {
    min-width: 600px;
  }

  :deep(.last-visited),
  :deep(.visits-cell) {
    display: none;
  }
}

:deep(mark) {
  background-color: color-mix(in srgb, var(--lc-warning) 35%, transparent);
  color: inherit;
  padding: 0 var(--lc-space-1);
  border-radius: var(--lc-radius-sm);
  font-weight: var(--lc-weight-semibold);
}
</style>
