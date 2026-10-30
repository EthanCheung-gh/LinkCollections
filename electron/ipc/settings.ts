import { ipcMain, shell } from 'electron'
import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'
import { readJsonFile, writeJsonFile } from '../utils/storage'

interface Browser {
  name: string
  path: string
  icon: string
}

interface Settings {
  // 渲染层（SettingsView / ui store）既可能写字符串路径，也可能写 Browser 对象，
  // 这里按真实落盘形状声明，避免读取时把对象当成字符串用。
  defaultBrowser: string | Browser
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
  /** 是否在后台自动检查更新（关闭后仍可用设置页的「检查更新」手动检查） */
  autoUpdate: boolean
}

interface OpenBrowserResult {
  success: boolean
  error?: string
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
  useForeignFavicon: false,
  autoUpdate: true
}

// 只允许把 http(s) 链接交给浏览器/系统外壳
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * 读取设置时把缺省字段补齐。
 *
 * 旧版本的 `settings.json` 里没有 `autoUpdate` / `themeColor` / `faviconService`
 * 这些后加的字段，直接原样返回会让渲染层拿到 `undefined`：
 * 例如更新开关会显示成「关闭」，而 `isAutoUpdateEnabled()` 却按 `!== false` 判成「开启」，
 * 界面与实际行为不一致。这里用 `DEFAULT_SETTINGS` 兜底，保证字段总是存在。
 */
function getSettings(): Settings {
  const stored = readJsonFile<Partial<Settings>>(SETTINGS_FILE, DEFAULT_SETTINGS)
  return { ...DEFAULT_SETTINGS, ...stored }
}

function saveSettings(settings: Settings): boolean {
  return writeJsonFile(SETTINGS_FILE, settings)
}

/**
 * 供主进程其它模块（`electron/updater.ts` 的后台检查闸门）读取「自动更新」开关。
 *
 * 为什么导出这个 getter 而不是让 `main.ts` 自己 `readJsonFile('settings.json', …)`：
 * - 文件名/默认值只在这一处定义，避免两处硬编码 `'settings.json'` 漂移；
 * - 不导出整个 `Settings`（渲染层可以写任意字段，主进程只需要一个布尔判断）；
 * - 也不会产生循环依赖（本文件不 import main.ts / updater.ts）。
 *
 * `readJsonFile` 对缺失字段**不做**默认值补全，因此这里用 `!== false`：
 * 老版本 `settings.json` 里没有 `autoUpdate` 时按默认值 `true` 处理。
 */
export function isAutoUpdateEnabled(): boolean {
  return getSettings().autoUpdate !== false
}

/** 仅接受可被 `new URL()` 解析且协议为 http/https 的地址 */
function parseHttpUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string') return null

  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? parsed : null
}

function normalizeBrowserPath(value: unknown): string {
  if (typeof value !== 'string') return ''

  let normalized = value.trim()
  const first = normalized.charAt(0)
  const last = normalized.charAt(normalized.length - 1)
  if (normalized.length > 1 && ((first === '"' && last === '"') || (first === "'" && last === "'"))) {
    normalized = normalized.slice(1, -1).trim()
  }

  return normalized
}

