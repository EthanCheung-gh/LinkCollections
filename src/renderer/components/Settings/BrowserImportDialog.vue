<template>
  <el-dialog
    v-model="dialogVisible"
    :title="t('browserImport.title')"
    width="var(--lc-dialog-width-lg)"
    @closed="handleClosed"
  >
    <!-- 只做 Chromium 家族：Firefox/Safari 的存储格式需要原生依赖，明确引导用户走 HTML 导入 -->
    <p class="bi-intro">
      {{ t('browserImport.intro') }}
    </p>

    <div
      v-if="loading"
      class="bi-loading"
    >
      {{ t('browserImport.detecting') }}
    </div>

    <div
      v-else-if="candidates.length === 0"
      class="bi-empty"
    >
      <p class="bi-empty-title">
        {{ t('browserImport.empty') }}
      </p>
      <p class="bi-empty-hint">
        {{ t('browserImport.emptyHint') }}
      </p>
    </div>

    <template v-else>
      <ul class="bi-list">
        <li
          v-for="candidate in candidates"
          :key="candidate.id"
          class="bi-item"
          :class="{ active: candidate.id === selectedId }"
          @click="selectedId = candidate.id"
        >
          <div class="bi-item-main">
            <div class="bi-item-title">
              {{ t('browserImport.profileLabel', { browser: candidate.browser, profile: candidate.profile }) }}
            </div>
            <!-- 路径只用于让用户确认「是哪一个文件」，不参与任何逻辑判断 -->
            <div
              class="bi-item-path"
              :title="candidate.path"
            >
              {{ candidate.path }}
            </div>
          </div>
          <div class="bi-item-count">
            {{ t('browserImport.counts', { bookmarks: candidate.bookmarkCount, folders: candidate.folderCount }) }}
          </div>
        </li>
      </ul>

      <div class="bi-mode">
        <span class="bi-mode-label">{{ t('browserImport.mergeMode') }}</span>
        <el-radio-group v-model="mergeMode">
          <el-radio-button value="merge">
            {{ t('importExport.merge') }}
          </el-radio-button>
          <el-radio-button value="replace">
            {{ t('importExport.replace') }}
          </el-radio-button>
        </el-radio-group>
      </div>
    </template>

    <template #footer>
      <el-button @click="dialogVisible = false">
        {{ t('common.cancel') }}
      </el-button>
      <el-button
        type="primary"
        :loading="importing"
        :disabled="!selectedId || importing || loading"
        @click="handleImport"
      >
        {{ t('browserImport.import') }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useBookmarkStore, useFolderStore, useTagStore } from '../../stores'
import type { BrowserBookmarkCandidate } from '../../types/global'

/**
 * 「从浏览器导入」弹窗（Chromium 家族直读）。
 *
 * 流程：打开 → 探测（主进程扫描已知目录，永不 reject）→ 用户选一个候选 + 选模式 →
 * 二次确认（仅 replace）→ 一次 IPC 导入 → 刷新 store → 汇总提示 → 关闭。
 *
 * 路径**只从探测结果里选**：渲染层永远不自己拼路径，主进程也只接受本次探测过的路径，
 * 因此这个弹窗没有办法让主进程读取任意文件。
 */

interface Props {
  modelValue: boolean
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { t } = useI18n()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()

const dialogVisible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value)
})

const loading = ref(false)
const importing = ref(false)
const candidates = ref<BrowserBookmarkCandidate[]>([])
const selectedId = ref('')

/** 默认 merge：重复导入同一个浏览器文件不会把书签翻倍 */
const mergeMode = ref<'merge' | 'replace'>('merge')

const selectedCandidate = computed(
  () => candidates.value.find(candidate => candidate.id === selectedId.value) ?? null
)

