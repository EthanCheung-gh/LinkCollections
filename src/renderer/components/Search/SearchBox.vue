<template>
  <div class="search-box">
    <el-input
      v-model="searchQuery"
      :placeholder="t('search.placeholder')"
      clearable
      class="search-input"
    >
      <template #prefix>
        <i class="i-heroicons-magnifying-glass" />
      </template>
    </el-input>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { debounce } from 'lodash-es'

const emit = defineEmits<{
  search: [query: string]
}>()

const { t } = useI18n()

const searchQuery = ref('')

// 只保留 watch 一条触发路径：原实现 @input 与 watch 同时调用同一个 debounce，
// 每次击键会重复调度同一份 emit（虽被 debounce 折叠，但属于双触发源，去掉更明确）。
const handleSearch = debounce((value: string) => {
  emit('search', value)
}, 300)

watch(searchQuery, value => {
  handleSearch(value)
})
</script>

<style scoped>
/*
 * 宽度：由 Header 中栏 grid 列（同一个 clamp 表达式）决定，此处 max-width 仅保证组件独立使用时也不无限拉伸。
 * 高度 = --lc-control-lg（36px），与 Add 按钮 / 分段控件等高（审计 B1）。
 */
.search-box {
  width: 100%;
  min-width: 0;
  max-width: clamp(280px, 34vw, 500px);
}

.search-input {
  /* EP 2.13：.el-input__inner 高 = --el-input-height - 2px，wrapper 再 +2px 内边距 → 34 + 2 = 36 */
  --el-input-height: var(--lc-control-lg);
  --el-input-border-radius: var(--lc-radius-pill);
  --el-input-bg-color: var(--lc-bg-surface);
  --el-input-hover-border-color: var(--lc-border-default);
  --el-input-focus-border-color: var(--lc-accent);
  height: var(--lc-control-lg);
  border-radius: var(--lc-radius-pill);
}

/* :deep() 必须：.el-input__wrapper / .el-input__inner 由 EP 内部模板渲染，不在本组件模板里 */
.search-input :deep(.el-input__wrapper) {
  min-height: var(--lc-control-lg);
  padding: 0 var(--lc-space-3);
  border-radius: var(--lc-radius-pill);
  /* 只留一种描边：用 inset 1px 阴影，不再叠加 border:1px + 第二层 box-shadow */
  box-shadow: 0 0 0 1px var(--lc-border-default) inset;
  transition:
    box-shadow var(--lc-duration-fast) var(--lc-ease-standard),
    background-color var(--lc-duration-fast) var(--lc-ease-standard);
}

.search-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px var(--lc-text-muted) inset;
}

/* 契约 §4 的可见焦点态：accent 描边 + accent-soft 光晕（EP 的聚焦也用 box-shadow，所以不用 outline） */
.search-input :deep(.el-input__wrapper.is-focus) {
  box-shadow:
    0 0 0 1px var(--lc-accent) inset,
    0 0 0 3px var(--lc-accent-soft);
}

.search-input :deep(.el-input__inner) {
  font-size: var(--lc-font-base);
  color: var(--lc-text-primary);
}

.search-input :deep(.el-input__prefix) {
  display: flex;
  align-items: center;
  color: var(--lc-text-muted);
}
</style>
