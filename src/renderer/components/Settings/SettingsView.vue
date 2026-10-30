<template>
  <div class="settings-view">
    <h1 class="settings-title">
      {{ t('settings.title') }}
    </h1>

    <div class="settings-sections">
      <div class="settings-section">
        <h2 class="section-title">
          <i class="i-heroicons-paint-brush" />
          {{ t('settings.appearance') }}
        </h2>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.theme') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.chooseTheme') }}
            </div>
          </div>
          <el-radio-group v-model="localSettings.theme" @change="handleThemeChange">
            <el-radio-button value="light">
              {{ t('settings.themeLight') }}
            </el-radio-button>
            <el-radio-button value="dark">
              {{ t('settings.themeDark') }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.language') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.chooseLanguage') }}
            </div>
          </div>
          <el-select
            v-model="localSettings.language"
            class="browser-select"
            :placeholder="t('settings.language')"
            @change="handleLanguageChange"
          >
            <el-option :label="t('settings.languageEn')" value="en" />
            <el-option :label="t('settings.languageZh')" value="zh" />
          </el-select>
        </div>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.themeColor') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.themeColorDesc') }}
            </div>
          </div>
          <div class="theme-color-options">
            <div class="theme-color-presets">
              <div
                v-for="color in themeColors"
                :key="color.value"
                class="theme-color-dot"
                :class="{
                  active:
                    !localSettings.useCustomThemeColor && localSettings.themeColor === color.value
                }"
                :style="{ backgroundColor: color.value }"
                :title="color.name"
                @click="selectThemeColor(color.value)"
              />
            </div>
            <el-switch
              v-model="localSettings.useCustomThemeColor"
              :active-text="t('settings.customColor')"
            />
            <el-color-picker
              v-if="localSettings.useCustomThemeColor"
              v-model="localSettings.themeColor"
              show-alpha
              @change="handleThemeColorChange"
            />
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="section-title">
          <i class="i-heroicons-globe-alt" />
          {{ t('settings.browser') }}
        </h2>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.defaultBrowser') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.primaryBrowser') }}
            </div>
          </div>
          <div class="browser-inputs control-column">            <el-input
              v-model="defaultBrowserName"
              :placeholder="t('settings.browserName')"
              style="flex: 1"
            />
            <el-input
              v-model="defaultBrowserPath"
              :placeholder="t('settings.browserPath')"
              style="flex: 2"
              @change="handleBrowserChange"
            />
          </div>
        </div>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.availableBrowsers') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.additionalBrowsers') }}
            </div>
          </div>
          <div class="browser-list control-column">
            <div
              v-for="(browser, index) in localSettings.availableBrowsers"
              :key="index"
              class="browser-item"
            >
              <div class="browser-inputs">
                <el-input
                  v-model="browser.name"
                  :placeholder="t('settings.browserName')"
                  style="flex: 1"
                />
                <el-input
                  v-model="browser.path"
                  :placeholder="t('settings.browserPath')"
                  style="flex: 2"
                />
              </div>
              <el-button
                text
                type="danger"
                class="browser-remove"
                @click="removeBrowser(index)"
              >                <i class="i-heroicons-x-mark" />
              </el-button>
            </div>
            <el-button text type="primary" @click="addBrowser">
              <i class="i-heroicons-plus" />
              {{ t('settings.addBrowser') }}
            </el-button>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="section-title">
          <i class="i-heroicons-cog-6-tooth" />
          {{ t('settings.general') }}
        </h2>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.autoFetchFavicon') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.autoFetchFaviconDesc') }}
            </div>
          </div>
          <el-switch v-model="localSettings.autoFetchIcon" @change="handleAutoFetchChange" />
        </div>
        <div v-if="localSettings.autoFetchIcon" class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.faviconService') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.faviconServiceDesc') }}
            </div>
          </div>
          <el-radio-group v-model="localSettings.useForeignFavicon">
            <el-radio-button :value="false">
              {{ t('settings.domestic') }} (自动获取)
            </el-radio-button>
            <el-radio-button :value="true">{{ t('settings.foreign') }} (Google) </el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <div class="settings-section">
        <h2 class="section-title">
          <i class="i-heroicons-information-circle" />
          {{ t('settings.about') }}
        </h2>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('app.name') }}
            </div>
            <div class="settings-item-description">
              {{ t('app.version') }}
            </div>
          </div>
        </div>
      </div>

      <ImportExport />

      <div class="settings-section">
        <h2 class="section-title">
          <i class="i-heroicons-trash" />
          {{ t('settings.dataManagement') }}
        </h2>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.checkLinks') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.checkLinksDesc') }}
            </div>
          </div>
          <el-button
            type="primary"
            plain
            :loading="checkingLinks"
            :disabled="checkingLinks"
            @click="handleCheckLinks"
          >
            {{ checkingLinks ? t('settings.checkingLinks') : t('settings.checkLinks') }}
          </el-button>
        </div>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.mergeDuplicates') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.mergeDuplicatesDesc') }}
            </div>
          </div>
          <el-button
            type="primary"
            plain
            @click="openMergeDuplicates"
          >
            {{ t('settings.mergeDuplicatesAction') }}
          </el-button>
        </div>
        <div class="settings-item">
          <div class="settings-item-content">
            <div class="settings-item-label">
              {{ t('settings.clearAllData') }}
            </div>
            <div class="settings-item-description">
              {{ t('settings.clearAllDataDesc') }}
            </div>
          </div>
          <el-button type="danger" @click="clearAllData">
            {{ t('settings.clearAll') }}
          </el-button>
        </div>
      </div>
    </div>

    <div class="settings-footer">
      <el-button @click="resetToDefaults">
        {{ t('settings.resetToDefaults') }}
      </el-button>
      <el-button
        type="primary"
        @click="saveSettings()"
      >        {{ t('common.save') }}
      </el-button>
    </div>

    <LinkCheckDialog v-model="linkCheckVisible" :result="linkCheckResult" />
    <MergeDuplicatesDialog
      v-model="mergeDuplicatesVisible"
      :plan="mergeDuplicatesPlan"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useUIStore, useBookmarkStore, useFolderStore, useTagStore } from '../../stores'
