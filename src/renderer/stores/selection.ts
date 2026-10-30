import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

/**
 * 书签「选择模式」的**唯一**状态源（卡片视图和列表视图共享同一份）。
 *
 * 设计取舍：
 *  - `selectedIds` 用 `Set` 而不是数组：`isSelected` 是每张卡片每次渲染都会调用的
 *    高频判断，`Set.has` 是 O(1)；但 Set 本身是可变对象，Vue 对 `set.add/delete`
 *    的变更**不会**触发依赖 `selectedIds` 的 computed/watch（`ref` 只在 `.value`
 *    被重新赋值时才通知），所以**每次变更都赋一个全新的 Set**。
 *  - 选中项可以多于当前可见项（搜索/标签过滤把已选项藏起来时，计数必须仍然真实），
 *    因此这里不做任何「与可见列表求交集」的处理，交由各视图自己决定。
 *  - 这个 store **不 import 任何其它 store**（bookmark/folder/ui），只被组件和
 *    bookmark store 的调用方使用，杜绝循环依赖。
 */
export const useSelectionStore = defineStore('selection', () => {
  /** 是否处于选择模式（顶部按钮进入/退出） */
  const isSelecting = ref(false)
  /** 已选书签 id；每次变更都换成新 Set，保证响应式 */
  const selectedIds = ref<Set<string>>(new Set<string>())

  /** 已选数量（批量条上的「已选 N 项」用它，不受搜索/标签过滤影响） */
  const count = computed(() => selectedIds.value.size)

  const isSelected = (id: string): boolean => selectedIds.value.has(id)

  const enter = (): void => {
    isSelecting.value = true
  }

  /** 退出选择模式并清空选择（顶部「取消选择」、批量动作成功后都走这里） */
  const exit = (): void => {
    isSelecting.value = false
    selectedIds.value = new Set<string>()
  }

  const toggle = (id: string): void => {
    const next = new Set(selectedIds.value)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    selectedIds.value = next
  }

  /** 用给定 id 集合整体替换（列表视图的 el-table selection 回写、全选都走这里） */
  const selectAll = (ids: string[]): void => {
    selectedIds.value = new Set(ids)
  }

  /** 只清空已选 id，不退出选择模式（切换文件夹/视图/搜索关键词时用） */
  const clear = (): void => {
    selectedIds.value = new Set<string>()
  }

  return {
    isSelecting,
    selectedIds,
    count,
    isSelected,
    enter,
    exit,
    toggle,
    selectAll,
    clear
  }
})
