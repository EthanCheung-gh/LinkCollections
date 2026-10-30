<template>
  <div class="card-view">
    <div
      v-if="filteredBookmarks.length === 0"
      class="empty-state"
    >
      <i class="i-heroicons-bookmark empty-icon" />
      <p class="empty-title">
        {{ searchQuery ? t('search.noMatch') : t('bookmark.empty') }}
      </p>
      <p
        v-if="!searchQuery"
        class="empty-hint"
      >
        {{ t('bookmark.emptyHint') }}
      </p>
    </div>

    <div
      v-else
      class="card-grid"
    >
      <BookmarkCard
        v-for="bookmark in filteredBookmarks"
        :key="bookmark.id"
        :bookmark="bookmark"
        :search-query="searchQuery"
        @edit="handleEdit"
      />
    </div>

    <Transition name="bulk-bar">
      <BulkActionBar v-if="isSelecting" />
    </Transition>

    <EditDialog
      v-model="editDialogVisible"
      :bookmark="editingBookmark"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import {
  useBookmarkStore,
  useFolderStore,
  useSelectionStore,
  useTagStore
} from '../../stores'
import BookmarkCard from './BookmarkCard.vue'
import BulkActionBar from './BulkActionBar.vue'
import EditDialog from '../Modal/EditDialog.vue'
import type { Bookmark } from '../../types'

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
const selectionStore = useSelectionStore()
const { bookmarks } = storeToRefs(bookmarkStore)
const { currentFolderSubtreeIds } = storeToRefs(folderStore)
const { selectedTagIds } = storeToRefs(tagStore)
// 选择模式下网格下方渲染批量条（不参与空态/网格逻辑）
const { isSelecting } = storeToRefs(selectionStore)

const editDialogVisible = ref(false)
const editingBookmark = ref<any>(null)

/**
 * 置顶优先分组：先拼接置顶项、再拼接其余项，**组内保持入参顺序**
 * （`filter` 天然稳定，不引入额外比较器去扰动既有顺序）。
 * ListView 里有一份语义完全一致的实现（那边必须在既有列排序「之后」调用），
 * 两处改动请保持同步。
 */
const pinnedFirst = (list: Bookmark[]) => [
  ...list.filter(b => b.pinned === true),
  ...list.filter(b => b.pinned !== true)
]

const filteredBookmarks = computed(() => {
  let filtered = bookmarks.value

  // 选中文件夹 = 展示「该文件夹 + 全部后代」的书签（与 ListView 逻辑保持一致）。
  // currentFolderSubtreeIds 为 null 表示「全部书签」（currentFolderId === ''），不过滤。
  const subtreeIds = currentFolderSubtreeIds.value
  if (subtreeIds) {
    filtered = filtered.filter(b => b.folderId !== '' && subtreeIds.has(b.folderId))
  }

  if (selectedTagIds.value.length > 0) {
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

  return pinnedFirst(filtered)
})

const handleEdit = (bookmark: any) => {
  editingBookmark.value = bookmark
  editDialogVisible.value = true
}
</script>

<style scoped>
.card-view {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.card-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: min-content;
  align-content: start;
  gap: var(--lc-space-4);
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

@media (min-width: 1600px) {
  .card-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (max-width: 1200px) {
  .card-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 900px) {
  .card-grid {
    grid-template-columns: 1fr;
  }
}

/* 空态在内容区可用高度内垂直 + 水平居中（不再用 min-height:400px 顶在上 1/3 处） */
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
</style>