import type { Settings } from '../../types'
import type { LinkCheckResult } from '../../types/global'
import ImportExport from './ImportExport.vue'
import LinkCheckDialog from './LinkCheckDialog.vue'
import MergeDuplicatesDialog from './MergeDuplicatesDialog.vue'
import { planDuplicateMerges, type DuplicateMergePlan } from '../../../../shared/duplicates'
import { DEFAULT_FAVICON_SERVICES } from '../../utils/favicon'
import { THEME_COLORS } from '../../types/settings'

const { t } = useI18n()
const uiStore = useUIStore()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const { settings } = storeToRefs(uiStore)
const { fetchSettings } = uiStore

const localSettings = ref<Settings>({
  defaultBrowser: '',
  availableBrowsers: [],
  viewMode: 'card',
  sidebarCollapsed: false,
  theme: 'light',
  themeColor: '#3B82F6',
  useCustomThemeColor: false,
  autoFetchIcon: true,
  language: 'en',
  faviconService: DEFAULT_FAVICON_SERVICES,
  useForeignFavicon: false
})

const defaultBrowserName = ref('')
const defaultBrowserPath = ref('')

/**
 * 死链检查：按钮 loading 期间禁用（同一时刻只允许一轮检查），
 * 结果交给 `LinkCheckDialog` 展示 —— 这里不弹 toast，弹窗本身就是结果入口。
 */
const checkingLinks = ref(false)
const linkCheckVisible = ref(false)
const linkCheckResult = ref<LinkCheckResult | null>(null)

/**
 * 重复书签合并：预览在**本地**用共享纯函数算好再开弹窗（不写盘、不走 IPC），
 * 用户因此能先看到「哪些组、保留哪条、将删除几条」再决定是否执行。
 */
