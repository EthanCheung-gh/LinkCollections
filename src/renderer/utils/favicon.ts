import type { FaviconService } from '../types/settings'

export const DEFAULT_FAVICON_SERVICES: FaviconService = {
  domestic: 'https://api.iow.cn.cn/getfavicon/',
  foreign: 'https://www.google.com/s2/favicons'
}

export const FAVICON_SERVICE_OPTIONS = [
  { label: 'iow.cn', value: 'https://api.iow.cn.cn/getfavicon/', type: 'domestic' },
  { label: '比特流', value: 'https://api.xingzhige.com/favicon/', type: 'domestic' },
  { label: 'Google', value: 'https://www.google.com/s2/favicons', type: 'foreign' }
]

export const getFaviconUrl = (
  url: string,
  faviconService?: FaviconService,
  useForeignFavicon?: boolean
): string => {
  try {
    let urlStr = url
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      urlStr = 'https://' + urlStr
    }

    const urlObj = new URL(urlStr)
    const domain = urlObj.hostname

    const services = faviconService || DEFAULT_FAVICON_SERVICES
    const useForeign = useForeignFavicon ?? false

    const baseUrl = useForeign ? services.foreign : services.domestic
    const faviconUrl = `${baseUrl}domain=${domain}&sz=64`

    return faviconUrl
  } catch (error) {
    console.error('Invalid URL for favicon:', url, error)
    return ''
  }
}

export const getFaviconUrlWithService = (url: string, serviceUrl: string): string => {
  try {
    let urlStr = url
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      urlStr = 'https://' + urlStr
    }

    const urlObj = new URL(urlStr)
    const domain = urlObj.hostname

    const isGoogle = serviceUrl.includes('google.com')
    if (isGoogle) {
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    }

    return `${serviceUrl}${domain}`
  } catch (error) {
    console.error('Invalid URL for favicon:', url, error)
    return ''
  }
}

export const shouldFetchFavicon = (url: string): boolean => {
  try {
    let urlStr = url
    if (!urlStr.startsWith('http://') && !urlStr.startsWith('https://')) {
      urlStr = 'https://' + urlStr
    }
    new URL(urlStr)
    return true
  } catch (error) {
    return false
  }
}
