import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Settings } from '../types'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import { setLanguage } from '../i18n'
import { DEFAULT_FAVICON_SERVICES } from '../utils/favicon'

/**
 * 与主进程 DEFAULT_SETTINGS（electron/ipc/settings.ts）保持一致的默认值，
 * 额外包含渲染层独有、主进程按部分合并保存的 `language` 字段，
 * 以及 v1.1.0 新增的主题色 / favicon 服务配置。
 */
const DEFAULT_SETTINGS: Settings = {
  theme: 'light',
  themeColor: '#3B82F6',
  useCustomThemeColor: false,
  language: 'en',
  viewMode: 'card',
  sidebarCollapsed: false,
  autoFetchIcon: true,
  availableBrowsers: [],
  defaultBrowser: '',
  faviconService: { ...DEFAULT_FAVICON_SERVICES },
  useForeignFavicon: false,
  autoUpdate: true
}

/** 每次返回全新对象/数组，避免多个 store 调用方共享同一份可变引用。 */
const createDefaultSettings = (): Settings => ({
  ...DEFAULT_SETTINGS,
  availableBrowsers: []
})

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

    // 自定义主题色必须同时驱动设计变量层（--lc-*），
    // 否则顶栏主按钮、选中态、focus ring 等使用 --lc-accent 的组件不会跟随换色。
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
        applyTheme(settings.value.theme, settings.value.themeColor)
        applyLanguage(settings.value.language || 'en')
      }
    } catch (error) {
      ElMessage.error(t('message.settingsLoadFailed'))
      console.error(error)
      // 读取失败时在内存里初始化为默认值，避免后续 toggleSidebar/setViewMode
      // 因 settings 为 null 而静默不持久化（审计 C3）。
      settings.value = createDefaultSettings()
    }
  }

  const saveSettings = async (showError = true) => {
    if (!settings.value) return
    try {
      const settingsData = {
        defaultBrowser: settings.value.defaultBrowser ?? '',
        availableBrowsers: settings.value.availableBrowsers
          ? [...settings.value.availableBrowsers]
          : [],
        viewMode: settings.value.viewMode || 'card',
        sidebarCollapsed: settings.value.sidebarCollapsed ?? false,
        theme: settings.value.theme || 'light',
        themeColor: settings.value.themeColor || '#3B82F6',
        useCustomThemeColor: settings.value.useCustomThemeColor ?? false,
        autoFetchIcon: settings.value.autoFetchIcon ?? true,
        language: settings.value.language || 'en',
        faviconService: settings.value.faviconService || DEFAULT_FAVICON_SERVICES,
        useForeignFavicon: settings.value.useForeignFavicon ?? false,
        // 缺省视为开启（与主进程 DEFAULT_SETTINGS 一致）：老 settings.json 里没有这个字段
        autoUpdate: settings.value.autoUpdate ?? true
      }
      settings.value = await window.electronAPI.updateSettings(settingsData)
      applyTheme(settings.value.theme, settings.value.themeColor)
    } catch (error) {
      if (showError) {
        ElMessage.error(t('message.settingsSaveFailed'))
      }
      console.error(error)
      throw error
    }
  }

  /**
   * 把设置重置为主进程默认值并落盘。
   *
   * 与 `saveSettings`（"序列化当前 store 值"）不同，本 action 能表达"写入指定默认值"，
   * 供 Settings 页的 Reset to Defaults 使用（审计 B5）。
   * 失败时 console.error 后 rethrow，由调用方决定提示文案，避免与调用方的错误 toast 重复。
   */
  const resetSettings = async (): Promise<Settings> => {
    const previous = settings.value
    try {
      const defaults = createDefaultSettings()
      // 直接传 store 里的响应式代理会有结构化克隆风险，这里显式展开成普通对象
      const settingsData: Partial<Settings> = {
        defaultBrowser: defaults.defaultBrowser,
        availableBrowsers: [...defaults.availableBrowsers],
        viewMode: defaults.viewMode,
        sidebarCollapsed: defaults.sidebarCollapsed,
        theme: defaults.theme,
        themeColor: defaults.themeColor,
        useCustomThemeColor: defaults.useCustomThemeColor,
        autoFetchIcon: defaults.autoFetchIcon,
        language: defaults.language,
        faviconService: { ...defaults.faviconService },
        useForeignFavicon: defaults.useForeignFavicon,
        autoUpdate: defaults.autoUpdate
      }

      settings.value = defaults
      // 落盘，并把主进程返回的结果赋回 settings.value
      const savedSettings = (await window.electronAPI.updateSettings(settingsData)) || defaults
      settings.value = savedSettings

      // 同步 UI 侧的镜像状态，避免界面仍显示重置前的视图模式/侧栏状态
      viewMode.value = savedSettings.viewMode
      sidebarCollapsed.value = savedSettings.sidebarCollapsed

      applyTheme(savedSettings.theme, savedSettings.themeColor)
      applyLanguage(savedSettings.language || 'en')

      return savedSettings
    } catch (error) {
      // 落盘失败时回滚内存状态，避免"界面显示默认值但磁盘仍是旧值"的不一致
      settings.value = previous
      console.error('Failed to reset settings:', error)
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
    saveSettings,
    resetSettings
  }
})