const mergeDuplicatesVisible = ref(false)
const mergeDuplicatesPlan = ref<DuplicateMergePlan | null>(null)

const openMergeDuplicates = () => {
  mergeDuplicatesPlan.value = planDuplicateMerges(bookmarkStore.bookmarks, new Date())
  mergeDuplicatesVisible.value = true
}

const themeColors = THEME_COLORS

const defaultSettings: Settings = {
  defaultBrowser: '',
  availableBrowsers: [],
  viewMode: 'card',
  sidebarCollapsed: false,
  theme: 'light',
  themeColor: '#3B82F6',
  useCustomThemeColor: false,
  autoFetchIcon: true,
  language: 'en',
  faviconService: DEFAULT_FAVICON_SERVICES,
  useForeignFavicon: false
}

let isSaving = false

watch([defaultBrowserName, defaultBrowserPath], ([name, path]) => {
  if (name || path) {
    localSettings.value.defaultBrowser = {
      name,
      path,
      icon: 'i-heroicons-globe-alt'
    }
  } else {
    localSettings.value.defaultBrowser = ''
  }
})

watch(
  settings,
  newSettings => {
    if (newSettings && !isSaving) {
      const currentBrowsers = localSettings.value.availableBrowsers
      localSettings.value = {
        ...newSettings,
        availableBrowsers: currentBrowsers
      }

      if (typeof newSettings.defaultBrowser === 'string') {
        defaultBrowserName.value = ''
        defaultBrowserPath.value = newSettings.defaultBrowser
      } else if (newSettings.defaultBrowser && typeof newSettings.defaultBrowser === 'object') {
        defaultBrowserName.value = newSettings.defaultBrowser.name || ''
        defaultBrowserPath.value = newSettings.defaultBrowser.path || ''
      }
    }
  },
  { deep: true, immediate: true }
)

const handleThemeChange = (value: string) => {
  localSettings.value.theme = value as 'light' | 'dark'
  applyTheme(value, localSettings.value.themeColor)
}

const selectThemeColor = (color: string) => {
  localSettings.value.themeColor = color
  localSettings.value.useCustomThemeColor = false
  applyTheme(localSettings.value.theme, color)
}

const handleThemeColorChange = (color: string | null) => {
  if (color) {
    applyTheme(localSettings.value.theme, color)
  }
}

const handleBrowserChange = (_value: string) => {}

const normalizePath = (path: string): string => {
  if (!path) return ''
  let normalized = path.trim()
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1)
  } else if (normalized.startsWith("'") && normalized.endsWith("'")) {
    normalized = normalized.slice(1, -1)
  }
  return normalized
}

const addBrowser = () => {
  localSettings.value.availableBrowsers.push({
    name: '',
    path: '',
    icon: 'i-heroicons-globe-alt'
  })
}

const removeBrowser = (index: number) => {
  localSettings.value.availableBrowsers.splice(index, 1)
}

const saveSettings = async (showSuccess = true): Promise<boolean> => {
  try {
    isSaving = true

    const defaultBrowserObj =
      typeof localSettings.value.defaultBrowser === 'object'
        ? localSettings.value.defaultBrowser
        : { name: '', path: localSettings.value.defaultBrowser, icon: 'i-heroicons-globe-alt' }

    const settingsToSave = {
      defaultBrowser: {
        name: defaultBrowserName.value,
        path: normalizePath(defaultBrowserPath.value),
        icon: defaultBrowserObj.icon
      },
      availableBrowsers: localSettings.value.availableBrowsers.map(b => ({
        ...b,
        path: normalizePath(b.path)
      })),
      viewMode: localSettings.value.viewMode,
      sidebarCollapsed: localSettings.value.sidebarCollapsed,
      theme: localSettings.value.theme,
      themeColor: localSettings.value.themeColor,
      useCustomThemeColor: localSettings.value.useCustomThemeColor,
      autoFetchIcon: localSettings.value.autoFetchIcon,
      language: localSettings.value.language,
      // v1.1.0 的 favicon 服务配置：原实现漏了这两项，导致选择后刷新即丢失
      faviconService: { ...localSettings.value.faviconService },
      useForeignFavicon: localSettings.value.useForeignFavicon
    }

    const savedSettings = await window.electronAPI.updateSettings(settingsToSave)
    settings.value = savedSettings

    if (showSuccess) {
      ElMessage.success(t('settings.saved'))
    }
    return true
  } catch (error) {
    ElMessage.error(t('message.settingsSaveFailed'))
    return false
  } finally {
    isSaving = false
  }
}

