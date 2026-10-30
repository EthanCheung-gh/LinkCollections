<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('links.title')"
    width="var(--lc-dialog-width-md)"
    @closed="handleClosed"
  >
    <p class="link-summary">
      {{ t('links.summary', summary) }}
    </p>

    <div v-if="issues.length === 0" class="link-all-good">
      <i class="i-heroicons-check-circle" />
      <span>{{ t('links.allGood') }}</span>
    </div>

    <ul v-else class="link-issue-list">
      <li v-for="issue in issues" :key="issue.id" class="link-issue">
        <div class="link-issue-main">
          <div class="link-issue-title" :title="issue.title || issue.url">
            {{ issue.title || issue.url }}
          </div>
          <div class="link-issue-host">
            {{ hostOf(issue.url) }}
          </div>
        </div>
        <el-tag
          class="link-issue-tag"
          size="small"
          effect="light"
          :type="isBroken(issue) ? 'danger' : 'warning'"
        >
          {{ statusText(issue) }}
        </el-tag>
      </li>
    </ul>

    <template #footer>
      <el-button
        :loading="deleting"
        :disabled="brokenIds.length === 0 || deleting"
        @click="handleDeleteBroken"
      >
        {{ t('links.deleteBroken') }}
      </el-button>
      <el-button type="primary" @click="dialogVisible = false">
        {{ t('common.close') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useBookmarkStore } from '../../stores'
import type { Bookmark } from '../../types'
import type { LinkCheckResult } from '../../types/global'

interface Props {
  modelValue: boolean
  result: LinkCheckResult | null
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

/** 删除进行中：按钮禁用，避免重复提交多次 bulkDelete */
const deleting = ref(false)

const summary = computed(() => ({
  ok: props.result?.ok ?? 0,
  broken: props.result?.broken ?? 0,
  unknown: props.result?.unknown ?? 0
}))

/**
 * 只列出需要处理的两类：broken（danger）与 unknown（warning）。
 * `linkStatus` 缺失的条目（理论上不该出现在本轮结果里）也一并跳过。
 */
const issues = computed<Bookmark[]>(() => {
  const list = Array.isArray(props.result?.bookmarks) ? props.result!.bookmarks : []
  return list.filter(bookmark => bookmark.linkStatus && bookmark.linkStatus.ok !== true)
})

const brokenIds = computed(() =>
  issues.value.filter(bookmark => isBroken(bookmark)).map(bookmark => bookmark.id)
)

const isBroken = (bookmark: Bookmark) => bookmark.linkStatus?.ok === false

/** 列表里展示域名而不是完整长 URL：一眼能认出站点，且不会撑破弹窗 */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

/** broken/unknown 的说明文字：优先状态码，其次主进程记录的错误原因 */
const statusText = (bookmark: Bookmark): string => {
  const linkStatus = bookmark.linkStatus
  if (!linkStatus) return t('links.unknownReason')
  if (typeof linkStatus.status === 'number') {
    return t('links.statusCode', { status: linkStatus.status })
  }
  return linkStatus.error || t('links.unknownReason')
}

const handleDeleteBroken = async () => {
  if (deleting.value || brokenIds.value.length === 0) return

  deleting.value = true
  try {
    // 一次 IPC 批量删除（成功 toast 由 store 统一发），然后关闭弹窗
    await bookmarkStore.bulkDelete(brokenIds.value)
    dialogVisible.value = false
  } catch (error) {
    // store 已经提示过 message.bookmarkDeleteFailed，这里只保留日志
    console.error(error)
  } finally {
    deleting.value = false
  }
}

/** 关闭后重置内部状态：再次打开时不会带上一次的「删除进行中」状态 */
const handleClosed = () => {
  deleting.value = false
}

watch(
  () => props.modelValue,
  visible => {
    if (visible) deleting.value = false
  }
)
</script>

<style scoped>
.link-summary {
  margin: 0 0 var(--lc-space-4);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-regular);
}

.link-all-good {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  padding: var(--lc-space-4);
  background-color: var(--lc-bg-subtle);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
  font-size: var(--lc-font-base);
  color: var(--lc-text-primary);
}

.link-all-good i {
  font-size: 20px;
  color: var(--lc-success);
}

.link-issue-list {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-2);
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.link-issue {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
  min-width: 0;
  padding: var(--lc-space-3);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-sm);
}

.link-issue-main {
  flex: 1;
  min-width: 0;
}

.link-issue-title {
  overflow: hidden;
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-issue-host {
  overflow: hidden;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-issue-tag {
  flex-shrink: 0;
}

@media (max-width: 600px) {
  .link-issue {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
