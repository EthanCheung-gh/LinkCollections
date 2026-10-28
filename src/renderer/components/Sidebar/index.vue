<template>
  <div
    class="sidebar"
    :class="{ collapsed: sidebarCollapsed }"
  >
    <div class="sidebar-header">
      <div
        v-if="!sidebarCollapsed"
        class="logo"
      >
        <i class="i-heroicons-link" />
        <span>{{ t('app.name') }}</span>
      </div>
      <el-button
        text
        class="collapse-btn"
        @click="toggleSidebar"
      >
        <i :class="sidebarCollapsed ? 'i-heroicons-chevron-right' : 'i-heroicons-chevron-left'" />
      </el-button>
    </div>

    <div
      v-if="!sidebarCollapsed"
      class="sidebar-content"
    >
      <SearchBar />
      <SearchResults />
      <FolderList />
      <TagList />
    </div>

    <div class="sidebar-footer">
      <el-button
        text
        class="footer-btn left-btn"
        :title="t('sidebar.statistics')"
        @click="handleStatsClick"
      >
        <i class="i-heroicons-chart-bar footer-icon" />
        <span v-if="!sidebarCollapsed">{{ t('sidebar.statistics') }}</span>
      </el-button>
      <el-button
        text
        class="footer-btn right-btn"
        :title="t('sidebar.settings')"
        @click="handleSettingsClick"
      >
        <i class="i-heroicons-cog-6-tooth footer-icon" />
        <span v-if="!sidebarCollapsed">{{ t('sidebar.settings') }}</span>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '../../stores'
import FolderList from './FolderList.vue'
import TagList from './TagList.vue'
import SearchBar from './SearchBar.vue'
import SearchResults from './SearchResults.vue'

const { t } = useI18n()
const uiStore = useUIStore()
const { sidebarCollapsed, currentView } = storeToRefs(uiStore)
const { toggleSidebar, setCurrentView } = uiStore

const handleStatsClick = () => {
  if (currentView.value === 'stats') {
    setCurrentView('bookmarks')
  } else {
    setCurrentView('stats')
  }
}

const handleSettingsClick = () => {
  setCurrentView('settings')
}
</script>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  width: var(--lc-sidebar-width);
  /* 唯一横向边距来源：logo / 搜索框 / 分组标题 / 列表项 / 底栏图标共用这条线 */
  padding: var(--lc-layout-padding);
  max-height: calc(100vh - var(--lc-layout-padding) * 2);
  background-color: var(--lc-bg-surface);
  border-radius: var(--lc-radius-lg);
  box-shadow: var(--lc-shadow-card);
  transition: width var(--lc-duration-normal) var(--lc-ease-standard);
}

.sidebar.collapsed {
  width: var(--lc-sidebar-collapsed-width);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* 不再叠加横向 padding：折叠按钮右边缘与分组 "+" 共用一条线 */
  margin-bottom: var(--lc-space-4);
}

.sidebar.collapsed .sidebar-header {
  justify-content: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  font-size: var(--lc-font-lg);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-accent);
}

.logo i {
  font-size: 20px;
}

.collapse-btn {
  padding: 0;
  width: var(--lc-control-sm);
  height: var(--lc-control-sm);
  border-radius: var(--lc-radius-sm);
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.collapse-btn:hover {
  background-color: var(--lc-bg-hover);
}

.sidebar-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.sidebar-content::-webkit-scrollbar {
  width: var(--lc-space-1);
}

.sidebar-content::-webkit-scrollbar-thumb {
  background-color: var(--lc-border-default);
  border-radius: var(--lc-radius-pill);
}

.sidebar-footer {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  margin-top: auto;
  padding-top: var(--lc-space-4);
  border-top: 1px solid var(--lc-border-subtle);
}

.sidebar.collapsed .sidebar-footer {
  flex-direction: column;
  align-items: stretch;
}

/* 对称双按钮：等宽等高、内容居中（不再一左一右反向对齐） */
.footer-btn {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: var(--lc-space-1);
  height: var(--lc-control-md);
  padding: 0 var(--lc-space-1);
  box-sizing: border-box;
  border-radius: var(--lc-radius-md);
  color: var(--lc-text-regular);
  font-size: var(--lc-font-base);
  transition: background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

/* EP 的 .el-button + .el-button 自带 12px margin-left，会破坏对称间距 */
.sidebar-footer .footer-btn + .footer-btn {
  margin-left: 0;
}

.footer-btn:hover {
  background-color: var(--lc-bg-hover);
}

.footer-btn .footer-icon {
  width: 20px;
  height: 20px;
  font-size: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.footer-btn span {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
