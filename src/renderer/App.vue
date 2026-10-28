<template>
  <div class="app-container">
    <Sidebar />
    <div class="main-content">
      <div v-if="currentView === 'bookmarks'" class="bookmarks-view">
        <Header @search="handleSearch" />
        <CardView v-if="viewMode === 'card'" :search-query="searchQuery" />
        <ListView v-else :search-query="searchQuery" />
      </div>
      <StatsView v-else-if="currentView === 'stats'" />
      <SettingsView v-else-if="currentView === 'settings'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useUIStore, useBookmarkStore, useFolderStore, useTagStore } from './stores'
import { defineAsyncComponent } from 'vue'
import Sidebar from './components/Sidebar/index.vue'
import Header from './components/Header/index.vue'
import CardView from './components/Bookmark/CardView.vue'
import ListView from './components/Bookmark/ListView.vue'

const StatsView = defineAsyncComponent(() => import('./components/Stats/StatsView.vue'))
const SettingsView = defineAsyncComponent(() => import('./components/Settings/SettingsView.vue'))

const uiStore = useUIStore()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()

const { currentView, viewMode } = storeToRefs(uiStore)

const searchQuery = ref('')

// C5：顶栏搜索只保留这一条过滤链路 —— Header emit → 本 ref → CardView/ListView 的 searchQuery prop。
// 这里刻意不写 searchStore：searchStore.query 是侧栏 SearchResults 面板的独立数据源（额外匹配标签名），
// 若在此同步写入，同一关键词会同时产出「主列表（不匹配标签名）」与「侧栏面板（匹配标签名）」两套结果，
// 即审计描述的双重过滤/结果不一致。保持单一来源即可，不重构数据流。
const handleSearch = (query: string) => {
  searchQuery.value = query
}

// Header 只在 bookmarks 视图渲染，SearchBox 内部持有自己的本地 ref；切走时清空本 ref，
// 避免回到 bookmarks 时出现「搜索框为空但列表仍被旧关键词过滤」（用户感知为丢结果）。
watch(currentView, view => {
  if (view !== 'bookmarks') {
    searchQuery.value = ''
  }
})

// C4：Ctrl/Cmd+K 聚焦顶栏搜索框（用户看到的那个搜索框），不再聚焦侧栏 SearchBar。
// 选择器方案的取舍见交付报告：Header 是 v-if 渲染，非 bookmarks 视图下选择器自然返回 null；
// 同时避免 App → Header → SearchBox 三层 ref/defineExpose 链在 Vue 3.4 下引入新的类型风险。
const focusHeaderSearch = () => {
  const input = document.querySelector<HTMLInputElement>('.search-box input')
  input?.focus()
}

const handleKeydown = (e: KeyboardEvent) => {
  if (!(e.ctrlKey || e.metaKey) || e.key !== 'k') return
  // stats/settings 视图没有 Header：不聚焦、也不 preventDefault，交给其它处理器
  if (currentView.value !== 'bookmarks') return

  e.preventDefault()
  focusHeaderSearch()
}

onMounted(() => {
  // C6：快捷键注册先于任何 await，且与数据加载解耦（uiStore.fetchSettings 失败也不会吞掉监听）
  window.addEventListener('keydown', handleKeydown)

  // C6：4 次 IPC 并行发起；allSettled 不会因单个 reject 中断其余任务
  void Promise.allSettled([
    bookmarkStore.fetchBookmarks(),
    folderStore.fetchFolders(),
    tagStore.fetchTags(),
    uiStore.fetchSettings()
  ]).then(results => {
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Initial data load failed (task #${index}):`, result.reason)
      }
    })
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.app-container {
  display: flex;
  gap: var(--lc-layout-gap);
  padding: var(--lc-layout-padding);
  height: 100vh;
  background-color: var(--lc-bg-canvas);
}

/* 页面外边距的唯一来源（ui-pages / ui-bookmark 不要再给页面根节点加 padding，否则叠加成 32） */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: var(--lc-layout-padding);
  overflow: hidden;
  /* 显式声明：不允许出现横向滚动条（子元素越界一律裁切，宽度问题在各自组件内修正） */
  overflow-x: hidden;
  /*
   * 这里不写 scrollbar-gutter: stable —— .main-content 不是滚动容器（overflow: hidden），
   * Chrome 实测会给它单侧预留 15px gutter（宽度 200 → clientWidth 185），
   * 结果是右侧留白 16+15=31 vs 左侧 16，直接违反对齐规则 3（左右 gutter 相等）。
   * scrollbar-gutter 应交给真正的滚动容器：.card-grid（C-ui-bookmark T1）与页面根节点（C-ui-pages T1/T10）。
   */
}

.bookmarks-view {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

:root {
  --el-color-primary: #3b82f6;
  --el-color-primary-light-3: #3b82f640;
  --el-color-primary-light-5: #3b82f660;
  --el-color-primary-light-7: #3b82f680;
  --el-color-primary-light-8: #3b82f6a0;
  --el-color-primary-light-9: #3b82f6c0;
  --el-color-primary-dark-2: #3b82f6d0;
  --theme-color: #3b82f6;
  --theme-color-light: #3b82f620;
}

.dark {
  --el-color-primary: #3b82f6;
  --el-color-primary-light-3: #3b82f650;
  --el-color-primary-light-5: #3b82f670;
  --el-color-primary-light-7: #3b82f690;
  --el-color-primary-light-8: #3b82f6b0;
  --el-color-primary-light-9: #3b82f6d0;
  --el-color-primary-dark-2: #3b82f6e0;
  --theme-color: #3b82f6;
  --theme-color-light: #3b82f630;
}
</style>
