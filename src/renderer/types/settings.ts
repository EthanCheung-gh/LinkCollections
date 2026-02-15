export interface Browser {
  name: string
  path: string
  icon: string
}

export interface FaviconService {
  domestic: string
  foreign: string
}

export interface Settings {
  defaultBrowser: string | Browser
  availableBrowsers: Browser[]
  viewMode: 'card' | 'list'
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
  autoFetchIcon: boolean
  language: 'en' | 'zh'
  faviconService: FaviconService
  useForeignFavicon: boolean
}
