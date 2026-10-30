<template>
  <div class="bulk-bar">
    <!--
      批量操作条：放在内容区（CardView / ListView 的 flex 列）底部，
      **不用 position: fixed** —— 免得压住侧栏/顶栏，也不用为侧栏宽度做补偿。
      （注释写在根节点内部：<Transition> 要求单一元素子节点。）
    -->
    <span class="bulk-count">{{ t('bulk.selected', { count }) }}</span>

    <div class="bulk-actions">
      <!-- 1. 移动到文件夹 -->
      <el-dropdown
        trigger="click"
        :disabled="count === 0"
        @command="handleMove"
      >
        <el-button
          class="bulk-btn"
          :disabled="count === 0"
        >
          <i class="i-heroicons-folder-arrow-down" />
          {{ t('bulk.moveToFolder') }}
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="uncategorized">
              {{ t('bulk.uncategorized') }}
            </el-dropdown-item>
            <el-dropdown-item
              v-for="node in folderTree"
              :key="node.id"
              :command="`folder:${node.id}`"
            >
              <span :style="{ paddingLeft: `${node.depth * 12}px` }">{{ node.name }}</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <!-- 2a. 添加标签（追加，按 id 去重由主进程保证） -->
      <el-popover
        placement="top"
        :width="280"
        trigger="click"
      >
        <template #reference>
          <el-button
            class="bulk-btn"
            :disabled="count === 0"
          >
            <i class="i-heroicons-tag" />
            {{ t('bulk.addTags') }}
          </el-button>
        </template>
        <div class="tag-popover">
          <el-select
            v-model="tagsToAdd"
            multiple
            filterable
            class="tag-select"
            :placeholder="t('bulk.addTags')"
          >
            <el-option
              v-for="tag in tags"
              :key="tag.id"
              :label="tag.name"
              :value="tag.id"
            />
          </el-select>
          <el-button
            type="primary"
            class="tag-apply"
            :disabled="tagsToAdd.length === 0"
            @click="handleAddTags"
          >
            {{ t('bulk.apply') }}
          </el-button>
        </div>
      </el-popover>

      <!-- 2b. 移除标签 -->
      <el-popover
        placement="top"
        :width="280"
        trigger="click"
      >
        <template #reference>
          <el-button
            class="bulk-btn"
            :disabled="count === 0"
          >
            <i class="i-heroicons-tag" />
            {{ t('bulk.removeTags') }}
          </el-button>
        </template>
        <div class="tag-popover">
          <el-select
            v-model="tagsToRemove"
            multiple
            filterable
            class="tag-select"
            :placeholder="t('bulk.removeTags')"
          >
            <el-option
              v-for="tag in tags"
              :key="tag.id"
              :label="tag.name"
              :value="tag.id"
            />
          </el-select>
          <el-button
            type="primary"
            class="tag-apply"
            :disabled="tagsToRemove.length === 0"
            @click="handleRemoveTags"
          >
            {{ t('bulk.apply') }}
          </el-button>
        </div>
      </el-popover>

      <!-- 3. 设置颜色：change 即执行，不弹二次确认 -->
      <el-color-picker
        v-model="color"
        class="bulk-color"
        :predefine="presetColors"
        :disabled="count === 0"
        :title="t('bulk.setColor')"
        :aria-label="t('bulk.setColor')"
        @change="handleColorChange"
      />

      <!-- 4. 删除 -->
      <el-button
        class="bulk-btn is-danger"
        :disabled="count === 0"
        @click="handleDelete"
      >
        <i class="i-heroicons-trash" />
        {{ t('bulk.delete') }}
      </el-button>

      <!-- 5. 取消选择 -->
      <el-button
        text
        class="bulk-btn"
        @click="selectionStore.exit()"
      >
        {{ t('bulk.cancelSelection') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { ElMessageBox } from 'element-plus'
import {
  useBookmarkStore,
  useFolderStore,
  useSelectionStore,
  useTagStore
} from '../../stores'
import type { BulkPatch } from '../../stores'

const { t } = useI18n()

const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const selectionStore = useSelectionStore()

const { count, selectedIds } = storeToRefs(selectionStore)
const { folderTree } = storeToRefs(folderStore)
const { tags } = storeToRefs(tagStore)

/**
 * 动作对象 = **全部**选中项（不受当前搜索/标签过滤影响，产品约定 4）。
 * 每次都从 selectedIds 现算，避免缓存过期。
 */
const ids = computed<string[]>(() => [...selectedIds.value])

const presetColors = [
  '#3B82F6',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#14B8A6',
  '#64748B'
]

const tagsToAdd = ref<string[]>([])
const tagsToRemove = ref<string[]>([])
const color = ref('')

/**
 * 统一执行入口：成功 → 退出选择模式；失败 → 保持选中（store 已 toast，此处只留日志）。
 * store 不做 selection 清理，是为了让 stores 之间保持单向依赖（见 stores/bookmark.ts）。
 */
const runUpdate = async (patch: BulkPatch): Promise<boolean> => {
  if (ids.value.length === 0) return false
  try {
    await bookmarkStore.bulkUpdate(ids.value, patch)
    selectionStore.exit()
    return true
  } catch (error) {
    console.warn('[BulkActionBar] bulk update failed:', error)
    return false
  }
}

const handleMove = (command: string) => {
  // `folderId: ''` = 未分类（主进程白名单接受空串）
  if (command === 'uncategorized') {
    void runUpdate({ folderId: '' })
    return
  }
  if (!command.startsWith('folder:')) return
  void runUpdate({ folderId: command.slice('folder:'.length) })
}

const handleAddTags = async () => {
  const list = [...tagsToAdd.value]
  if (list.length === 0) return
  if (await runUpdate({ addTags: list })) {
    tagsToAdd.value = []
  }
}

const handleRemoveTags = async () => {
  const list = [...tagsToRemove.value]
  if (list.length === 0) return
  if (await runUpdate({ removeTags: list })) {
    tagsToRemove.value = []
  }
}

const handleColorChange = (value: string | null) => {
  // 清空选择器（'') 不构成批量动作：主进程的 color 白名单只接受非空字符串
  if (!value) return
  void runUpdate({ color: value })
}

const handleDelete = async () => {
  if (ids.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      t('bulk.deleteConfirm', { count: count.value }),
      t('dialog.confirmDelete'),
      {
        confirmButtonText: t('common.delete'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
  } catch {
    // 用户取消：保持选中，不发提示
    return
  }

  try {
    await bookmarkStore.bulkDelete(ids.value)
    selectionStore.exit()
  } catch (error) {
    console.warn('[BulkActionBar] bulk delete failed:', error)
  }
}
</script>

<style scoped>
.bulk-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--lc-space-3);
  margin-top: var(--lc-space-3);
  padding: var(--lc-space-2) var(--lc-space-3);
  border-top: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
  background-color: var(--lc-bg-surface);
  box-shadow: var(--lc-shadow-card);
}

.bulk-count {
  flex: 0 0 auto;
  color: var(--lc-text-primary);
  font-size: var(--lc-font-sm);
  font-weight: var(--lc-weight-medium);
  line-height: var(--lc-leading-tight);
  white-space: nowrap;
}

.bulk-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--lc-space-2);
  min-width: 0;
}

