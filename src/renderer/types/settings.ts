export interface Browser {
  name: string
  path: string
  icon: string
}

export interface FaviconService {
  domestic: string
  foreign: string
}

export const THEME_COLORS = [
  { name: 'blue', value: '#3B82F6' },
  { name: 'green', value: '#10B981' },
  { name: 'purple', value: '#8B5CF6' },
  { name: 'red', value: '#EF4444' },
  { name: 'pink', value: '#EC4899' },
  { name: 'orange', value: '#F97316' },
  { name: 'cyan', value: '#06B6D4' }
]

export interface Settings {
  defaultBrowser: string | Browser
  availableBrowsers: Browser[]
  viewMode: 'card' | 'list'
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  themeColor: string
  useCustomThemeColor: boolean
  autoFetchIcon: boolean
  language: 'en' | 'zh'
  faviconService: FaviconService
  useForeignFavicon: boolean
  /** 后台自动检查更新（关闭后设置页的「检查更新」按钮仍可用） */
  autoUpdate: boolean
}
