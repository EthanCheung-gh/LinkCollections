<template>
  <div class="list-view">
    <div v-if="filteredBookmarks.length === 0" class="empty-state">
      <i class="i-heroicons-list-bullet text-6xl text-gray-300" />
      <p class="text-gray-500">
        {{ searchQuery ? 'No bookmarks match your search.' : 'No bookmarks in this folder.' }}
      </p>
      <p v-if="!searchQuery" class="text-gray-400 text-sm mt-2">
        Add a bookmark using button above
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
          <div class="favicon-cell" title="Click to refresh favicon" @click="refreshFavicon(row)">
            <img
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
              style="margin: 2px"
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

      <el-table-column prop="lastVisited" label="Last Visited" width="120" sortable="custom">
        <template #default="{ row }">
          <span class="last-visited-cell">
            {{ row.lastVisited ? formatLastVisited(row.lastVisited) : '-' }}
          </span>
        </template>
      </el-table-column>

      <el-table-column label="Actions" width="100" fixed="right">
        <template #default="{ row }">
          <el-dropdown trigger="click" @command="(cmd: string) => handleAction(cmd, row)">
            <el-button text size="small">
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
        </template>
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
import EditDialog from '../Modal/EditDialog.vue'
import type { Bookmark } from '../../types'

interface Props {
  searchQuery?: string
}

const props = withDefaults(defineProps<Props>(), {
  searchQuery: ''
})

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
  const text = `网址: ${bookmark.url}\n标题: ${bookmark.title}\n介绍: ${bookmark.description}`
  navigator.clipboard.writeText(text)
  ElMessage.success('Bookmark copied to clipboard')
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
      `Are you sure you want to delete "${bookmark.title}"?`,
      'Delete Bookmark',
      {
        confirmButtonText: 'Delete',
        cancelButtonText: 'Cancel',
        type: 'warning'
      }
    )
    await deleteBookmark(bookmark.id)
  } catch (error) {}
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

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

const getTagName = (tagId: string): string => {
  const tag = tags.value.find(t => t.id === tagId)
  return tag ? tag.name : 'Unknown'
}

const getTagColor = (tagId: string): string => {
  const tag = tags.value.find(t => t.id === tagId)
  return tag ? tag.color : '#3B82F6'
}

const tagBackgroundColor = (color: string): string => {
  const r = parseInt(color.slice(1, 3), 16)
  const g = parseInt(color.slice(3, 5), 16)
  const b = parseInt(color.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.1)`
}
</script>

<style scoped>
.list-view {
  flex: 1;
  height: 100%;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  min-height: 400px;
  color: var(--el-text-color-secondary);
}

.empty-state p {
  margin: 0;
}

.favicon-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.favicon-cell:hover {
  background-color: var(--el-fill-color-light);
}

.favicon-small {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.default-icon-small {
  font-size: 18px;
  color: var(--el-text-color-secondary);
}

.title-cell {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-weight: 600;
  color: var(--el-text-color-primary);
  cursor: pointer;
  transition: color 0.2s;
}

.title:hover {
  color: var(--el-color-primary);
}

.url {
  font-size: 12px;
  color: var(--el-color-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: opacity 0.2s;
}

.url:hover {
  opacity: 0.7;
}

.description-cell {
  font-size: 14px;
  color: var(--el-text-color-regular);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.no-tags {
  color: var(--el-text-color-secondary);
}

.visits-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-text-color-secondary);
}

.last-visited-cell {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.actions-cell {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

:deep(.el-table) {
  background-color: transparent;
}

:deep(.el-table__row) {
  transition: background-color 0.2s;
}

:deep(.el-table__row:hover) {
  background-color: var(--el-fill-color-light);
}

:deep(.el-table__header) {
  background-color: var(--el-fill-color-lighter);
}

:deep(.el-table__header th) {
  background-color: transparent;
  font-weight: 600;
}

@media (max-width: 1200px) {
  :deep(.responsive-col) {
    display: none;
  }
}

@media (max-width: 900px) {
  :deep(.el-table-column--selection .cell) {
    padding-left: 4px;
    padding-right: 4px;
  }

  .visits-cell,
  .last-visited-cell {
    font-size: 11px;
  }

  .actions-cell {
    gap: 4px;
  }

  .actions-cell .el-button {
    padding: 4px 6px;
    font-size: 12px;
  }
}

@media (max-width: 600px) {
  .list-view {
    overflow-x: auto;
  }

  :deep(.el-table) {
    min-width: 600px;
  }

  .title {
    font-size: 14px;
  }

  .url {
    font-size: 11px;
  }

  :deep(.last-visited),
  :deep(.visits-cell) {
    display: none;
  }
}

:deep(mark) {
  background-color: #fef08a;
  color: inherit;
  padding: 0 2px;
  border-radius: 2px;
  font-weight: 600;
}
</style>
