<template>
  <div class="settings-section">
    <h2 class="section-title">
      <i class="i-heroicons-arrow-path" />
      {{ t('settings.updates') }}
    </h2>

    <div class="settings-item">
      <div class="settings-item-content">
        <div class="settings-item-label">
          {{ t('settings.autoUpdate') }}
        </div>
        <div class="settings-item-description">
          {{ t('settings.autoUpdateDesc') }}
        </div>
      </div>
      <el-switch
        v-model="autoUpdate"
        :disabled="savingAutoUpdate"
        @change="handleAutoUpdateChange"
      />
    </div>

    <div class="settings-item">
      <div class="settings-item-content">
        <div class="settings-item-label">
          {{ t('settings.currentVersion', { version: currentVersion || '—' }) }}
        </div>
        <div class="settings-item-description">
          {{ t('settings.updatesDesc') }}
        </div>
      </div>
      <div class="update-actions">
        <!--
          「检查更新」是**手动**动作：用户即便关掉自动更新也仍可用（主进程 manual = true）。
          仅未打包环境才禁用（那里 electron-updater 没有更新配置，查了也只报错）。
        -->
        <el-button
          type="primary"
          plain
          :loading="isChecking"
          :disabled="!enabled || isChecking"
          @click="handleCheck"
        >
          {{ isChecking ? t('settings.checking') : t('settings.checkUpdates') }}
        </el-button>
        <el-button
          v-if="showDownload"
          type="primary"
          :loading="isDownloading"
          :disabled="isDownloading"
          @click="handleDownload"
        >
          {{ t('settings.downloadUpdate') }}
        </el-button>
        <el-button
          v-if="showInstall"
          type="success"
          @click="handleInstall"
        >
          {{ t('settings.installUpdate') }}
        </el-button>
      </div>
    </div>

    <p
      v-if="statusText"
      class="update-status"
      :class="statusClass"
    >
      {{ statusText }}
    </p>

    <!-- 失败原因用 el-alert 而不是红字：更新失败是常态（无发布通道/断网/签名），
         需要可读的完整信息，并且不能打断整页其它设置的操作 -->
    <el-alert
      v-if="status.state === 'error'"
      class="update-alert"
      type="error"
      :closable="false"
      show-icon
      :title="failureText"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { useUIStore } from '../../stores'
import type { UpdateStatus } from '../../types/global'

/**
 * 设置页「更新」区块。
 *
 * 状态**全部来自主进程**（`get-update-status` 拉一次 + `onUpdateStatus` 订阅广播），
 * 本组件不自己推断「是否在检查/下载」：两边各推一份状态是这类 UI 最常见的 bug 来源
 * （关掉设置页再打开就会显示与主进程不一致的进度）。
 *
 * 唯一本地状态是 `autoUpdate` 开关（持久化在设置里）与 `savingAutoUpdate`（防连点）。
 */
const { t } = useI18n()
const uiStore = useUIStore()
const { settings } = storeToRefs(uiStore)

const status = ref<UpdateStatus>({ state: 'idle' })
const currentVersion = ref('')
/** 是否支持自动更新（= 主进程 `app.isPackaged`）：开发环境为 false */
const enabled = ref(false)
const autoUpdate = ref(settings.value?.autoUpdate !== false)
const savingAutoUpdate = ref(false)

/** 取消订阅函数：不持有它重挂就会叠加监听（每多一个监听多一次无谓的赋值） */
let unsubscribe: (() => void) | null = null

const isChecking = computed(() => status.value.state === 'checking')
const isDownloading = computed(() => status.value.state === 'downloading')
const showDownload = computed(
  () => status.value.state === 'available' || status.value.state === 'downloading'
)
const showInstall = computed(() => status.value.state === 'downloaded')

/**
 * 进度展示：主进程已经 `clampPercent` 过，这里再取整一次只是为了防止
 * 手工构造的旧状态（或未来新增的事件）把浮点/NaN 漏到 UI 上。
 */
const percentLabel = computed(() => Math.round(status.value.percent ?? 0))

/**
 * 已知的失败原因映射到本地化文案。
 *
 * electron-updater 的错误信息是英文的，直接拼进中文界面会中英混排；
 * 这里只翻译「我们自己产生的、可预期的」几种原因，其它（网络/签名等原始错误）
 * 原样展示——那种信息对排查更有价值，硬翻反而会丢细节。
 */
const KNOWN_FAILURE_KEYS: Record<string, string> = {
  'Update check returned no result for this build': 'settings.updateNoFeed',
  'Update check timed out': 'settings.updateTimeout'
}

const failureText = computed(() => {
  const message = status.value.message || 'Unknown error'
  const key = KNOWN_FAILURE_KEYS[message]
  return t('settings.updateFailed', { message: key ? t(key) : message })
})

const statusText = computed(() => {
  switch (status.value.state) {
    case 'checking':
      return t('settings.checking')
    case 'not-available':
      return t('settings.upToDate')
    case 'available':
      return t('settings.updateAvailable', { version: status.value.version ?? '' })
    case 'downloading':
      return t('settings.downloading', { percent: percentLabel.value })
    case 'downloaded':
      return t('settings.updateDownloaded')
    case 'disabled':
      return t('settings.updateDisabled')
    case 'error':
      // 失败原因交给 el-alert 展示（可能有 200 字符，不适合挤在一行状态文案里）
      return ''
    default:
      return ''
  }
})