/** 用于白名单比较的归一化键：Windows 路径大小写不敏感 */
function toPathKey(browserPath: string): string {
  const resolved = path.resolve(browserPath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * 允许启动的浏览器集合 = 默认浏览器路径 ∪ 设置为「可用浏览器」的路径。
 * 两者都是用户在本机设置页显式配置的可执行文件；空集合时退回系统默认浏览器。
 */
function getBrowserAllowlist(settings: Settings): Set<string> {
  const candidates: unknown[] = []

  const { defaultBrowser, availableBrowsers } = settings
  if (typeof defaultBrowser === 'string') {
    candidates.push(defaultBrowser)
  } else if (defaultBrowser && typeof defaultBrowser === 'object') {
    candidates.push((defaultBrowser as Browser).path)
  }

  if (Array.isArray(availableBrowsers)) {
    for (const browser of availableBrowsers) {
      candidates.push(browser && typeof browser === 'object' ? (browser as Browser).path : browser)
    }
  }

  const allowlist = new Set<string>()
  for (const candidate of candidates) {
    const normalized = normalizeBrowserPath(candidate)
    if (normalized) {
      allowlist.add(toPathKey(normalized))
    }
  }
  return allowlist
}

/** 可执行文件校验：绝对路径 + 存在 + 是文件 +（非 Windows）可执行 */
function validateExecutable(executablePath: string): string | null {
  if (!path.isAbsolute(executablePath)) {
    return 'Browser path must be an absolute path'
  }

  let stats: fs.Stats
  try {
    stats = fs.statSync(executablePath)
  } catch {
    return 'Browser executable does not exist'
  }

  if (!stats.isFile()) {
    return 'Browser path does not point to a file'
  }

  if (process.platform !== 'win32') {
    try {
      fs.accessSync(executablePath, fs.constants.X_OK)
    } catch {
      return 'Browser path is not executable'
    }
  }

  return null
}

/**
 * 启动浏览器进程。spawn 的 `error` 事件必须被监听：
 * 未监听时 `ENOENT` 等错误会变成主进程未捕获异常（Electron 会弹主进程崩溃对话框）。
 */
function spawnDetached(executablePath: string, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(executablePath, [url], { detached: true, stdio: 'ignore' })
    } catch (error) {
      reject(error)
      return
    }

    let settled = false

    // 常驻监听：spawn 之后再出现的 error 也不会变成未捕获异常
    child.on('error', error => {
      if (!settled) {
        settled = true
        reject(error)
        return
      }
      console.error('[open-browser] Child process error after launch:', error)
    })

    child.once('spawn', () => {
      if (settled) return
      settled = true
      // 与主进程彻底解耦：应用退出时不再等待浏览器进程
      child.unref()
      resolve()
    })
  })
}

async function openWithSystemBrowser(url: string): Promise<OpenBrowserResult> {
  try {
    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    console.error('[open-browser] Failed to open URL with the system browser:', error)
    return { success: false, error: 'Failed to open URL with the system default browser' }
  }
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

  ipcMain.handle(
    'open-browser',
    async (_, url: string, browserPath?: string): Promise<OpenBrowserResult> => {
      // ① 协议白名单：渲染进程/导入数据都不可信，file:/javascript:/ms-*/smb: 一律拒绝
      const parsedUrl = parseHttpUrl(url)
      if (!parsedUrl) {
        console.error('[open-browser] Rejected URL with unsupported protocol:', url)
        return { success: false, error: 'Only http(s) URLs can be opened' }
      }

      // ② 没有指定浏览器 → 交给系统默认浏览器
      const requestedPath = normalizeBrowserPath(browserPath)
      if (!requestedPath) {
        return openWithSystemBrowser(parsedUrl.href)
      }

      // ③ 指定了浏览器 → 必须出现在设置里的浏览器清单中，且是真实存在可执行文件
      const settings = getSettings()
      if (!getBrowserAllowlist(settings).has(toPathKey(requestedPath))) {
        console.error('[open-browser] Rejected browser path that is not configured:', requestedPath)
        return {
          success: false,
          error: 'Browser path is not in the list of configured browsers'
        }
      }

      const executableError = validateExecutable(requestedPath)
      if (executableError) {
        console.error(`[open-browser] Invalid browser path "${requestedPath}": ${executableError}`)
        return { success: false, error: executableError }
      }

      // ④ 启动失败不再抛未捕获异常，也不会误报成功
      try {
        await spawnDetached(path.resolve(requestedPath), parsedUrl.href)
        return { success: true }
      } catch (error) {
        console.error('[open-browser] Failed to launch browser:', error)
        return {
          success: false,
          error: `Failed to launch browser: ${error instanceof Error ? error.message : String(error)}`
        }
      }
    }
  )
}