const handleAutoFetchChange = (_value: boolean) => {}

const handleLanguageChange = (value: string) => {
  applyLanguage(value)
}

const applyTheme = (theme: string, themeColor?: string) => {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)

  const color = themeColor || '#3B82F6'
  document.documentElement.style.setProperty('--theme-color', color)
  document.documentElement.style.setProperty('--el-color-primary', color)
  document.documentElement.style.setProperty('--el-color-primary-light-3', color + '40')
  document.documentElement.style.setProperty('--el-color-primary-light-5', color + '60')
  document.documentElement.style.setProperty('--el-color-primary-light-7', color + '80')
  document.documentElement.style.setProperty('--el-color-primary-light-8', color + 'A0')
  document.documentElement.style.setProperty('--el-color-primary-light-9', color + 'C0')
  document.documentElement.style.setProperty('--el-color-primary-dark-2', color + 'D0')

  // 与 stores/ui.ts 的 applyTheme 保持一致：自定义主题色要驱动 --lc-* 变量层
  document.documentElement.style.setProperty('--lc-accent', color)
  document.documentElement.style.setProperty(
    '--lc-accent-hover',
    `color-mix(in srgb, ${color} 85%, #000)`
  )
  document.documentElement.style.setProperty(
    '--lc-accent-soft',
    `color-mix(in srgb, ${color} 12%, transparent)`
  )

  const lightColor = color + '20'
  document.documentElement.style.setProperty('--theme-color-light', lightColor)
}

const applyLanguage = async (language: string) => {
  document.documentElement.lang = language
  localStorage.setItem('app-language', language)
  const { setLanguage } = await import('../../i18n')
  setLanguage(language as 'en' | 'zh')
}

const resetToDefaults = async () => {
  // 先把默认值写进 localSettings，再走本页的 saveSettings()：
  // 后者序列化的是 localSettings（而非 store 里尚未更新的旧值），因此落盘与面板一致。
  localSettings.value = { ...defaultSettings, availableBrowsers: [] }
  defaultBrowserName.value = ''
  defaultBrowserPath.value = ''

  const saved = await saveSettings(false)
  if (!saved) return

  applyTheme(localSettings.value.theme, localSettings.value.themeColor)
  await applyLanguage(localSettings.value.language)
  ElMessage.success(t('settings.resetSuccess'))
}

const handleCheckLinks = async () => {
  if (checkingLinks.value) return

  checkingLinks.value = true
  try {
    // 不传 ids = 检查全部书签；max(4) 并发与 8s 超时都在主进程侧
    linkCheckResult.value = await bookmarkStore.checkLinks()
    linkCheckVisible.value = true
  } catch (error) {
    // store 已经提示过 message.linkCheckFailed，这里只保留日志
    console.error(error)
  } finally {
    checkingLinks.value = false
  }
}

const clearAllData = async () => {
  try {
    await ElMessageBox.confirm(t('dialog.confirmClearAll'), t('dialog.deleteWarning'), {
      confirmButtonText: t('settings.clearAll'),
      cancelButtonText: t('common.cancel'),
      type: 'warning',
      confirmButtonClass: 'el-button--danger'
    })

    await bookmarkStore.clearAllBookmarks()
    await folderStore.clearAllFolders()
    await tagStore.clearAllTags()
    ElMessage.success(t('settings.clearSuccess'))
  } catch (error) {
    if (error !== 'cancel') {
      ElMessage.error(t('settings.clearFailed'))
    }
  }
}

