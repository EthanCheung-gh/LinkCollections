import type { FaviconService } from '../types/settings'

export const DEFAULT_FAVICON_SERVICES: FaviconService = {
  domestic: 'direct',
  foreign: 'https://www.google.com/s2/favicons'
}

export const FAVICON_SERVICE_OPTIONS = [
  { label: '自动获取', value: 'direct', type: 'domestic' },
  { label: 'Google', value: 'https://www.google.com/s2/favicons', type: 'foreign' }
]

const SPECIAL_TLDS = ['co.uk', 'com.cn', 'com.au', 'co.jp', 'org.uk', 'org.cn', 'net.cn']

export const getRootDomain = (hostname: string): string => {
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname

  const lastTwo = parts.slice(-2).join('.')
  if (SPECIAL_TLDS.includes(lastTwo)) {
    return parts.slice(-3).join('.')
  }

  return parts.slice(-2).join('.')
}

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
    const rootDomain = getRootDomain(domain)

    const services = faviconService || DEFAULT_FAVICON_SERVICES
    const useForeign = useForeignFavicon ?? false

    const baseUrl = useForeign ? services.foreign : services.domestic

    if (baseUrl === 'direct') {
      return `${urlObj.origin}/favicon.ico`
    }

    const isGoogle = baseUrl.includes('google.com')
    const faviconUrl = isGoogle ? `${baseUrl}domain=${rootDomain}&sz=64` : `${baseUrl}${rootDomain}`

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
    const rootDomain = getRootDomain(domain)

    if (serviceUrl === 'direct') {
      return `${urlObj.origin}/favicon.ico`
    }

    const isGoogle = serviceUrl.includes('google.com')
    if (isGoogle) {
      return `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=64`
    }

    return `${serviceUrl}${rootDomain}`
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
