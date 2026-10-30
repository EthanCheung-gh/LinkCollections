<template>
  <div
    class="search-bar"
    :class="{ 'has-results': isSearching }"
  >
    <el-input
      ref="searchInput"
      v-model="searchQuery"
      :placeholder="t('search.placeholder')"
      :prefix-icon="Search"
      clearable
      @input="handleSearch"
      @clear="handleClear"
      @keydown.enter="handleEnter"
    >
      <template #append>
        <el-tooltip
          :content="t('search.searchShortcut')"
          placement="top"
        >
          <span class="shortcut-hint">{{ shortcutLabel }}</span>
        </el-tooltip>
      </template>
    </el-input>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { Search } from '@element-plus/icons-vue'
import { useSearchStore } from '../../stores/search'

const { t } = useI18n()

// 快捷键徽标要跟随平台：应用实际监听的是 Ctrl/Cmd+K（见 App.vue），
// 在 Windows/Linux 上显示 ⌘ 会误导用户。
const shortcutLabel = computed(() =>
  /mac/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'
)

const searchStore = useSearchStore()
const { isSearching } = storeToRefs(searchStore)

const searchQuery = ref('')
const searchInput = ref()

const handleSearch = () => {
  searchStore.performSearch(searchQuery.value)
}

const handleClear = () => {
  searchStore.clearSearch()
}

const handleEnter = () => {
  if (searchQuery.value.trim()) {
    searchStore.addToHistory(searchQuery.value)
  }
}

const focusSearch = () => {
  searchInput.value?.focus()
}

const handleKeydown = (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    focusSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})

defineExpose({
  focusSearch
})
</script>

<style scoped>
.search-bar {
  margin-bottom: var(--lc-space-3);
}

.search-bar .el-input {
  --el-input-border-radius: var(--lc-radius-md);
}

.search-bar :deep(.el-input__wrapper) {
  min-height: var(--lc-control-lg);
}

/* placeholder 必须完整显示或以省略号截断，不允许被 ⌘K chip 裁切 */
.search-bar :deep(.el-input__inner) {
  min-width: 0;
  text-overflow: ellipsis;
}

/* EP 默认给 append 20px 内距 + 底纹，会额外吞掉可用宽度；
   保留 EP 的 inset 描边（正确的控件轮廓），只收紧内距、去掉底纹 */
.search-bar :deep(.el-input-group__append) {
  padding: 0 var(--lc-space-1);
  background-color: transparent;
}

.shortcut-hint {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  padding: 1px var(--lc-space-1);
  border: 1px solid var(--lc-border-default);
  border-radius: var(--lc-radius-sm);
  background-color: var(--lc-bg-subtle);
  color: var(--lc-text-muted);
  font-size: var(--lc-font-xs);
  line-height: var(--lc-leading-tight);
  cursor: default;
  user-select: none;
}
</style>
