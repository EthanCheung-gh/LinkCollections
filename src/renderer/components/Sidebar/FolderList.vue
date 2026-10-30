<template>
  <div class="folder-list">
    <div class="folder-list-header">
      <h3 class="folder-list-title">
        {{ t('sidebar.folders') }}
      </h3>
      <el-button
        size="small"
        text
        class="add-btn"
        @click="showAddFolderDialog = true"
      >
        <i class="i-heroicons-plus" />
      </el-button>
    </div>

    <div class="folder-items">
      <div
        class="folder-item"
        :class="{ active: currentFolderId === '' }"
        @click="handleFolderClick('')"
      >
        <div class="folder-item-content">
          <!-- 与文件夹行的折叠箭头槽等宽：保证「全部书签」与各级文件夹的图标列对齐 -->
          <span
            class="folder-toggle-placeholder"
            aria-hidden="true"
          />
          <div class="folder-icon-wrapper all-bookmarks-icon">
            <i class="i-heroicons-bookmark" />
          </div>
          <span class="folder-name">{{ t('sidebar.allBookmarks') }}</span>
        </div>
      </div>

      <div
        v-for="folder in visibleFolders"
        :key="folder.id"
        class="folder-item"
        :class="{ active: folder.id === currentFolderId }"
        :style="{ paddingLeft: `calc(var(--lc-space-3) * ${folder.depth})` }"
        @click="handleFolderClick(folder.id)"
        @contextmenu.prevent="handleContextMenu($event, folder)"
      >
        <div class="folder-item-content">
          <button
            v-if="folder.hasChildren"
            type="button"
            class="folder-toggle"
            :aria-label="isCollapsed(folder.id) ? t('folder.expand') : t('folder.collapse')"
            :aria-expanded="!isCollapsed(folder.id)"
            @click.stop="toggleCollapse(folder.id)"
          >
            <i
              class="i-heroicons-chevron-right"
              :class="{ expanded: !isCollapsed(folder.id) }"
            />
          </button>
          <span
            v-else
            class="folder-toggle-placeholder"
            aria-hidden="true"
          />
          <div
            class="folder-icon-wrapper"
            :style="{ backgroundColor: folder.color || '#3B82F6' }"
          >
            <i class="i-heroicons-folder" />
          </div>
          <span class="folder-name">{{ folder.name }}</span>
        </div>
        <el-dropdown
          trigger="click"
          @command="(command: string) => handleFolderAction(command, folder.id)"
        >
          <span
            class="folder-actions"
            @click.stop
          >
            <i class="i-heroicons-ellipsis-vertical" />
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="delete">
                <i class="i-heroicons-trash mr-2" />
                {{ t('common.delete') }}
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <AddFolderDialog v-model="showAddFolderDialog" />
    <EditFolderDialog
      v-model="showEditFolderDialog"
      :folder="editingFolder"
      @updated="handleFolderUpdate"
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
          @click="handleFolderAction('edit', contextMenuFolder.id)"
        >
          <i class="i-heroicons-pencil" />
          <span>{{ t('common.edit') }}</span>
        </div>
        <div
          class="context-menu-item"
          @click="handleFolderAction('delete', contextMenuFolder.id)"
        >
          <i class="i-heroicons-trash" />
          <span>{{ t('common.delete') }}</span>
        </div>
      </div>
    </teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { useFolderStore, useUIStore } from '../../stores'
import type { Folder, FolderTreeNode } from '../../types'
import AddFolderDialog from '../Modal/AddFolderDialog.vue'
import EditFolderDialog from '../Modal/EditFolderDialog.vue'

const { t } = useI18n()
const folderStore = useFolderStore()
const uiStore = useUIStore()
const { folders, currentFolderId, folderTree } = storeToRefs(folderStore)
const { setCurrentFolder, updateFolder, deleteFolder } = folderStore
const { setCurrentView } = uiStore

const showAddFolderDialog = ref(false)
const showEditFolderDialog = ref(false)
const editingFolder = ref<any>(null)
const contextMenuFolder = ref<any>(null)
const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })

/**
 * 折叠状态**只存在内存**（不写 settings）：刷新 / 重启后回到「全部展开」。
 * 用 Set 的「替换」而非 `add/delete` 原地修改，保证 computed 能感知变化。
 */
const collapsedIds = ref<Set<string>>(new Set())

const isCollapsed = (id: string): boolean => collapsedIds.value.has(id)