const statusClass = computed(() => {
  switch (status.value.state) {
    case 'available':
    case 'downloaded':
    case 'not-available':
      return 'is-success'
    case 'disabled':
      return 'is-muted'
    default:
      return ''
  }
})

/** 主进程的失败分支同时会广播 error 状态；这里兜底一次，避免广播早于订阅时 UI 无反馈 */
const applyFailure = (error?: string) => {
  status.value = { state: 'error', message: error || 'Unknown error' }
}

const handleCheck = async () => {
  if (isChecking.value) return

  const result = await window.electronAPI.checkForUpdates()
  // 未打包时主进程返回的失败是「环境不支持」，不该渲染成红色错误
  if (!result.success && enabled.value) {
    applyFailure(result.error)
  }
}

const handleDownload = async () => {
  if (isDownloading.value) return

  const result = await window.electronAPI.downloadUpdate()
  if (!result.success) {
    applyFailure(result.error)
  }
}

const handleInstall = async () => {
  const result = await window.electronAPI.installUpdate()
  // 成功时应用会直接退出并安装，一般走不到这里；失败才需要反馈
  if (!result.success) {
    applyFailure(result.error)
  }
}

/**
 * 「改动即保存」：开关没有「保存」按钮，避免用户以为还要再点一次底部的 Save。
 * 落盘失败（磁盘只读等）时把开关拨回去，保持 UI 与磁盘一致。
 */
const handleAutoUpdateChange = async (value: string | number | boolean) => {
  const next = value === true
  const current = settings.value
  if (!current) return

  const previous = current.autoUpdate
  current.autoUpdate = next
  savingAutoUpdate.value = true

  try {
    // store 的 saveSettings 内部已就序列化 + 提示 message.settingsSaveFailed
    await uiStore.saveSettings()
  } catch {
    current.autoUpdate = previous
    autoUpdate.value = previous !== false
  } finally {
    savingAutoUpdate.value = false
  }
}

// 设置可能还没加载完（子组件的 onMounted 早于父组件）：跟着 store 走，不在本地另存一份真相
watch(
  () => settings.value?.autoUpdate,
  value => {
    autoUpdate.value = value !== false
  },
  { immediate: true }
)

onMounted(async () => {
  // 先订阅再拉快照：两步之间的状态变化不会丢
  unsubscribe = window.electronAPI.onUpdateStatus(next => {
    status.value = next
  })

  try {
    const snapshot = await window.electronAPI.getUpdateStatus()
    currentVersion.value = snapshot.currentVersion
    enabled.value = snapshot.enabled
    // 去掉快照特有的两个字段后再赋给状态（status 只描述状态机本身）
    const { state, version, percent, message } = snapshot
    status.value = { state, version, percent, message }
  } catch (error) {
    console.warn('[update] Failed to load update status:', error)
  }

  if (!settings.value) {
    await uiStore.fetchSettings()
  }
})

onUnmounted(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<style scoped>
/*
 * 这个区块是独立组件，父级 SettingsView 的 scoped 样式**不会**作用到子组件内部节点，
 * 因此这里自带一份与设置页一致的「区块 / 条目」排版（只用 --lc-* 变量）。
 */
.settings-section {
  min-width: 0;
  padding: var(--lc-space-5);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-subtle);
  border-radius: var(--lc-radius-lg);
  box-shadow: var(--lc-shadow-card);
}

.section-title {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  margin: 0 0 var(--lc-space-4);
  padding-bottom: var(--lc-space-3);
  border-bottom: 1px solid var(--lc-border-subtle);
  font-size: var(--lc-font-lg);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-primary);
}

.section-title i {
  font-size: 20px;
  color: var(--lc-accent);
}

.settings-item {
  display: grid;
  grid-template-columns: minmax(var(--lc-form-label-width, 140px), 1fr) max-content;
  align-items: center;
  gap: var(--lc-space-6);
  min-height: 48px;
  padding: var(--lc-space-4) 0;
  border-bottom: 1px solid var(--lc-border-subtle);
}

.settings-item:last-of-type {
  border-bottom: 0;
}

.settings-item-content {
  min-width: 0;
}

.settings-item-label {
  margin-bottom: var(--lc-space-1);
  font-size: var(--lc-font-base);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-primary);
}

.settings-item-description {
  font-size: var(--lc-font-sm);
  color: var(--lc-text-muted);
}

.update-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: var(--lc-space-2);
}

/* Element Plus 默认给相邻按钮加 margin-left，这里统一交给 gap 表达 */
.update-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.update-actions :deep(.el-button) {
  height: var(--lc-control-lg);
}

.update-status {
  margin: var(--lc-space-3) 0 0;
  font-size: var(--lc-font-sm);
  color: var(--lc-text-regular);
}

.update-status.is-success {
  color: var(--lc-success);
}

.update-status.is-muted {
  color: var(--lc-text-muted);
}

.update-alert {
  margin-top: var(--lc-space-3);
}

@media (max-width: 600px) {
  .settings-item {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--lc-space-3);
  }

  .update-actions {
    justify-content: flex-start;
  }
}
</style>
