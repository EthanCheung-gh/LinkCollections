import { ipcMain, shell } from 'electron'
import { readJsonFile, writeJsonFile } from '../utils/storage'

interface Browser {
  name: string
  path: string
  icon: string
}

interface Settings {
  defaultBrowser: string
  availableBrowsers: Browser[]
  viewMode: 'card' | 'list'
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  themeColor: string
  useCustomThemeColor: boolean
  autoFetchIcon: boolean
  language: 'en' | 'zh'
  faviconService: {
    domestic: string
    foreign: string
  }
  useForeignFavicon: boolean
}

const SETTINGS_FILE = 'settings.json'

const DEFAULT_SETTINGS: Settings = {
  defaultBrowser: '',
  availableBrowsers: [],
  viewMode: 'card',
  sidebarCollapsed: false,
  theme: 'light',
  themeColor: '#3B82F6',
  useCustomThemeColor: false,
  autoFetchIcon: true,
  language: 'en',
  faviconService: {
    domestic: 'direct',
    foreign: 'https://www.google.com/s2/favicons'
  },
  useForeignFavicon: false
}

function getSettings(): Settings {
  return readJsonFile<Settings>(SETTINGS_FILE, DEFAULT_SETTINGS)
}

function saveSettings(settings: Settings): boolean {
  return writeJsonFile(SETTINGS_FILE, settings)
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('get-settings', () => {
    return getSettings()
  })

  ipcMain.handle('update-settings', (_, updates: Partial<Settings>) => {
    const settings = getSettings()
    const updated = { ...settings, ...updates }

    if (saveSettings(updated)) {
      return updated
    }
    throw new Error('Failed to save settings')
  })

  ipcMain.handle('open-browser', async (_, url: string, browserPath?: string) => {
    if (browserPath) {
      const { spawn } = await import('child_process')
      spawn(browserPath, [url], { detached: true })
    } else {
      await shell.openExternal(url)
    }
  })
}
