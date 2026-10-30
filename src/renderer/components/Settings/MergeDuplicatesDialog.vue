<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('duplicates.title')"
    width="var(--lc-dialog-width-lg)"
    @closed="handleClosed"
  >
    <p class="dup-summary">
      {{ t('duplicates.summary', { groups: summary.groups, redundant: summary.redundant }) }}
    </p>

    <div
      v-if="rows.length === 0"
      class="dup-none"
    >
      {{ t('duplicates.none') }}
    </div>

    <template v-else>
      <ul class="dup-group-list">
        <li
          v-for="row in visibleRows"
          :key="row.key"
          class="dup-group"
        >
          <div
            class="dup-group-key"
            :title="row.key"
          >
            {{ row.displayKey }}
          </div>

          <div class="dup-group-members">
            <div class="dup-member">
              <span
                class="dup-member-title"
                :title="row.keepTitle"
              >{{ row.keepTitle }}</span>
              <el-tag
                size="small"
                type="success"
                effect="light"
              >
                {{ t('duplicates.keep') }}
              </el-tag>
            </div>

            <div
              v-for="donor in row.visibleDonors"
              :key="donor.id"
              class="dup-member"
            >
              <span
                class="dup-member-title"
                :title="donor.title"
              >{{ donor.title }}</span>
              <el-tag
                size="small"
                type="danger"
                effect="light"
              >
                {{ t('duplicates.remove') }}
              </el-tag>
            </div>

            <el-button
              v-if="row.hiddenDonorCount > 0"
              text
              type="primary"
              class="dup-expand"
              @click="toggleGroup(row.key)"
            >
              {{ t('duplicates.more', { count: row.hiddenDonorCount }) }}
            </el-button>
          </div>
        </li>
      </ul>

      <p
        v-if="hiddenGroupCount > 0"
        class="dup-more-groups"
      >
        {{ t('duplicates.more', { count: hiddenGroupCount }) }}
      </p>
    </template>

    <template #footer>
      <el-button @click="dialogVisible = false">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="merging"
        :disabled="summary.redundant === 0 || merging"
        @click="handleMerge"
      >
        {{ t('duplicates.merge') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useBookmarkStore } from '../../stores'
import type { DuplicateMergePlan } from '../../../../shared/duplicates'

/**
 * 重复书签合并的预览/执行弹窗。
 *
 * 预览完全由调用方（`SettingsView`）在打开前用**共享纯函数**算好并传进来
 * （`plan`），因此弹窗自己不做任何分组计算，也绝不写盘 —— 只有点「合并」并二次确认
 * 后才会触发一次 IPC（主进程一次读 + 一次写）。
 */

interface Props {
  modelValue: boolean
  /** `planDuplicateMerges(bookmarks, now)` 的结果；空书签时为全 0 计划 */
  plan: DuplicateMergePlan | null
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

/** 单个将被删除的成员（只含展示所需字段） */
interface DonorRow {
  id: string
  title: string
}

/** 一个重复组的展示行：keeper + donor 列表（超长的部分先折叠） */
interface GroupRow {
  key: string
  displayKey: string
  keepTitle: string
  visibleDonors: DonorRow[]
  hiddenDonorCount: number
}

/** 先展示的组数 / 每组先展示的 donor 数（超出部分折叠，避免弹窗过长） */
const MAX_GROUPS = 5
const MAX_DONORS = 3

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

/** 执行中：按钮 loading + 禁用，避免重复提交多次合并 */
const merging = ref(false)

/** 展开的组（key 集合）：成员多的组默认折叠 */
const expanded = ref<Set<string>>(new Set())

const summary = computed(() => ({
  groups: props.plan?.duplicateGroups ?? 0,
  redundant: props.plan?.redundantCount ?? 0
}))

/** id → 书签：donor 的标题只存在于原始数组里（计划里只带 id） */
const bookmarksById = computed(() => new Map(bookmarkStore.bookmarks.map(item => [item.id, item])))

/** 展示用标题：标题为空时退化为 URL，再退化为 id（永不渲染空行） */
const titleOf = (id: string): string => {
  const bookmark = bookmarksById.value.get(id)
  return bookmark?.title || bookmark?.url || id
}

/** 组键是归一化后的 URL，这里只显示域名，避免长 URL 撑破弹窗 */
const displayKeyOf = (key: string): string => {
  try {
    return new URL(key).hostname || key
  } catch {
    return key
  }
}

/** 全部组行（含未展开部分由 `visibleRows` 裁剪） */
const rows = computed<GroupRow[]>(() => {
  const groups = props.plan?.groups ?? []

  return groups.map(group => {
    const donorIds = group.memberIds.filter(id => id !== group.keepId)
    const isExpanded = expanded.value.has(group.key)
    const visibleIds = isExpanded ? donorIds : donorIds.slice(0, MAX_DONORS)

    return {
      key: group.key,
      displayKey: displayKeyOf(group.key),
      keepTitle: titleOf(group.keepId),
      visibleDonors: visibleIds.map(id => ({ id, title: titleOf(id) })),
      hiddenDonorCount: donorIds.length - visibleIds.length
    }
  })
})

/** 最多先展示 5 组，其余用「还有 N 组」提示 */
const visibleRows = computed(() => rows.value.slice(0, MAX_GROUPS))
const hiddenGroupCount = computed(() => Math.max(0, rows.value.length - MAX_GROUPS))

const toggleGroup = (key: string) => {
  const next = new Set(expanded.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  expanded.value = next
}

const handleMerge = async () => {
  if (merging.value || summary.value.redundant === 0) return

  // 删除不可撤销：执行前必须二次确认（用户取消则静默返回，不弹错误）
  try {
    await ElMessageBox.confirm(
      t('duplicates.confirm', { count: summary.value.redundant }),
      t('duplicates.title'),
      {
        confirmButtonText: t('duplicates.merge'),
        cancelButtonText: t('common.cancel'),
        type: 'warning'
      }
    )
  } catch {
    return
  }

  merging.value = true
  try {
    // 一次 IPC：主进程一次读 + 一次写（成功不弹 toast，汇总由这里给出）
    const result = await bookmarkStore.mergeDuplicates()
    dialogVisible.value = false
    ElMessage.success(t('message.duplicatesMerged', { count: result.removed }))
  } catch (error) {
    // store 已经提示过 message.mergeDuplicatesFailed，这里只保留日志
    console.error(error)
  } finally {
    merging.value = false
  }
}

/** 关闭后重置内部状态：再次打开时不带上一次的展开/进行中状态 */
const handleClosed = () => {
  merging.value = false
  expanded.value = new Set()
}
</script>

<style scoped>
.dup-summary {
  margin: 0 0 var(--lc-space-4);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-regular);
}

.dup-none {
  padding: var(--lc-space-4);
  background-color: var(--lc-bg-subtle);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
  font-size: var(--lc-font-base);
  color: var(--lc-text-primary);
}

.dup-group-list {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-2);
  max-height: 360px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.dup-group {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-2);
  min-width: 0;
  padding: var(--lc-space-3);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-sm);
}

.dup-group-key {
  overflow: hidden;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dup-group-members {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-1);
  min-width: 0;
}

.dup-member {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  min-width: 0;
}

.dup-member-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: var(--lc-font-base);
  color: var(--lc-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dup-expand {
  align-self: flex-start;
  padding: 0;
  font-size: var(--lc-font-xs);
}

.dup-more-groups {
  margin: var(--lc-space-3) 0 0;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
}
</style>