const detect = async () => {
  loading.value = true
  try {
    const result = await window.electronAPI.detectBrowserBookmarks()
    candidates.value = result.candidates
    // 默认选中第一个候选：通常只有一个 Chrome Default，用户点「导入」即可
    selectedId.value = result.candidates[0]?.id ?? ''

    if (!result.success) {
      ElMessage.error(result.error || t('browserImport.detectFailed'))
    }
  } catch (error) {
    // 主进程理论上是恒 resolve 的；这里只兜底 IPC 层异常
    candidates.value = []
    selectedId.value = ''
    ElMessage.error(t('browserImport.detectFailed'))
    console.error(error)
  } finally {
    loading.value = false
  }
}

// 每次打开都重新探测：用户可能刚在浏览器里加了书签，或刚关掉某个浏览器
watch(
  () => props.modelValue,
  open => {
    if (open) {
      void detect()
    }
  }
)

const handleImport = async () => {
  const candidate = selectedCandidate.value
  if (!candidate || importing.value) return

  // replace 会丢弃全部现有数据（书签 / 文件夹 / 标签 / 访问历史），必须二次确认
  if (mergeMode.value === 'replace') {
    try {
      await ElMessageBox.confirm(
        t('browserImport.replaceConfirm'),
        t('browserImport.replaceTitle'),
        {
          confirmButtonText: t('importExport.replace'),
          cancelButtonText: t('common.cancel'),
          type: 'warning',
          confirmButtonClass: 'el-button--danger'
        }
      )
    } catch {
      return
    }
  }

  importing.value = true
  try {
    const result = await window.electronAPI.importBrowserBookmarks({
      path: candidate.path,
      mergeMode: mergeMode.value
    })

    if (!result.success) {
      ElMessage.error(result.error || t('browserImport.failed'))
      return
    }

    // 一次 IPC 已完成落盘，这里只需把三个 store 拉到最新（main.ts 不广播导入事件）
    await bookmarkStore.fetchBookmarks()
    await folderStore.fetchFolders()
    await tagStore.fetchTags()

    dialogVisible.value = false
    ElMessage.success(
      t('browserImport.imported', {
        bookmarks: result.imported.bookmarks,
        skipped: result.skipped
      })
    )
  } catch (error) {
    ElMessage.error(t('browserImport.failed'))
    console.error(error)
  } finally {
    importing.value = false
  }
}

/** 关闭后丢弃上一次的探测结果与选择：再次打开会重新探测（避免展示已失效的路径），模式回到默认 merge */
const handleClosed = () => {
  candidates.value = []
  selectedId.value = ''
  importing.value = false
  mergeMode.value = 'merge'
}
</script>

<style scoped>
.bi-intro {
  margin: 0 0 var(--lc-space-4);
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
}

.bi-loading {
  padding: var(--lc-space-5);
  background-color: var(--lc-bg-subtle);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
  font-size: var(--lc-font-base);
  color: var(--lc-text-regular);
  text-align: center;
}

.bi-empty {
  padding: var(--lc-space-5);
  background-color: var(--lc-bg-subtle);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-md);
}

.bi-empty-title {
  margin: 0 0 var(--lc-space-2);
  font-size: var(--lc-font-base);
  color: var(--lc-text-primary);
}

.bi-empty-hint {
  margin: 0;
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
}

.bi-list {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-2);
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.bi-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
  min-width: 0;
  padding: var(--lc-space-3);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-sm);
  cursor: pointer;
}

.bi-item:hover {
  border-color: var(--lc-accent);
}

.bi-item.active {
  border-color: var(--lc-accent);
  background-color: var(--lc-accent-soft);
}

.bi-item-main {
  flex: 1;
  min-width: 0;
}

.bi-item-title {
  margin-bottom: var(--lc-space-1);
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
}

/* 路径可能很长（Windows 尤其）：单行截断，完整值放 title 里 */
.bi-item-path {
  overflow: hidden;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bi-item-count {
  flex-shrink: 0;
  font-size: var(--lc-font-xs);
  color: var(--lc-text-muted);
}

.bi-mode {
  display: flex;
  align-items: center;
  gap: var(--lc-space-3);
  margin-top: var(--lc-space-4);
}

.bi-mode-label {
  font-size: var(--lc-font-sm);
  color: var(--lc-text-regular);
}

.bi-mode :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  height: var(--lc-control-lg);
}
</style>
