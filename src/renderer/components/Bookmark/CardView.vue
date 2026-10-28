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
import { useBookmarkStore, useFolderStore, useTagStore } from '../../stores'
import BookmarkCard from './BookmarkCard.vue'
import EditDialog from '../Modal/EditDialog.vue'

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
const { bookmarks } = storeToRefs(bookmarkStore)
const { currentFolderId } = storeToRefs(folderStore)
const { selectedTagIds } = storeToRefs(tagStore)

const editDialogVisible = ref(false)
const editingBookmark = ref<any>(null)

const filteredBookmarks = computed(() => {
  let filtered = bookmarks.value

  if (currentFolderId.value) {
    filtered = filtered.filter(b => b.folderId === currentFolderId.value)
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

  return filtered
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
