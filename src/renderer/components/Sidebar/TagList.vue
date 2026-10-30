<template>
  <div class="tag-list">
    <div class="tag-list-header">
      <h3 class="tag-list-title">
        {{ t('sidebar.tags') }}
      </h3>
      <el-button
        size="small"
        text
        class="add-btn"
        @click="showAddTagDialog = true"
      >
        <i class="i-heroicons-plus" />
      </el-button>
    </div>

    <div class="tag-items">
      <div
        v-for="tag in tags"
        :key="tag.id"
        class="tag-item"
        :class="{ active: selectedTagIds.includes(tag.id) }"
        @click="handleTagClick(tag.id)"
        @contextmenu.prevent="handleContextMenu($event, tag)"
      >
        <span
          class="tag-gutter"
          aria-hidden="true"
        />
        <div
          class="tag-dot"
          :style="{ backgroundColor: tag.color }"
        />
        <span class="tag-name">{{ tag.name }}</span>
      </div>
    </div>

    <AddTagDialog v-model="showAddTagDialog" />
    <EditTagDialog
      v-model="showEditTagDialog"
      :tag="editingTag"
      @updated="handleTagUpdate"
    />

    <teleport to="body">
      <div
        v-if="contextMenuVisible"
        class="context-menu"
        :style="{ left: contextMenuPosition.x + 'px', top: contextMenuPosition.y + 'px' }"
        @click.stop
      >
        <div
          class="context-menu-item"
          @click="handleTagAction('edit', contextMenuTag.id)"
        >
          <i class="i-heroicons-pencil" />
          <span>{{ t('common.edit') }}</span>
        </div>
        <div
          class="context-menu-item"
          @click="handleTagAction('delete', contextMenuTag.id)"
        >
          <i class="i-heroicons-trash" />
          <span>{{ t('common.delete') }}</span>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { useTagStore, useUIStore } from '../../stores'
import AddTagDialog from '../Modal/AddTagDialog.vue'
import EditTagDialog from '../Modal/EditTagDialog.vue'

const { t } = useI18n()
const tagStore = useTagStore()
const uiStore = useUIStore()
const { tags, selectedTagIds } = storeToRefs(tagStore)
const { toggleTag, updateTag, deleteTag } = tagStore
const { setCurrentView } = uiStore

const showAddTagDialog = ref(false)
const showEditTagDialog = ref(false)
const editingTag = ref<any>(null)
const contextMenuTag = ref<any>(null)
const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })

const handleTagClick = (id: string) => {
  toggleTag(id)
  setCurrentView('bookmarks')
}

const handleContextMenu = (event: MouseEvent, tag: any) => {
  contextMenuTag.value = tag
  contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  contextMenuVisible.value = true
}

const handleTagAction = async (command: string, id: string) => {
  if (command === 'edit') {
    hideContextMenu()

    const tag = tags.value.find(t => t.id === id)
    if (tag) {
      editingTag.value = { ...tag }
      setTimeout(() => {
        showEditTagDialog.value = true
      }, 50)
    }
    return
  }

  if (command === 'delete') {
    hideContextMenu()

    try {
      await ElMessageBox.confirm(t('dialog.confirmDeleteTag'), t('dialog.confirmDelete'), {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      })
      await deleteTag(id)
    } catch {
      // User cancelled
    }
  }
}

// B4: 唯一的写库路径在父组件；弹窗只 emit，不再自己调用 store / 弹提示。
// 失败提示由 store 统一发出，这里不重复提示。
const handleTagUpdate = async (updates: any) => {
  if (editingTag.value && editingTag.value.id) {
    try {
      await updateTag(editingTag.value.id, updates)
      showEditTagDialog.value = false
    } catch {
      // store 已提示失败，保持弹窗打开便于用户重试
    }
  }
}

const hideContextMenu = () => {
  contextMenuVisible.value = false
}

onMounted(() => {
  document.addEventListener('click', hideContextMenu)
})

onUnmounted(() => {
  document.removeEventListener('click', hideContextMenu)
})
</script>

<style scoped>
.tag-list {
  margin-bottom: var(--lc-space-6);
}

.tag-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 横向 padding 归零：标题左边缘与 logo / 搜索框共用一条线 */
  padding: 0;
  margin-bottom: var(--lc-space-2);
}

.tag-list-title {
  margin: 0;
  font-size: var(--lc-font-sm);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-muted);
  line-height: var(--lc-leading-tight);
}

.add-btn {
  padding: 0;
  width: var(--lc-control-sm);
  height: var(--lc-control-sm);
  border-radius: var(--lc-radius-sm);
  /* 与折叠按钮共用同一条右边缘 */
  flex: 0 0 auto;
}

.add-btn:hover {
  background-color: var(--lc-bg-hover);
}

.tag-items {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-1);
  padding: 0;
}

/* 行高与 FolderList 完全一致 */
/* 与 FolderList 的折叠箭头槽等宽（16px）：让标签圆点与文件夹图标落在同一列。
   标签本身没有层级，槽位仅用于对齐。 */
.tag-gutter {
  width: var(--lc-space-4);
  height: var(--lc-space-4);
  flex: 0 0 auto;
}

.tag-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  padding: var(--lc-space-2) 0;
  min-height: var(--lc-control-md);
  border-radius: var(--lc-radius-md);
  cursor: pointer;
  color: var(--lc-text-regular);
  transition:
    background-color var(--lc-duration-fast) var(--lc-ease-standard),
    color var(--lc-duration-fast) var(--lc-ease-standard);
}

.tag-item:hover {
  background-color: var(--lc-bg-hover);
}

/* 选中态：统一底纹 + accent 文字 + 左侧 2px 指示条（inset 阴影，避免文字位移） */
.tag-item.active {
  background-color: var(--lc-bg-active);
  color: var(--lc-accent);
  box-shadow: inset 2px 0 0 var(--lc-accent);
}

.tag-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.tag-name {
  font-size: var(--lc-font-base);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.context-menu {
  position: fixed;
  z-index: 9999;
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
  box-shadow: var(--lc-shadow-raised);
  padding: var(--lc-space-1) 0;
  min-width: 150px;
}

.context-menu .context-menu-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  padding: var(--lc-space-2) var(--lc-space-3);
  cursor: pointer;
  font-size: var(--lc-font-base);
  color: var(--lc-text-regular);
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.context-menu .context-menu-item:hover {
  background-color: var(--lc-bg-hover);
}

.context-menu .context-menu-item i {
  font-size: 16px;
}
</style>
