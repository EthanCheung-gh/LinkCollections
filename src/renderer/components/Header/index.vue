<template>
  <div class="header">
    <div class="header-left">
      <h1 class="title">
        {{ currentFolder?.name || t('sidebar.allBookmarks') }}
      </h1>
    </div>

    <div class="header-center">
      <SearchBox @search="handleSearch" />
    </div>

    <div class="header-right">
      <el-button
        type="primary"
        class="add-btn"
        @click="showAddDialog = true"
      >
        <i class="i-heroicons-plus" />
        {{ t('bookmark.addBookmark') }}
      </el-button>
      <el-button
        class="select-btn"
        :class="{ 'is-active': isSelecting }"
        :aria-pressed="isSelecting"
        :aria-label="selectLabel"
        :title="selectLabel"
        @click="handleToggleSelecting"
      >
        <i :class="isSelecting ? 'i-heroicons-x-mark' : 'i-heroicons-check-circle'" />
        <span class="select-btn-label">{{ selectLabel }}</span>
      </el-button>
      <span
        v-if="isSelecting"
        class="selection-count"
      >
        {{ t('bulk.selected', { count }) }}
      </span>
      <ViewToggle />
    </div>

    <AddBookmarkDialog v-model="showAddDialog" />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useFolderStore, useSelectionStore, useUIStore } from '../../stores'
import SearchBox from '../Search/SearchBox.vue'
import ViewToggle from './ViewToggle.vue'
import AddBookmarkDialog from '../Modal/AddBookmarkDialog.vue'

interface Emits {
  (e: 'search', query: string): void
}

const { t } = useI18n()
const emit = defineEmits<Emits>()

const folderStore = useFolderStore()
const uiStore = useUIStore()
const selectionStore = useSelectionStore()
const { currentFolder } = storeToRefs(folderStore)
const { isSelecting, count } = storeToRefs(selectionStore)

const showAddDialog = ref(false)

const selectLabel = computed(() =>
  isSelecting.value ? t('bulk.cancelSelection') : t('bulk.select')
)

const handleToggleSelecting = () => {
  if (isSelecting.value) {
    // exit() 同时清空 selectedIds，不会留下「隐形选中」
    selectionStore.exit()
    return
  }
  selectionStore.enter()
}

/*
 * 选择状态的三处「上下文切换」清空时机（产品约定 2），全部落在 Header：
 * Header 在 bookmarks 视图内常驻，三个入口都会经过它或它监视的 store：
 *  1) 顶部按钮 → handleToggleSelecting → selectionStore.exit()；
 *  2) 切换文件夹 → 侧栏 FolderList 调 folderStore.setCurrentFolder → 下面的 watch；
 *  3) 切换视图（卡片/列表）→ ViewToggle 调 uiStore.setViewMode → 下面的 watch；
 *  4) 切换搜索关键词 → SearchBox debounce 上抛 → handleSearch → selectionStore.exit()。
 * 4 个时机都用 exit()（清空 + 退出模式），避免底部批量条停在「已选 0 项」。
 */
watch(
  () => folderStore.currentFolderId,
  () => selectionStore.exit()
)

watch(
  () => uiStore.viewMode,
  () => selectionStore.exit()
)

// 离开书签视图（统计/设置）时 Header 会被卸载：离开即退出选择模式，
// 否则回到书签视图会看到一个「上次遗留」的选中集合。
onUnmounted(() => {
  selectionStore.exit()
})

const handleSearch = (query: string) => {
  // SearchBox 内部有 debounce 且只在关键词变化时 emit，这里直接退出选择模式即可
  selectionStore.exit()
  emit('search', query)
}
</script>

<style scoped>
/*
 * 三栏 grid：左右两列同为 minmax(0, 1fr) → 两列等宽，中栏的中心恒等于 .main-content 可用宽度的中心
 * （审计实测旧 flex 写法左偏 53.6px；根因是 flex:1 的中栏只在「左右列之外的剩余空间」里居中）。
 * 中栏列宽用 clamp(280px, 34vw, 500px) 而不是固定 500px：窗口最小宽度 1200（electron/main.ts:39）时
 * 也要给右列（Add 按钮 + 分段控件 ≈ 223px）留够空间，34vw 在 1200 宽时给出 408 的上限。
 */
