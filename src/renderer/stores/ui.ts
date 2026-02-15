import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Settings } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { setLanguage } from '../i18n'
import { DEFAULT_FAVICON_SERVICES } from '../utils/favicon'

export const useUIStore = defineStore('ui', () => {
  const { t } = useI18n()
  const sidebarCollapsed = ref(false)
  const viewMode = ref<'card' | 'list'>('card')
  const currentView = ref<'bookmarks' | 'stats' | 'settings'>('bookmarks')
  const settings = ref<Settings | null>(null)

  const toggleSidebar = () => {
    sidebarCollapsed.value = !sidebarCollapsed.value
    if (settings.value) {
      settings.value.sidebarCollapsed = sidebarCollapsed.value
      saveSettings(false).catch(error => {
        console.warn('Failed to save sidebar state:', error)
      })
    }
  }

  const setCurrentView = (view: 'bookmarks' | 'stats' | 'settings') => {
    currentView.value = view
  }

  const setViewMode = (mode: 'card' | 'list') => {
    viewMode.value = mode
    if (settings.value) {
      settings.value.viewMode = mode
      saveSettings(false).catch(error => {
        console.warn('Failed to save view mode:', error)
      })
    }
  }

  const applyTheme = (theme: string) => {
    document.documentElement.classList.remove('light', 'dark')
    document.documentElement.classList.add(theme)
  }

  const applyLanguage = (language: string) => {
    document.documentElement.lang = language
    setLanguage(language as 'en' | 'zh')
  }

  const fetchSettings = async () => {
    try {
      settings.value = await window.electronAPI.getSettings()
      if (settings.value) {
        viewMode.value = settings.value.viewMode
        sidebarCollapsed.value = settings.value.sidebarCollapsed
        applyTheme(settings.value.theme)
        applyLanguage(settings.value.language || 'en')
      }
    } catch (error) {
      ElMessage.error(t('message.settingsLoadFailed'))
      console.error(error)
    }
  }

  const saveSettings = async (showError = true) => {
    if (!settings.value) return
    try {
      const defaultBrowser = settings.value.defaultBrowser || ''
      const defaultBrowserData =
        typeof defaultBrowser === 'string' ? defaultBrowser : defaultBrowser

      const settingsData = {
        defaultBrowser: defaultBrowserData,
        availableBrowsers: settings.value.availableBrowsers
          ? [...settings.value.availableBrowsers]
          : [],
        viewMode: settings.value.viewMode || 'card',
        sidebarCollapsed: settings.value.sidebarCollapsed ?? false,
        theme: settings.value.theme || 'light',
        autoFetchIcon: settings.value.autoFetchIcon ?? true,
        language: settings.value.language || 'en',
        faviconService: settings.value.faviconService || DEFAULT_FAVICON_SERVICES,
        useForeignFavicon: settings.value.useForeignFavicon ?? false
      }
      settings.value = await window.electronAPI.updateSettings(settingsData)
      applyTheme(settings.value.theme)
    } catch (error) {
      if (showError) {
        ElMessage.error(t('message.settingsSaveFailed'))
      }
      console.error(error)
      throw error
    }
  }

  return {
    sidebarCollapsed,
    viewMode,
    currentView,
    settings,
    toggleSidebar,
    setCurrentView,
    setViewMode,
    fetchSettings,
    saveSettings
  }
})
