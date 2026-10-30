<template>
  <div class="list-view">
    <!--
      排序工具条：与表格同级、位于表格上方（不挤压表格高度预算）。
      控件直接读写 sort store，与 CardView 共用同一份排序状态；
      表格表头的排序箭头由 syncTableSort() 反向投影回来，两者双向同步。
    -->
    <div class="list-toolbar">
      <SortControl />
    </div>

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

    <!--
      表格放进独立的滚动容器：批量条要固定在内容区底部，
      只有把「可滚动区域」和「底部条」分开，长列表才不会把批量条顶出可视区。
    -->
    <div
      v-else
      class="table-scroll"
    >
      <el-table
        ref="tableRef"
        :key="tableKey"
        :data="filteredBookmarks"
        row-key="id"
        stripe
        style="width: 100%"
        @sort-change="handleSortChange"
        @selection-change="handleSelectionChange"
        @row-click="handleRowClick"
      >
        <!-- 选中模式下才出现勾选列（row-key + :key 重建，避免动态列残留） -->
        <el-table-column
          v-if="isSelecting"
          type="selection"
          width="46"
        />

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

        <el-table-column
        prop="title"
        :label="t('form.title')"
        min-width="200"
      >
          <template #default="{ row }">
            <div class="title-cell">
              <div class="title-line">
                <i
                  v-if="row.pinned"
                  class="i-heroicons-star-solid pinned-mark"
                  aria-hidden="true"
                />
                <div
                  class="title"
                  @click="handleUrlClick(row)"
                  v-html="highlightText(row.title, props.searchQuery)"
                />
              </div>
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
          :label="t('form.description')"
          min-width="250"
          class-name="responsive-col"
        >
          <template #default="{ row }">
            <div class="description-cell">
              <span v-html="highlightText(row.description || '-', props.searchQuery)" />
            </div>
          </template>
        </el-table-column>

        <el-table-column
        prop="tags"
        :label="t('form.tags')"
        width="200"
        class-name="responsive-col"
      >
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

        <el-table-column
        prop="visitCount"
        :label="t('bookmark.visitCount')"
        width="80"
        sortable="custom"
      >
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

        <el-table-column
          v-if="!isSelecting"
          :label="t('common.actions')"
          width="100"
          fixed="right"
        >
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
                      {{ t('common.edit') }}
                    </el-dropdown-item>
                    <el-dropdown-item command="share">
                      <i class="i-heroicons-share mr-2" />
                      {{ t('bookmark.share') }}
                    </el-dropdown-item>
                    <el-dropdown-item
                      divided
                      command="open-default"
                    >
                      <i class="i-heroicons-arrow-top-right-on-square mr-2" />
                      {{ t('bookmark.openInDefaultBrowser') }}
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-for="(browser, index) in browsers"
                      :key="index"
                      :command="`open-browser-${index}`"
                    >
                      <i class="i-heroicons-globe-alt mr-2" />
                      {{ browser.name || t('bookmark.browserN', { n: index + 1 }) }}
                    </el-dropdown-item>
                    <el-dropdown-item
                      divided
                      command="delete"
                    >
                      <i class="i-heroicons-trash mr-2" />
                      {{ t('common.delete') }}
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <Transition name="bulk-bar">
      <BulkActionBar v-if="isSelecting" />
    </Transition>

    <EditDialog v-model="editDialogVisible" :bookmark="editingBookmark" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import type { TableColumnCtx, TableInstance } from 'element-plus'
import { storeToRefs } from 'pinia'
import {
  useBookmarkStore,
  useFolderStore,
  useSelectionStore,
  useSortStore,
  useTagStore,
  useUIStore
} from '../../stores'
import { highlightText } from '../../utils/highlight'
import { getFaviconUrl } from '../../utils/favicon'
import { isValidColor } from '../../utils/validation'
import BulkActionBar from './BulkActionBar.vue'
import SortControl from './SortControl.vue'
import EditDialog from '../Modal/EditDialog.vue'
import type { Bookmark } from '../../types'
import type { SortKey } from '../../stores'
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
const selectionStore = useSelectionStore()
const sortStore = useSortStore()
const { bookmarks } = storeToRefs(bookmarkStore)
const { currentFolderSubtreeIds } = storeToRefs(folderStore)
const { tags, selectedTagIds } = storeToRefs(tagStore)
const { settings } = storeToRefs(uiStore)
const { isSelecting } = storeToRefs(selectionStore)
const { deleteBookmark, incrementVisitCount } = bookmarkStore