.header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, clamp(280px, 34vw, 500px)) minmax(0, 1fr);
  align-items: center;
  column-gap: var(--lc-space-4);
  margin-bottom: var(--lc-space-6);
  padding-bottom: var(--lc-space-4);
  border-bottom: 1px solid var(--lc-border-subtle);
}

/* 标题列可被压缩（省略号截断），不参与和中栏抢宽度 */
.header-left {
  min-width: 0;
}

.header-center {
  display: flex;
  justify-content: center;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lc-space-3);
  min-width: 0;
  justify-self: end;
}

.title {
  margin: 0;
  font-size: var(--lc-font-xl);
  font-weight: var(--lc-weight-semibold);
  line-height: var(--lc-leading-tight);
  color: var(--lc-text-primary);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

/* 同行等高：EP 2.13 的 .el-button 写死 height:32px，这里统一到 --lc-control-lg（36px）。
   排除 .view-btn：分段控件的段高由 ViewToggle 自己的 height:100% 决定（比外框少 2px 边框）。
   el-button 本身是本模板元素，.add-btn 直接命中即可；:deep() 只用于 EP 内部渲染的节点（见 SearchBox）。 */
.header-right :deep(.el-button:not(.view-btn)) {
  min-height: var(--lc-control-lg);
}

.add-btn {
  height: var(--lc-control-lg);
  padding: 0 var(--lc-space-4);
  gap: var(--lc-space-1);
  border-radius: var(--lc-radius-md);
  font-weight: var(--lc-weight-medium);
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.add-btn:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}

/*
 * 「选择 / 取消选择」入口 + 「已选 N 项」计数。
 *
 * 宽度预算（不改 grid，见文件顶部注释）：右列在窗口宽度 W 下约为
 * (W - 560) / 2 —— W=1200 → 220px，W=1400 → 286px。而「Add 按钮 + 分段控件」
 * 已占约 223px（英文），再塞一个带文字的按钮必然溢出到中栏搜索框上。
 * 因此：
 *  - 宽窗口（≥1500px）：按钮带文字 + 计数 chip，信息最完整；
 *  - 窄窗口（<1500px）：按钮收成 36×36 的图标按钮（title / aria-label 保留语义），
 *    计数 chip 交给底部批量条（BulkActionBar 恒显示「已选 N 项」）。
 */
.select-btn {
  height: var(--lc-control-lg);
  padding: 0 var(--lc-space-2);
  gap: var(--lc-space-1);
  border-radius: var(--lc-radius-md);
  color: var(--lc-text-regular);
  font-size: var(--lc-font-sm);
  font-weight: var(--lc-weight-medium);
  transition:
    background-color var(--lc-duration-fast) var(--lc-ease-standard),
    color var(--lc-duration-fast) var(--lc-ease-standard),
    border-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.select-btn:hover:not(.is-active) {
  background-color: var(--lc-bg-hover);
  color: var(--lc-text-primary);
}

/* 激活态 = 正在选择：能看出「再点一次会取消」 */
.select-btn.is-active {
  border-color: var(--lc-accent);
  background-color: var(--lc-accent-soft);
  color: var(--lc-accent);
}

.select-btn:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}

.selection-count {
  display: inline-flex;
  align-items: center;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 140px;
  height: var(--lc-control-sm);
  padding: 0 var(--lc-space-2);
  overflow: hidden;
  border-radius: var(--lc-radius-pill);
  background-color: var(--lc-accent-soft);
  color: var(--lc-accent);
  font-size: var(--lc-font-xs);
  font-weight: var(--lc-weight-medium);
  line-height: var(--lc-leading-tight);
  white-space: nowrap;
  text-overflow: ellipsis;
}

@media (max-width: 1500px) {
  .select-btn-label,
  .selection-count {
    display: none;
  }

  .select-btn {
    width: var(--lc-control-lg);
    padding: 0;
  }
}
</style>
