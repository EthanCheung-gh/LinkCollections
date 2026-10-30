<template>
  <div class="quick-add">
    <div class="quick-add__title">{{ t('quickAdd.title') }}</div>

    <el-input
      ref="urlInputRef"
      v-model="url"
      class="quick-add__input"
      :class="{ 'is-invalid': invalidUrl }"
      :placeholder="t('quickAdd.urlPlaceholder')"
      autocomplete="off"
      spellcheck="false"
      @input="handleInput"
      @keydown.enter.prevent="handleSave"
    />

    <!--
      提示区**常驻**（无提示时也占 16px）：浮窗高度固定 190px 且不可缩放，
      若提示出现/消失改变高度，底部按钮会被挤出窗口或抖动。
    -->
    <div class="quick-add__hint" :class="{ 'is-error': hint }">{{ hint }}</div>

    <el-input
      v-model="title"
      class="quick-add__input"
      :placeholder="t('quickAdd.titlePlaceholder')"
      autocomplete="off"
      spellcheck="false"
      @keydown.enter.prevent="handleSave"
    />

    <div class="quick-add__actions">
      <el-button @click="handleCancel">{{ t('quickAdd.cancel') }}</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">
        {{ t('quickAdd.save') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { InputInstance } from 'element-plus'
import { useBookmarkStore, useUIStore } from './stores'
import { isValidUrl, normalizeUrl } from './utils/validation'

/**
 * 快速添加浮窗的根组件（`?view=quickadd`）。
 *
 * 与主窗口共用同一张 `index.html` / 同一份 preload / 同一套 Pinia 实例注册：
 * 浮窗只是「另一个入口」，不是第二份应用。
 *
 * 交互契约：
 * - URL 输入框自动聚焦，`Enter` 直接保存（先 `normalizeUrl` 再 `isValidUrl`，
 *   与 AddBookmarkDialog 的校验口径一致，`example.com` 这类半成品也能存）；
 * - 校验/保存失败**不关窗**，在输入框下方就地提示（用户不该为了看清错误再按一次快捷键）；
 * - `Esc` = 取消（隐藏浮窗）；
 * - 保存成功：`addBookmark` → `notifyBookmarksChanged`（让主窗口刷新）→ `closeQuickAdd`。
 *
 * 窗口尺寸 460×190 由主进程固定（`electron/quick-add.ts` 的 QUICK_ADD_*），
 * 因此这里禁止出现滚动条：根节点 `height: 100vh` + `overflow: hidden`，间距全部走 `--lc-space-*`。
 */
const { t } = useI18n()

const bookmarkStore = useBookmarkStore()
const uiStore = useUIStore()

const urlInputRef = ref<InputInstance | null>(null)
const url = ref('')
const title = ref('')
const saving = ref(false)
const invalidUrl = ref(false)
const saveFailed = ref(false)

const hint = computed(() => {
  // 校验错误优先：用户改了输入但还没重按保存时，仍应看到「网址不合法」
  if (invalidUrl.value) return t('quickAdd.invalidUrl')
  if (saveFailed.value) return t('quickAdd.saveFailed')
  return ''
})

const focusUrlInput = (): void => {
  urlInputRef.value?.focus()
}

/**
 * 隐藏浮窗（不是关闭/销毁）。
 *
 * 失败只记日志：窗口已经处于「用户不想再输入」的状态，不值得为一个隐藏失败弹提示。
 */
const closeWindow = async (): Promise<void> => {
  try {
    await window.electronAPI.closeQuickAdd()
  } catch (error) {
    console.error('[QuickAdd] Failed to hide the quick add window:', error)
  }
}

const handleInput = (): void => {
  // 用户开始修改输入即清掉旧错误，避免「已经改对了但红字还在」
  invalidUrl.value = false
  saveFailed.value = false
}

const handleCancel = (): void => {
  void closeWindow()
}

const handleSave = async (): Promise<void> => {
  if (saving.value) return

  saveFailed.value = false

  const normalizedUrl = normalizeUrl(url.value)
  if (!isValidUrl(normalizedUrl)) {
    invalidUrl.value = true
    focusUrlInput()
    return
  }
  invalidUrl.value = false

  saving.value = true
  try {
    // 标题留空是合法的：主进程 add-bookmark 会退回用 url 作标题（见 electron/ipc/bookmarks.ts）
    await bookmarkStore.addBookmark({ url: normalizedUrl, title: title.value.trim() })
  } catch (error) {
    // store 内部已经 toast 过一次失败；这里保持窗口打开并就地提示，让用户能改完再试
    console.error('[QuickAdd] Failed to save the bookmark:', error)
    saveFailed.value = true
    return
  } finally {
    saving.value = false
  }

  // 走到这里说明书签已经落盘。后面的「通知 + 隐藏」即使失败也不能报成「保存失败」
  // （那会让用户以为没存上而再存一次，产生重复记录）。
  try {
    await window.electronAPI.notifyBookmarksChanged()
  } catch (error) {
    console.error('[QuickAdd] Bookmark saved, but notifying other windows failed:', error)
  }

  // 清空输入：浮窗是复用的（只 hide 不 destroy），下次呼出不该看到上次的残留
  url.value = ''
  title.value = ''
  await closeWindow()
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  void closeWindow()
}

onMounted(async () => {
  // Esc 挂在 window 上：焦点可能已经离开输入框（例如点过按钮），元素级监听会漏掉
  window.addEventListener('keydown', handleKeydown)

  // 先应用主题/语言再聚焦：这两个都写在 <html> / vue-i18n 上，晚应用会看到浅色一闪 + 旧语言文案
  await uiStore.fetchSettings()
  await nextTick()
  focusUrlInput()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.quick-add {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-2);
  height: 100vh;
  /* 固定窗口 + 无圆角外框：只留 1px 描边把浮窗与背后的页面分开 */
  padding: var(--lc-space-3) var(--lc-space-4);
  overflow: hidden;
  color: var(--lc-text-primary);
  background-color: var(--lc-bg-surface);
  border: 1px solid var(--lc-border-default);
}

.quick-add__title {
  flex: none;
  font-size: var(--lc-font-xs);
  font-weight: var(--lc-weight-medium);
  color: var(--lc-text-muted);
}

/* 常驻占位（无提示时是空字符串），避免固定高度下按钮位置抖动 */
.quick-add__hint {
  flex: none;
  min-height: var(--lc-space-4);
  font-size: var(--lc-font-xs);
  line-height: var(--lc-space-4);
  color: var(--lc-text-muted);
}

.quick-add__hint.is-error {
  color: var(--lc-danger);
}

.quick-add__input {
  flex: none;
}

/* EP 内部结构不直接改：只覆盖 wrapper 的描边色，用来表达「这一栏有错」 */
.quick-add__input.is-invalid :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--lc-danger) inset;
}

.quick-add__actions {
  flex: none;
  display: flex;
  justify-content: flex-end;
  gap: var(--lc-space-2);
  /* 把按钮压到底部，剩余空间由这里吸收（窗口固定高度，不需要滚动） */
  margin-top: auto;
}
</style>
