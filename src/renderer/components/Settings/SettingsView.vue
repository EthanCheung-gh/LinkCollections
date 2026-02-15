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
            :placeholder="t('settings.language')"
            style="width: 180px"
            @change="handleLanguageChange"
          >
            <el-option :label="t('settings.languageEn')" value="en" />
            <el-option :label="t('settings.languageZh')" value="zh" />
          </el-select>
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
          <div class="browser-inputs" style="width: 400px">
            <el-input
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
          <div class="browser-list">
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
              <el-button text type="danger" @click="removeBrowser(index)">
                <i class="i-heroicons-x-mark" />
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
      <el-button type="primary" @click="saveSettings">
        {{ t('common.save') }}
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onActivated } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useUIStore, useBookmarkStore, useFolderStore, useTagStore } from '../../stores'
import type { Settings } from '../../types'
import ImportExport from './ImportExport.vue'
import { DEFAULT_FAVICON_SERVICES } from '../../utils/favicon'

const { t } = useI18n()
const uiStore = useUIStore()
const bookmarkStore = useBookmarkStore()
const folderStore = useFolderStore()
const tagStore = useTagStore()
const { settings } = storeToRefs(uiStore)
const { fetchSettings, saveSettings: saveSettingsToStore } = uiStore

const localSettings = ref<Settings>({
  defaultBrowser: '',
  availableBrowsers: [],
  viewMode: 'card',
  sidebarCollapsed: false,
  theme: 'light',
  autoFetchIcon: true,
  language: 'en',
  faviconService: DEFAULT_FAVICON_SERVICES,
  useForeignFavicon: false
})

const defaultBrowserName = ref('')
const defaultBrowserPath = ref('')

const defaultSettings: Settings = {
  defaultBrowser: '',
  availableBrowsers: [],
  viewMode: 'card',
  sidebarCollapsed: false,
  theme: 'light',
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
  applyTheme(value)
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

const saveSettings = async () => {
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
      autoFetchIcon: localSettings.value.autoFetchIcon,
      language: localSettings.value.language
    }

    const savedSettings = await window.electronAPI.updateSettings(settingsToSave)
    settings.value = savedSettings

    ElMessage.success(t('settings.saved'))
  } catch (error) {
    ElMessage.error(t('message.settingsSaveFailed'))
  } finally {
    isSaving = false
  }
}

const handleAutoFetchChange = (_value: boolean) => {}

const handleLanguageChange = (value: string) => {
  applyLanguage(value)
}

const applyTheme = (theme: string) => {
  document.documentElement.classList.remove('light', 'dark')
  document.documentElement.classList.add(theme)
}

const applyLanguage = async (language: string) => {
  document.documentElement.lang = language
  localStorage.setItem('app-language', language)
  const { setLanguage } = await import('../../i18n')
  setLanguage(language as 'en' | 'zh')
}

const resetToDefaults = async () => {
  try {
    localSettings.value = { ...defaultSettings }
    await saveSettingsToStore()
    applyTheme('light')
    ElMessage.success(t('settings.resetSuccess'))
  } catch (error) {
    ElMessage.error(t('message.settingsSaveFailed'))
    console.error(error)
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

    applyTheme(settings.value.theme)
    applyLanguage(settings.value.language || 'en')
  } else {
    localSettings.value = {
      ...defaultSettings,
      availableBrowsers: []
    }
    applyTheme('light')
    applyLanguage('en')
  }
})

onActivated(() => {
  if (settings.value) {
    applyTheme(settings.value.theme)
    applyLanguage(settings.value.language || 'en')
  }
})
</script>

<style scoped>
.settings-view {
  flex: 1;
  overflow-y: auto;
}

.settings-title {
  font-size: 28px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 24px 0;
}

.settings-sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 32px;
}

.settings-section {
  background-color: #ffffff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin: 0 0 20px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color);
}

.section-title i {
  font-size: 20px;
  color: var(--el-color-primary);
}

.settings-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
}

.settings-item-content {
  flex: 1;
}

.settings-item-label {
  font-weight: 500;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.settings-item-description {
  font-size: 14px;
  color: var(--el-text-color-secondary);
}

.browser-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 400px;
}

.browser-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.browser-inputs {
  display: flex;
  gap: 8px;
  flex: 1;
}

.settings-footer {
  position: sticky;
  bottom: 0;
  background-color: #ffffff;
  padding: 16px 0;
  border-top: 1px solid var(--el-border-color);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

@media (max-width: 600px) {
  .settings-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .settings-footer {
    flex-direction: column;
  }

  .settings-footer .el-button {
    width: 100%;
  }
}
</style>
