<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('trash.title')"
    width="var(--lc-dialog-width-md)"
    @closed="handleClosed"
  >
    <p class="trash-summary">
      {{ t('trash.summary', { count: rows.length }) }}
    </p>

    <div
      v-if="rows.length === 0"
      class="trash-none"
    >
      <i class="i-heroicons-trash" />
      <span>{{ t('trash.none') }}</span>
    </div>

    <ul
      v-else
      class="trash-list"
    >
      <li
        v-for="row in rows"
        :key="row.id"
        class="trash-item"
      >
        <div class="trash-item-main">
          <div
            class="trash-item-title"
            :title="row.title"
          >
            {{ row.title }}
          </div>
          <div class="trash-item-meta">
            <span class="trash-item-host">{{ row.host }}</span>
            <span class="trash-item-time">{{ t('trash.deletedAt', { time: row.deletedText }) }}</span>
          </div>
        </div>

        <div class="trash-item-actions">
          <el-button
            text
            type="primary"
            :disabled="busy"
            @click="handleRestore(row.id)"
          >
            {{ t('trash.restore') }}
          </el-button>
          <el-button
            text
            type="danger"
            :disabled="busy"
            @click="handlePurge(row)"
          >
            {{ t('trash.purge') }}
          </el-button>
        </div>
      </li>
    </ul>

    <template #footer>
      <el-button
        :loading="emptying"
        :disabled="rows.length === 0 || busy"
        @click="handleEmptyTrash"
      >
        {{ t('trash.emptyTrash') }}
      </el-button>
      <el-button
        type="primary"
        @click="dialogVisible = false"
      >
        {{ t('common.close') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessageBox } from 'element-plus'
import { useBookmarkStore } from '../../stores'

/**
 * 回收站弹窗（软删除记录的恢复 / 永久删除）。
 *
 * 数据全部来自 store 的 `trashedBookmarks`（主进程 `get-deleted-bookmarks`，
 * 按 `deletedAt` 倒序），本组件**不做任何过滤/排序**，只负责展示与触发动作：
 *  - 每次打开都重新拉一次列表（用户可能刚删过东西）；
 *  - 恢复 / 永久删除 / 清空回收站都是**一次 IPC**，成功后 store 会用主进程返回的
 *    列表整体刷新本地状态，因此这里不需要手动改数组；
 *  - 永久删除不可撤销，必须先 `ElMessageBox.confirm` 二次确认。
 */

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

/** 列表行：只含展示所需字段（title/host/相对时间） */
interface TrashRow {
  id: string
  title: string
  host: string
  deletedText: string
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

/** 单条动作进行中（恢复/永久删除）：禁用按钮，避免重复提交 */
const busy = ref(false)
/** 清空回收站进行中 */
const emptying = ref(false)

/** 域名展示：解析失败时退回原串，永不渲染空白行 */
const hostOf = (url: string | undefined): string => {
  if (!url) return ''
  try {
    return new URL(url).hostname || url
  } catch {
    return url
  }
}

/**
 * 相对时间（复用 `bookmark.*` 既有的相对时间文案，不再新增一套 i18n 键）。
 *
 * 无法解析的 `deletedAt`（脏数据）退化为「刚刚」：回收站里最差也只是文案不精确，
 * 不值得为此新增错误态。
 */
const relativeTime = (iso: string | null | undefined): string => {
  const time = typeof iso === 'string' ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(time)) return t('bookmark.justNow')

  const diffMinutes = Math.floor((Date.now() - time) / 60_000)
  if (diffMinutes < 1) return t('bookmark.justNow')
  if (diffMinutes < 60) return t('bookmark.minutesAgo', { n: diffMinutes })

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return t('bookmark.hoursAgo', { n: diffHours })

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return t('bookmark.daysAgo', { n: diffDays })

  return t('bookmark.weeksAgo', { n: Math.floor(diffDays / 7) })
}

const rows = computed<TrashRow[]>(() =>
  bookmarkStore.trashedBookmarks.map(bookmark => ({
    id: bookmark.id,
    // 标题为空时退化为 URL，再退化为 id（永不渲染空行）
    title: bookmark.title || bookmark.url || bookmark.id,
    host: hostOf(bookmark.url),
    deletedText: relativeTime(bookmark.deletedAt)
  }))
)

const handleRestore = async (id: string) => {
  if (busy.value) return

  busy.value = true
  try {
    // 一次 IPC：主进程把 deletedAt 置 null；store 负责刷新两个列表并弹 toast
    await bookmarkStore.restoreBookmarks([id])
  } catch (error) {
    // store 已经提示过错误文案，这里只保留日志
    console.error(error)
  } finally {
    busy.value = false
  }
}

const handlePurge = async (row: TrashRow) => {
  if (busy.value) return

  // 永久删除不可撤销：执行前必须二次确认（用户取消则静默返回）
  try {
    await ElMessageBox.confirm(
      t('trash.purgeConfirm', { name: row.title }),
      t('trash.title'),
      {
        confirmButtonText: t('trash.purge'),
        cancelButtonText: t('common.cancel'),
        type: 'warning',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }

  busy.value = true
  try {
    await bookmarkStore.purgeBookmarks([row.id])
  } catch (error) {
    console.error(error)
  } finally {
    busy.value = false
  }
}

const handleEmptyTrash = async () => {
  if (emptying.value || rows.value.length === 0) return

  try {
    await ElMessageBox.confirm(t('trash.emptyConfirm'), t('trash.title'), {
      confirmButtonText: t('trash.emptyTrash'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    })
  } catch {
    return
  }

  emptying.value = true
  try {
    await bookmarkStore.emptyTrash()
  } catch (error) {
    console.error(error)
  } finally {
    emptying.value = false
  }
}

/** 打开时重新拉一次：用户可能刚在别处删过书签，回收站必须是最新的 */
watch(
  () => props.modelValue,
  visible => {
    if (visible) {
      busy.value = false
      emptying.value = false
      void bookmarkStore.fetchTrashed()
    }
  }
)

/** 关闭后重置内部状态：再次打开时不带上一次的「进行中」状态 */
const handleClosed = () => {
  busy.value = false
  emptying.value = false
}
</script>

<style scoped>
.trash-summary {
  margin: 0 0 var(--lc-space-4);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-regular);
}

.trash-none {
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

.trash-none i {
  font-size: 20px;
  color: var(--lc-text-muted);
}

.trash-list {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-2);
  max-height: 360px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.trash-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
  min-width: 0;
  padding: var(--lc-space-3);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-sm);
}

.trash-item-main {
  flex: 1;
  min-width: 0;
}

.trash-item-title {
  overflow: hidden;
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-item-meta {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  min-width: 0;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
}

.trash-item-host {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash-item-time {
  flex-shrink: 0;
}

.trash-item-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--lc-space-1);
}

/* EP 默认给相邻按钮加 margin-left，这里统一由 gap 表达 */
.trash-item-actions .el-button + .el-button {
  margin-left: 0;
}

@media (max-width: 600px) {
  .trash-item {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
