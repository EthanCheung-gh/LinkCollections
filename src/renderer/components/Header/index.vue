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
      <ViewToggle />
    </div>

    <AddBookmarkDialog v-model="showAddDialog" />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useFolderStore } from '../../stores'
import SearchBox from '../Search/SearchBox.vue'
import ViewToggle from './ViewToggle.vue'
import AddBookmarkDialog from '../Modal/AddBookmarkDialog.vue'

interface Emits {
  (e: 'search', query: string): void
}

const { t } = useI18n()
const emit = defineEmits<Emits>()

const folderStore = useFolderStore()
const { currentFolder } = storeToRefs(folderStore)

const showAddDialog = ref(false)

const handleSearch = (query: string) => {
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
</style>
