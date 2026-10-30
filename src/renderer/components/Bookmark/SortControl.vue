<template>
  <div class="sort-control">
    <el-select
      v-model="selectedKey"
      class="sort-select"
      :aria-label="t('sort.label')"
    >
      <el-option
        v-for="option in keyOptions"
        :key="option.value"
        :label="option.label"
        :value="option.value"
      />
    </el-select>

    <el-button
      class="sort-direction"
      :disabled="!sortStore.hasSort"
      :aria-label="directionActionLabel"
      :title="directionActionLabel"
      @click="handleToggleDirection"
    >
      <i :class="directionIcon" />
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSortStore } from '../../stores'
import type { SortKey } from '../../stores'

const { t } = useI18n()
const sortStore = useSortStore()

/**
 * 控件不持有任何本地状态：下拉 / 方向按钮都直接读写 sort store，
 * 因此在卡片视图与列表视图之间切换时排序天然一致，无需 props/emit 传递。
 */
const selectedKey = computed<SortKey>({
  get: () => sortStore.sortKey,
  // 选同键时 el-select 不会触发 update，反转只能由方向按钮完成（符合约定 5）
  set: value => sortStore.setSort(value)
})

const keyOptions = computed<{ value: SortKey; label: string }[]>(() => [
  { value: 'default', label: t('sort.default') },
  { value: 'title', label: t('sort.title') },
  { value: 'createdAt', label: t('sort.createdAt') },
  { value: 'visitCount', label: t('sort.visitCount') },
  { value: 'lastVisited', label: t('sort.lastVisited') }
])

const directionIcon = computed(() =>
  sortStore.sortDirection === 'asc' ? 'i-heroicons-bars-arrow-up' : 'i-heroicons-bars-arrow-down'
)

/** aria-label 同时带「动作」与「当前方向」，屏幕阅读器能听出按下后会翻到哪一侧 */
const directionActionLabel = computed(
  () =>
    `${t('sort.toggleDirection')} (${sortStore.sortDirection === 'asc' ? t('sort.asc') : t('sort.desc')})`
)

const handleToggleDirection = () => {
  if (!sortStore.hasSort) return
  // 同键 + 不传 direction = 反转方向（store 的约定语义）
  sortStore.setSort(sortStore.sortKey)
}
</script>

<style scoped>
/* 紧凑工具条控件：高度 = --lc-control-md，与表格行内控件同档，不喧宾夺主 */
.sort-control {
  display: inline-flex;
  align-items: center;
  gap: var(--lc-space-2);
  height: var(--lc-control-md);
}

/* el-select 默认 min-height 就是 32px（EP $input-height default），这里只用 token 复核一遍 */
.sort-select {
  --el-select-width: 150px;
  --el-select-input-focus-border-color: var(--lc-accent);
  height: var(--lc-control-md);
}

.sort-select :deep(.el-select__wrapper) {
  min-height: var(--lc-control-md);
  padding: 0 var(--lc-space-2);
  border-radius: var(--lc-radius-md);
  background-color: var(--lc-bg-surface);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-primary);
  /* 只留一种描边：inset 阴影，不再叠加 border */
  box-shadow: 0 0 0 1px var(--lc-border-default) inset;
  transition:
    box-shadow var(--lc-duration-fast) var(--lc-ease-standard),
    background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.sort-select :deep(.el-select__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--lc-text-muted) inset;
}

.sort-select :deep(.el-select__wrapper.is-focused) {
  box-shadow:
    0 0 0 1px var(--lc-accent) inset,
    0 0 0 3px var(--lc-accent-soft);
}

.sort-select :deep(.el-select__placeholder) {
  color: var(--lc-text-primary);
}

.sort-select :deep(.el-select__caret),
.sort-select :deep(.el-select__icon) {
  color: var(--lc-text-muted);
}

/* 方向按钮：正方形图标按钮，与下拉等高 */
.sort-direction {
  width: var(--lc-control-md);
  min-width: var(--lc-control-md);
  height: var(--lc-control-md);
  padding: 0;
  border-radius: var(--lc-radius-md);
  font-size: var(--lc-font-lg);
  color: var(--lc-text-regular);
}

.sort-direction:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: 2px;
}
</style>