const toggleCollapse = (id: string) => {
  const next = new Set(collapsedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  collapsedIds.value = next
}

/**
 * 可见行 = folderTree 裁掉已折叠节点的整个子树。
 * folderTree 是深度优先且「父在前子在后」，所以某节点之后所有 `depth` 更深的连续行
 * 就是它的子树，遇到 depth 回退即结束（不需要另外查 parentId 链）。
 */
const visibleFolders = computed<FolderTreeNode[]>(() => {
  if (collapsedIds.value.size === 0) return folderTree.value

  const result: FolderTreeNode[] = []
  let hiddenDepth: number | null = null
  for (const node of folderTree.value) {
    if (hiddenDepth !== null) {
      if (node.depth > hiddenDepth) continue
      hiddenDepth = null
    }
    result.push(node)
    if (node.hasChildren && collapsedIds.value.has(node.id)) {
      hiddenDepth = node.depth
    }
  }
  return result
})

const handleFolderClick = (id: string) => {
  setCurrentFolder(id)
  setCurrentView('bookmarks')
}

const handleContextMenu = (event: MouseEvent, folder: Folder) => {
  contextMenuFolder.value = folder
  contextMenuPosition.value = { x: event.clientX, y: event.clientY }
  contextMenuVisible.value = true
}

const handleFolderAction = async (command: string, id: string) => {
  if (command === 'edit') {
    hideContextMenu()

    const folder = folders.value.find(f => f.id === id)
    if (folder) {
      editingFolder.value = { ...folder }
      setTimeout(() => {
        showEditFolderDialog.value = true
      }, 50)
    }
    return
  }

  if (command === 'delete') {
    hideContextMenu()

    try {
      await ElMessageBox.confirm(
        t('dialog.confirmDeleteFolderCascade'),
        t('dialog.confirmDelete'),
        {
          confirmButtonText: t('common.delete'),
          cancelButtonText: t('common.cancel'),
          type: 'warning'
        }
      )
      await deleteFolder(id)
    } catch {
      // User cancelled
    }
  }
}

// B4: 唯一的写库路径在父组件；弹窗只 emit，不再自己调用 store / 弹提示。
// 失败提示由 store（message.folderAddFailed）统一发出，这里不重复提示。
const handleFolderUpdate = async (updates: any) => {
  if (editingFolder.value && editingFolder.value.id) {
    try {
      await updateFolder(editingFolder.value.id, updates)
      showEditFolderDialog.value = false
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
.folder-list {
  margin-bottom: var(--lc-space-6);
}

.folder-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 横向 padding 归零：标题左边缘与 logo / 搜索框共用一条线 */
  padding: 0;
  margin-bottom: var(--lc-space-2);
}

.folder-list-title {
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

.folder-items {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-1);
  padding: 0;
}

.folder-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--lc-space-2) 0;
  min-height: var(--lc-control-md);
  border-radius: var(--lc-radius-md);
  cursor: pointer;
  color: var(--lc-text-regular);
  transition:
    background-color var(--lc-duration-fast) var(--lc-ease-standard),
    color var(--lc-duration-fast) var(--lc-ease-standard);
}

.folder-item:hover {
  background-color: var(--lc-bg-hover);
}

/* 选中态：统一底纹 + accent 文字 + 左侧 2px 指示条（用 inset 阴影，避免图标位移） */
.folder-item.active {
  background-color: var(--lc-bg-active);
  color: var(--lc-accent);
  box-shadow: inset 2px 0 0 var(--lc-accent);
}

.folder-item-content {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 折叠箭头槽 / 叶子项占位槽：等宽等高，保证同层级叶子项与有子级项的图标列对齐 */
.folder-toggle,
.folder-toggle-placeholder {
  width: var(--lc-space-4);
  height: var(--lc-space-4);
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

.folder-toggle {
  padding: 0;
  border: none;
  background: none;
  border-radius: var(--lc-radius-sm);
  color: var(--lc-text-muted);
  cursor: pointer;
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.folder-toggle:hover {
  background-color: var(--lc-bg-hover);
}

/* 键盘可达性：与 ListView 操作按钮同一套 focus 视觉 */
.folder-toggle:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}

.folder-toggle i {
  font-size: var(--lc-font-lg);
  transition: transform var(--lc-duration-fast) var(--lc-ease-standard);
}

.folder-toggle i.expanded {
  transform: rotate(90deg);
}

.folder-icon-wrapper {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--lc-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lc-text-inverse);
}

.folder-icon-wrapper.all-bookmarks-icon {
  background-color: var(--lc-accent);
}

.folder-icon-wrapper i {
  font-size: 16px;
}

.folder-name {
  font-size: var(--lc-font-base);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-actions {
  padding: var(--lc-space-1);
  border-radius: var(--lc-radius-sm);
  opacity: 0.5;
  transition: opacity var(--lc-duration-fast) var(--lc-ease-standard);
  cursor: pointer;
  flex: 0 0 auto;
}

.folder-item:hover .folder-actions,
.folder-item.active .folder-actions,
.folder-actions:focus-visible {
  opacity: 1;
}

.folder-actions:hover {
  background-color: var(--lc-bg-hover);
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