onMounted(async () => {
  await fetchSettings()

  if (settings.value) {
    localSettings.value = {
      ...settings.value,
      availableBrowsers: settings.value.availableBrowsers
        ? [...settings.value.availableBrowsers]
        : []
    }

    if (typeof settings.value.defaultBrowser === 'string') {
      defaultBrowserName.value = ''
      defaultBrowserPath.value = settings.value.defaultBrowser
    } else if (settings.value.defaultBrowser && typeof settings.value.defaultBrowser === 'object') {
      defaultBrowserName.value = settings.value.defaultBrowser.name || ''
      defaultBrowserPath.value = settings.value.defaultBrowser.path || ''
    }

    applyTheme(settings.value.theme, settings.value.themeColor)
    applyLanguage(settings.value.language || 'en')
  } else {
    localSettings.value = {
      ...defaultSettings,
      availableBrowsers: []
    }
    applyTheme('light', '#3B82F6')
    applyLanguage('en')
  }
})
</script>

<style scoped>
.settings-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.settings-title {
  font-size: var(--lc-font-2xl);
  font-weight: var(--lc-weight-semibold);
  color: var(--lc-text-primary);
  line-height: var(--lc-leading-tight);
  margin: 0 0 var(--lc-space-6);
}

.settings-sections {
  display: flex;
  flex-direction: column;
  gap: var(--lc-space-6);
  margin-bottom: var(--lc-space-8);
}

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

/* 左侧 label 列宽用固定标尺（--lc-form-label-width 由 ui-tokens 提供，未落位时兜底 140px），
   右侧控件列按内容自适应并统一右对齐，保证各行控件右边缘与左边缘一致 */
.settings-item {
  display: grid;
  grid-template-columns: minmax(var(--lc-form-label-width, 140px), 1fr) max-content;
  align-items: center;
  gap: var(--lc-space-6);
  min-height: 48px;
  padding: var(--lc-space-4) 0;
  border-bottom: 1px solid var(--lc-border-subtle);
}

.settings-item:last-child {
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

.browser-select {
  width: 180px;
  flex-shrink: 0;
}

/* 控件列：默认浏览器与可用浏览器两组输入共用同一宽度，左边缘因此对齐 */
.control-column {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  flex-shrink: 0;
  width: 400px;
  max-width: 100%;
}

.browser-list {
  flex-direction: column;
  align-items: stretch;
}

.browser-item {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
}

.browser-inputs {
  display: flex;
  align-items: center;
  gap: var(--lc-space-2);
  flex: 1;
  min-width: 0;
}

.browser-remove {
  flex-shrink: 0;
  width: var(--lc-control-lg);
  height: var(--lc-control-lg);
  padding: 0;
}

.settings-view :deep(.el-input__wrapper),
.settings-view :deep(.el-select__wrapper) {
  min-height: var(--lc-control-lg);
}

.settings-view :deep(.el-radio-button__inner) {
  display: inline-flex;
  align-items: center;
  height: var(--lc-control-lg);
}

.settings-footer {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: var(--lc-space-3);
  padding: var(--lc-space-4) 0;
  background-color: var(--lc-bg-surface);
  border-top: 1px solid var(--lc-border-subtle);
}

.settings-footer .el-button {
  height: var(--lc-control-lg);
}

/* EP 默认给相邻按钮加 margin-left，这里统一由 gap 表达 */
.settings-footer .el-button + .el-button {
  margin-left: 0;
}

.theme-color-options {
  display: flex;
  align-items: center;
  gap: 16px;
}

.theme-color-presets {
  display: flex;
  gap: 8px;
}

.theme-color-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.2s;
}

.theme-color-dot:hover {
  transform: scale(1.1);
}

.theme-color-dot.active {
  border-color: var(--el-text-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-5);
}

@media (max-width: 600px) {
  .settings-item {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--lc-space-3);
  }

  .control-column {
    width: 100%;
  }

  .settings-footer {
    flex-direction: column;
  }

  .settings-footer .el-button {
    width: 100%;
  }
}
</style>
