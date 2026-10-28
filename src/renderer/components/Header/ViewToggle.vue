<template>
  <el-button-group class="view-toggle">
    <el-button
      :type="currentView === 'card' ? 'primary' : ''"
      class="view-btn"
      @click="handleViewChange('card')"
    >
      <i class="i-heroicons-squares-2x2" />
    </el-button>
    <el-button
      :type="currentView === 'list' ? 'primary' : ''"
      class="view-btn"
      @click="handleViewChange('list')"
    >
      <i class="i-heroicons-list-bullet" />
    </el-button>
  </el-button-group>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useUIStore } from '../../stores'

const uiStore = useUIStore()
const { viewMode } = storeToRefs(uiStore)
const { setViewMode } = uiStore

const currentView = computed(() => viewMode.value)

const handleViewChange = (mode: 'card' | 'list') => {
  setViewMode(mode)
}
</script>

<style scoped>
/*
 * 单个分段控件（审计 B8）：EP 的 .el-button-group--horizontal 是 display:inline-block + float 子项 +
 * :not(:last-child){margin-right:-1px} 的 1px 重叠边框，本来就会出现双边框/接缝。
 * 这里保留 el-button-group 根节点（DOM 语义与 :type 激活逻辑都不动），
 * 只用 flex + overflow:hidden 把它变成一个完整控件：外框 1 条 1px 边，段间 1 条 1px 分隔线。
 * 段选择器统一加 .el-button-group 前缀，是为了在所有 margin/float/border-radius 上稳定压过 EP
 * （EP 的 .el-button-group--horizontal>.el-button:not(:last-child) 完全是 3 个类的特异性），
 * 这样就不用依赖 CSS 打包顺序。
 */
.view-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: stretch;
  height: var(--lc-control-lg);
  overflow: hidden;
  border: 1px solid var(--lc-border-default);
  border-radius: var(--lc-radius-md);
  background-color: var(--lc-bg-subtle);
}

.el-button-group.view-toggle > .view-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  float: none;
  height: 100%;
  min-width: var(--lc-control-lg);
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  background-color: transparent;
  color: var(--lc-text-regular);
  font-size: var(--lc-font-lg);
  line-height: 1;
  transition:
    background-color var(--lc-duration-fast) var(--lc-ease-standard),
    color var(--lc-duration-fast) var(--lc-ease-standard);
}

/* 段间唯一的一条分隔线（两段外距都是 0，不再用 EP 的 -1px 重叠） */
.el-button-group.view-toggle > .view-btn + .view-btn {
  border-left: 1px solid var(--lc-border-default);
}

.el-button-group.view-toggle > .view-btn:hover:not(.el-button--primary) {
  background-color: var(--lc-bg-hover);
  color: var(--lc-text-primary);
}

/*
 * 激活态：EP 的 el-button 不会输出 is-active（旧 .view-btn.is-active 是死规则，已删除），
 * 真正会生成的是模板里 :type="currentView === '…' ? 'primary' : ''" 对应的 el-button--primary。
 * 选中语言统一为「--lc-bg-active 底 + --lc-accent 前景」（视觉层级建议 D3）。
 */
.el-button-group.view-toggle > .view-btn.el-button--primary {
  background-color: var(--lc-bg-active);
  color: var(--lc-accent);
}

/* 容器 overflow:hidden 会裁掉 offset:2px 的外环，分段控件内用内偏移保证焦点环可见 */
.el-button-group.view-toggle > .view-btn:focus-visible {
  outline: 2px solid var(--lc-accent);
  outline-offset: -2px;
  z-index: 1;
}
</style>
