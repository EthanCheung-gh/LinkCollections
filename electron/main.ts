import { app, BrowserWindow, session, shell } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerBookmarkHandlers } from './ipc/bookmarks'
import { registerFolderHandlers } from './ipc/folders'
import { registerTagHandlers } from './ipc/tags'
import { registerSettingsHandlers } from './ipc/settings'
import { registerImportExportHandlers } from './ipc/import-export'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged

const DEV_SERVER_URL = 'http://localhost:5173'

// 只有 http(s) 链接允许交给系统外壳（渲染进程内容不可信，见 B9/A1）
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * CSP（C18）。
 *
 * - 生产：不允许任何内联/动态脚本（`script-src 'self'`，**无** `'unsafe-eval'`）。
 *   打包后的 `dist/index.html` 只有外链 module 脚本，Vue 运行时不需要 eval。
 *   `style-src` 必须保留 `'unsafe-inline'`：Element Plus 的弹层/表格样式是运行时注入的。
 * - 开发：保留 `'unsafe-eval'`（Vite/DevTools 工具链需要），并放开连接到 dev server。
 *
 * 注意：生产环境同时通过两处下发 ——
 *   1) 这里的 `onHeadersReceived`（对 http(s)/部分 file 请求生效）；
 *   2) 构建期注入到 index.html 的 `<meta http-equiv>`（见 electron.vite.config.ts），
 *      这是 file:// 加载时最可靠的载体。
 * 两处内容必须保持一致。
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  // img-src 需要 `https:`：favicon 服务支持「直连站点 /favicon.ico」与用户自定义服务地址
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self' https://www.google.com https://*.google.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'"
].join('; ')

/**
 * 注册一次即可：`createWindow` 会在 macOS 的 `activate` 事件里被重复调用，
 * 若把注册写进 `createWindow` 会导致回调层层叠加。
 */
function installContentSecurityPolicy(): void {
  const csp = isDevelopment ? DEV_CSP : PROD_CSP

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

if (isDevelopment) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true'
}

let mainWindow: BrowserWindow | null = null

/** 把外部 http(s) 链接交给系统默认浏览器；其它协议一律拒绝并记录 */
function openExternalUrl(rawUrl: string): void {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    console.warn('[security] Refusing to open unparsable URL:', rawUrl)
    return
  }

  if (!EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    console.warn('[security] Blocked attempt to open non-http(s) URL:', rawUrl)
    return
  }

  shell
    .openExternal(parsed.href)
    .catch(error => console.error('[security] Failed to open external URL:', error))
}

/**
 * 是否是应用自身的导航目标。
 * - dev：与 dev server 同源；
 * - 生产：`dist/` 下的 file:// 页面（限制在渲染产物目录内）。
 */
function isInternalNavigation(targetUrl: string): boolean {
  try {
    const parsed = new URL(targetUrl)

    if (isDevelopment) {
      return parsed.origin === new URL(DEV_SERVER_URL).origin
    }

    if (parsed.protocol !== 'file:') {
      return false
    }

    const rendererRoot = path.resolve(path.join(__dirname, '../dist'))
    const targetPath = path.resolve(fileURLToPath(parsed))
    const relative = path.relative(rendererRoot, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  } catch {
    return false
  }
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload', 'preload.js')
  console.log('Preload path:', preloadPath)
  console.log('Is development:', isDevelopment)
  console.log('__dirname:', __dirname)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#F9FAFB',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // C18：preload 产物是 CJS 且只 require('electron')（见 dist-electron/preload/preload.js），
      // 满足 sandbox 对 preload 的限制；开启后渲染进程运行在沙箱内。
      sandbox: true,
      webSecurity: true
    },
    titleBarStyle: 'default',
    minWidth: 1200,
    minHeight: 700,
    show: false
  })

  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      console.error('Failed to load:', errorCode, errorDescription, validatedURL)
    }
  )

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page loaded successfully')
  })

  mainWindow.webContents.on('console-message', (_event, _level, message, _line, _sourceId) => {
    console.log(`[Renderer Console] ${message}`)
  })

  // B10：渲染进程不允许再创建任何窗口（window.open / target=_blank）。
  // http(s) 外链交给系统默认浏览器，其余协议直接丢弃；返回值恒为 deny。
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  // 拦截渲染进程被导航到外部页面，避免把可信上下文（含 preload 暴露的 IPC）带出去
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url)) {
      return
    }

    event.preventDefault()
    openExternalUrl(url)
  })

  if (isDevelopment) {
    const devServerUrl = DEV_SERVER_URL

    mainWindow.webContents.openDevTools()

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    mainWindow.loadURL(devServerUrl)
  } else {
    const htmlPath = path.join(__dirname, '../dist/index.html')
    console.log('Loading HTML from:', htmlPath)

    // CSP 统一由 whenReady 里的 installContentSecurityPolicy() 注册（见文件头 PROD_CSP/DEV_CSP），
    // 这里不能再注册一次：webRequest 同一事件只保留最后一个监听器，
    // 否则会把生产策略覆盖成开发策略（含 'unsafe-eval'）。

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    mainWindow.loadFile(htmlPath).catch(error => {
      console.error('Failed to load HTML file:', error)
    })
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  // C18：CSP 必须在任何窗口加载内容之前注册，且只注册一次
  installContentSecurityPolicy()

  registerBookmarkHandlers()
  registerFolderHandlers()
  registerTagHandlers()
  registerSettingsHandlers()
  registerImportExportHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