/**
 * 选择模式切换时强制重建表格（`:key`）：勾选列 / Actions 列都是条件渲染的，
 * 动态增删列在 el-table 里依赖内部列注册，重建是最确定的路径。
 */
const tableKey = computed(() => (isSelecting.value ? 'with-selection' : 'default'))
const tableRef = ref<TableInstance>()

const editDialogVisible = ref(false)
const editingBookmark = ref<Bookmark | null>(null)

const browsers = computed(() => {
  if (!settings.value?.availableBrowsers) return []
  return settings.value.availableBrowsers.filter(b => b.path.trim() !== '')
})

/**
 * 只有这两列在表头可排序（`sortable="custom"`）。title / createdAt 没有可排序列，
 * 只能通过上方工具条排序 —— 表头排序箭头在这两种键下保持清空。
 */
const SORTABLE_COLUMNS: readonly SortKey[] = ['visitCount', 'lastVisited']

const filteredBookmarks = computed(() => {
  let filtered = bookmarks.value

  // 选中文件夹 = 展示「该文件夹 + 全部后代」的书签（与 CardView 逻辑保持一致）。
  // currentFolderSubtreeIds 为 null 表示「全部书签」（currentFolderId === ''），不过滤。
  const subtreeIds = currentFolderSubtreeIds.value
  if (subtreeIds) {
    filtered = filtered.filter(b => b.folderId !== '' && subtreeIds.has(b.folderId))
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

  // 排序 + 置顶优先统一由 sort store 处理（纯函数，返回新数组）：
  // 子树过滤 → 标签过滤 → 搜索过滤 → 排序，顺序不变。
  return sortStore.applySort(filtered)
})

/* =============================================================================
 * 表头排序 ⇄ sort store 双向同步
 *
 * - 表头 → store：`handleSortChange`（el-table `sort-change`）用显式方向写入 store；
 *   `order === null`（第三次点击表头）→ reset()。
 * - store → 表头：`syncTableSort()` 用命令式 `table.sort(prop, order)` / `clearSort()`
 *   把当前状态投影成表头箭头。
 *
 * 为什么不用 `:default-sort`：它只在表格初始化（含本组件里 `:key` 重建）时生效一次，
 * 工具条改排序时无法回头更新箭头；而 `table.sort()` 是唯一能随时改箭头的入口。
 * 程序化调用会同步 emit `sort-change`（EP 在 `changeSortCondition` 里同步 emit），
 * 用 `applyingSortToTable` 闸门屏蔽这一轮回流，避免「投影 → 回写 → 再投影」。
 * ========================================================================== */
let applyingSortToTable = false

/** 把 store 里的排序状态投影到表头箭头（只有存在的可排序列才会出现箭头） */
const syncTableSort = () => {
  const table = tableRef.value
  if (!table) return

  const key = sortStore.sortKey
  applyingSortToTable = true
  try {
    if (!SORTABLE_COLUMNS.includes(key)) {
      // 'default' / 'title' / 'createdAt'：没有对应列（或不需要排序），清空箭头
      table.clearSort()
      return
    }
    table.sort(key, sortStore.sortDirection === 'asc' ? 'ascending' : 'descending')
  } finally {
    applyingSortToTable = false
  }
}

/** 表头 → store。注意 `sort-change` 的 prop 在「取消排序」时为 null。 */
const handleSortChange = ({ prop, order }: { prop?: string | null; order?: string | null }) => {
  if (applyingSortToTable) return

  if (!prop || !order) {
    sortStore.reset()
    return
  }

  // 未知列（理论上不会出现）当作清除排序，避免 store 里留下不可见的状态
  if (!SORTABLE_COLUMNS.includes(prop as SortKey)) {
    sortStore.reset()
    return
  }

  sortStore.setSort(prop as SortKey, order === 'ascending' ? 'asc' : 'desc')
}

/* =============================================================================
 * 与 selection store 的双向同步（el-table type="selection" 只是「投影」）
 *
 * - store → 表格：`applySelectionToTable()` 用 `toggleRowSelection(row, bool)` 回填，
 *   进入选择模式、退出、过滤条件变化后都重新对齐一次；
 * - 表格 → store：`handleSelectionChange` 只同步**当前可见**的行，
 *   被搜索/标签过滤隐藏的已选 id 必须保留（产品约定 4：计数要真实）。
 *
 * 程序化回填会同步触发 el-table 的 `selection-change`（EP 内部是同步 emit），
 * 用 `applyingFromStore` 闸门屏蔽这一轮回流，避免「回填 → 回写 store → 再回填」的抖动。
 * ========================================================================== */
let applyingFromStore = false

/** 把 store 里的选中集合投影到当前表格（只处理当前 data 里的行） */
const applySelectionToTable = () => {
  const table = tableRef.value
  if (!table || !isSelecting.value) return
  applyingFromStore = true
  try {
    for (const row of filteredBookmarks.value) {
      table.toggleRowSelection(row, selectionStore.isSelected(row.id))
    }
  } finally {
    applyingFromStore = false
  }
}

/** 表格 → store：保留被过滤隐藏的已选 id，只替换可见部分 */
const handleSelectionChange = (rows: Bookmark[]) => {
  if (applyingFromStore) return
  if (!isSelecting.value) return

  const visibleIds = new Set(filteredBookmarks.value.map(bookmark => bookmark.id))
  const next = new Set<string>()
  for (const id of selectionStore.selectedIds) {
    if (!visibleIds.has(id)) next.add(id)
  }
  for (const row of rows) {
    if (visibleIds.has(row.id)) next.add(row.id)
  }

  const changed =
    next.size !== selectionStore.count || [...next].some(id => !selectionStore.isSelected(id))
  if (changed) {
    selectionStore.selectAll([...next])
  }
}

/** 行点击 = 切换选中（勾选列自己会写 store，跳过以免双触发） */
const handleRowClick = (row: Bookmark, column?: TableColumnCtx<Bookmark>) => {
  if (!isSelecting.value) return
  if (column && column.type === 'selection') return
  selectionStore.toggle(row.id)
}

// store → 表格：选择模式切换（表格会按 :key 重建）与选中集合变化都在 DOM 更新后回填
watch(
  [() => isSelecting.value, () => selectionStore.selectedIds],
  () => {
    if (!isSelecting.value) {
      // 退出选择模式：清掉表格内部选中态（勾选列也会随之被移除）
      tableRef.value?.clearSelection()
      return
    }
    void nextTick(applySelectionToTable)
  },
  { flush: 'post' }
)

// 过滤/排序改变了可见行集合后，重新把选中态投影上去（否则勾选会「消失」），
// 同时把排序箭头对齐一次（数据从空 → 非空时表格才存在，只能在这里补投影）
watch(
  filteredBookmarks,
  () => {
    void nextTick(() => {
      applySelectionToTable()
      syncTableSort()
    })
  },
  { flush: 'post' }
)

// 排序状态变化（工具条 / 跨视图带入）与表格按 :key 重建后，都要重新投影表头箭头
watch(
  [() => sortStore.sortKey, () => sortStore.sortDirection, tableKey],
  () => {
    void nextTick(syncTableSort)
  },
  { flush: 'post' }
)

onMounted(() => {
  void nextTick(() => {
    applySelectionToTable()
    syncTableSort()
  })
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
  // 选择模式下不打开链接：交给 row-click 统一处理「切换选中」
  if (isSelecting.value) return

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

const handleFaviconError = (bookmark: Bookmark) => {
  bookmarkStore.updateBookmark(bookmark.id, { favicon: '' }, false)
}

const refreshFavicon = (bookmark: Bookmark) => {
  // 选择模式下点图标不刷新 favicon：交给 row-click 统一「切换选中」
  if (isSelecting.value) return

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

/*
 * 排序工具条：左对齐（与 CardView 完全一致的排版；表格左边缘与内容区左内边距天然对齐，
 * 右对齐会被 .table-scroll 的滚动条占位挤偏）。不设 flex:1，避免挤压表格高度。
 */
.list-toolbar {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-start;
  margin-bottom: var(--lc-space-3);
}

/*
 * 表格的滚动容器：让「表格区」占满剩余高度并自己滚动，
 * 底部的批量条（BulkActionBar）才能稳定停在内容区底部，而不是被长列表顶出可视区。
 */
.table-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
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

.title-line {
  display: flex;
  align-items: center;
  gap: var(--lc-space-1);
  min-width: 0;
}

/* 置顶标识：仅置顶时出现，用强调色；不占用操作列/标签列 */
.pinned-mark {
  flex-shrink: 0;
  font-size: var(--lc-font-sm);
  color: var(--lc-accent);
}

.title {
  min-width: 0;
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