/* 命中区统一到 --lc-control-md（≥32px）；EP 默认 32px，这里显式钉住防止主题改动 */
.bulk-actions :deep(.el-button) {
  height: var(--lc-control-md);
  padding: 0 var(--lc-space-3);
  gap: var(--lc-space-1);
  border-radius: var(--lc-radius-md);
  font-size: var(--lc-font-sm);
  transition:
    background-color var(--lc-duration-fast) var(--lc-ease-standard),
    color var(--lc-duration-fast) var(--lc-ease-standard),
    border-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.bulk-actions :deep(.el-button:focus-visible) {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}

.bulk-actions :deep(.bulk-btn.is-danger:not(.is-disabled)) {
  border-color: var(--lc-danger);
  color: var(--lc-danger);
}

.bulk-actions :deep(.bulk-btn.is-danger:not(.is-disabled):hover) {
  background-color: color-mix(in srgb, var(--lc-danger) 10%, transparent);
}

.bulk-color {
  height: var(--lc-control-md);
}

.tag-popover {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
}

.tag-select {
  flex: 1;
  min-width: 0;
}

.tag-apply {
  flex: 0 0 auto;
  height: var(--lc-control-md);
}
</style>

<style>
/*
 * 进入/离开过渡（非 scoped：Transition 类名加在 BulkActionBar 的根节点上，
 * 由 CardView / ListView 的 <Transition name="bulk-bar"> 触发；
 * 类名唯一，不会污染其它组件）。
 */
.bulk-bar-enter-from,
.bulk-bar-leave-to {
  opacity: 0;
  transform: translateY(var(--lc-space-2));
}

.bulk-bar-enter-active,
.bulk-bar-leave-active {
  transition:
    opacity var(--lc-duration-fast) var(--lc-ease-standard),
    transform var(--lc-duration-fast) var(--lc-ease-standard);
}
</style>
