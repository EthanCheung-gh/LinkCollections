import { app, BrowserWindow, globalShortcut, ipcMain, session, shell } from 'electron'
import type { Tray } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerBookmarkHandlers, purgeExpiredTrash, TRASH_RETENTION_DAYS } from './ipc/bookmarks'
import { registerHistoryHandlers } from './ipc/history'
import { registerFolderHandlers } from './ipc/folders'
import { registerTagHandlers } from './ipc/tags'
import { registerSettingsHandlers, isAutoUpdateEnabled } from './ipc/settings'
import { registerImportExportHandlers } from './ipc/import-export'
import { registerBrowserImportHandlers } from './ipc/browser-import'
import { registerLinkHandlers } from './ipc/links'
import { runDataMigrations } from './utils/schema'
import { createQuickAddController } from './quick-add'
import { createTray, QUICK_ADD_ACCELERATOR, SHOW_WINDOW_ACCELERATOR } from './tray'
import { createUpdater } from './updater'
import type { UpdateStatus, UpdateStatusSnapshot } from './updater'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged

const DEV_SERVER_URL = 'http://localhost:5173'

/**
 * preload 产物路径：主窗口与快速添加浮窗**共用同一份**（同一个 `window.electronAPI` 契约）。
 * 抽成常量是为了让两个 BrowserWindow 的 `preload` 不可能写歪成两份。
 */
const PRELOAD_PATH = path.join(__dirname, 'preload', 'preload.js')

/**
 * 生产环境渲染产物入口：主窗口用 `loadFile`、快速添加浮窗用 `loadFile(..., { search })`
 * 加载**同一个** `index.html`，靠查询串区分视图（见 `shared/view-route.ts`）。
 */
const INDEX_HTML_PATH = path.join(__dirname, '../dist/index.html')

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

/**
 * 托盘引用。
 *
 * `null` 同时表达两件事：**还没创建**、**创建失败**。两者对「关闭到托盘」的结论相同——
 * 没有托盘就没有唤回窗口的入口，关窗必须直接退出（否则用户点了关闭，应用变成幽灵进程）。
 */
let tray: Tray | null = null

/**
 * 是否正在退出应用。
 *
 * 置位路径（任一成立即允许窗口真正关闭而不再拦截）：
 * 1. 托盘菜单「退出 / Quit」→ 先 `isQuitting = true` 再 `app.quit()`；
 * 2. `before-quit` —— Cmd+Q、`app.quit()`、系统关机等**所有**退出路径都会先经过它。
 *
 * 未置位时主窗口的 `close` 会被拦截成 `hide()`（关闭到托盘）。
 * `will-quit` 只做资源释放（热键/浮窗/托盘），不再改这个标志。
 */
let isQuitting = false

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

/**
 * 给任意 BrowserWindow 装上「导航守卫 + 外部链接拦截」。
 *
 * 抽成函数是因为应用里有**两个**窗口（主窗口、快速添加浮窗），两者共享同一份安全基线：
 * 复制粘贴两份迟早会漏装其中一个，而漏装的那个就能被导航到外部页面并带着
 * preload 暴露的 IPC 上下文跑出去。
 */
function installNavigationGuards(window: BrowserWindow): void {
  // B10：渲染进程不允许再创建任何窗口（window.open / target=_blank）。
  // http(s) 外链交给系统默认浏览器，其余协议直接丢弃；返回值恒为 deny。
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url)
    return { action: 'deny' }
  })

  // 拦截渲染进程被导航到外部页面，避免把可信上下文（含 preload 暴露的 IPC）带出去
  window.webContents.on('will-navigate', (event, url) => {
    if (isInternalNavigation(url)) {
      return
    }

    event.preventDefault()
    openExternalUrl(url)
  })
}

/**
 * 快速添加浮窗控制器（模块级唯一实例）。
 *
 * 在这里构造是安全的：`createQuickAddController()` 只闭包持有一个 `null` 窗口引用，
 * 真正建窗发生在第一次 `toggle()`（托盘菜单「快速添加书签」或全局快捷键 Ctrl/Cmd+Shift+L）。
 * 放到 whenReady 里反而会让 IPC 注册与托盘回调都必须处理「controller 可能还不存在」。
 */
const quickAddController = createQuickAddController({
  preloadPath: PRELOAD_PATH,
  indexHtmlPath: INDEX_HTML_PATH,
  // 生产模式下为 null：浮窗用 `loadFile(htmlPath, { search })` 加载本地文件
  devServerUrl: isDevelopment ? DEV_SERVER_URL : null,
  installNavigationGuards
})

/**
 * 更新状态广播：`webContents.send('update-status', status)` 发给**所有**窗口。
 *
 * 不做「除发送者外」的排除：更新状态是纯主进程产生的事件，没有回环风险；
 * 两个窗口（主窗口、快速添加浮窗）都收到也不会互相触发写操作。
 * `isDestroyed()` 必须跳过：关闭中的窗口 `send` 会抛 "Object has been destroyed"。
 */
function broadcastUpdateStatus(status: UpdateStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send('update-status', status)
  }
}

/**
 * 自动更新控制器（模块级唯一实例）。
 *
 * 在这里构造是安全的：`createUpdater()` 只闭包持有状态与配置，真正的
 * 监听绑定/网络动作都发生在 `init()` / `check()`（见 `startApplication`）。
 * 与 `quickAddController` 同一模式，避免 IPC handler 还要处理「controller 可能不存在」。
 *
 * `isPackaged` 在模块加载时取值即可：打包与否在进程生命周期内不会变。
 */
const updater = createUpdater({
  isPackaged: app.isPackaged,
  getAutoUpdateEnabled: isAutoUpdateEnabled,
  broadcast: broadcastUpdateStatus
})

/** `get-update-status` 的返回：状态机快照 + 应用版本 + 是否支持自动更新 */
function buildUpdateSnapshot(): UpdateStatusSnapshot {
  return {
    ...updater.getStatus(),
    currentVersion: updater.getCurrentVersion(),
    enabled: app.isPackaged
  }
}

/**
 * 自动更新的 4 个 IPC 通道。
 *
 * 全部返回普通对象（`{ success, error }` 或状态快照），**不 throw**：
 * 更新失败是常态（仓库还没发布过 release、断网、签名缺失……），
 * 让渲染层为一个「预期内的失败」写 try/catch 只会诱使调用方忽略错误。
 *
 * 必须在窗口创建之前注册（与其它 IPC 一致）：渲染层一挂载就可能调用它们。
 */
function registerUpdaterHandlers(): void {
  ipcMain.handle('get-update-status', () => buildUpdateSnapshot())

  // 手动检查：`manual = true`，因此即使用户关闭了自动更新也允许（见 resolveCheckDecision）
  ipcMain.handle('check-for-updates', () => updater.check(true))

  ipcMain.handle('download-update', () => updater.download())

  ipcMain.handle('install-update', () => {
    // 先解除「关闭到托盘」的拦截：`quitAndInstall()` 内部走 `app.quit()`，
    // 若主窗口的 close 仍被拦成 `hide()`，退出流程会被挂住 → 安装永远不开始。
    const wasQuitting = isQuitting
    isQuitting = true

    const result = updater.install()
    if (!result.success) {
      isQuitting = wasQuitting
    }
    return result
  })
}

/** 显示并聚焦主窗口（必要时重建 / 从最小化恢复）。托盘「显示主窗口」与全局快捷键共用。 */
function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    // 主窗口被销毁过（macOS 关窗后 activate、或有托盘时被系统回收）：重建一个
    createWindow()
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

/** 切换主窗口显示/隐藏（Windows / Linux 托盘左键单击）。 */
function toggleMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.hide()
    return
  }
  showMainWindow()
}

/**
 * 显示主窗口并让它切到指定视图（托盘「统计 / 设置」）。
 *
 * 视图切换本身由渲染层完成（`uiStore.setCurrentView`），主进程只负责发事件：
 * 主进程不知道也不需要知道 UI 状态机，单向 `webContents.send` 即可。
 *
 * 窗口可能是刚重建的（渲染进程还没加载完），此时立刻 `send` 会丢事件，
 * 因此等 `did-finish-load` 再发（Vue 的 `onMounted` 订阅在模块脚本执行期内完成，早于该事件）。
 */
function openMainWindowView(view: 'stats' | 'settings'): void {
  showMainWindow()

  const win = mainWindow
  if (!win || win.isDestroyed()) return

  const contents = win.webContents
  if (contents.isLoading()) {
    contents.once('did-finish-load', () => {
      if (!win.isDestroyed()) contents.send('tray-open-view', view)
    })
    return
  }

  contents.send('tray-open-view', view)
}

function createWindow() {
  console.log('Preload path:', PRELOAD_PATH)
  console.log('Is development:', isDevelopment)
  console.log('__dirname:', __dirname)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#F9FAFB',
    webPreferences: {
      preload: PRELOAD_PATH,
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

  installNavigationGuards(mainWindow)

  if (isDevelopment) {
    const devServerUrl = DEV_SERVER_URL

    mainWindow.webContents.openDevTools()

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    mainWindow.loadURL(devServerUrl)
  } else {
    console.log('Loading HTML from:', INDEX_HTML_PATH)

    // CSP 统一由 whenReady 里的 installContentSecurityPolicy() 注册（见文件头 PROD_CSP/DEV_CSP），
    // 这里不能再注册一次：webRequest 同一事件只保留最后一个监听器，
    // 否则会把生产策略覆盖成开发策略（含 'unsafe-eval'）。

    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })

    mainWindow.loadFile(INDEX_HTML_PATH).catch(error => {
      console.error('Failed to load HTML file:', error)
    })
  }

  // 关闭到托盘：`isQuitting`（真退出）或「托盘创建失败」（没有唤回入口）时放行，其余改为隐藏。
  // 隐藏而非销毁，是为了保留渲染进程热态：再次唤回瞬时完成，也不需要重跑迁移/IPC 注册。
  mainWindow.on('close', event => {
    if (isQuitting || !tray) {
      return
    }

    event.preventDefault()
    mainWindow?.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 应用启动入口（拿到单实例锁之后才执行）。
 *
 * 顺序即依赖顺序：迁移 → CSP → IPC handlers → 窗口 / 托盘 → 全局快捷键 → 自动更新。
 * 抽成函数是为了让「第二个实例」能在**任何副作用发生之前**直接退出：
 * 顶层若散落着 `app.on` / `whenReady`，第二个实例会照样建窗、抢热键、打两遍迁移日志。
 */
function startApplication(): void {
  // 第二个实例启动后不再建窗，而是把已有实例的窗口顶到前面（用户以为「点了图标没反应」是最差体验）
  app.on('second-instance', () => {
    console.log('[single-instance] Second instance detected; focusing the existing window.')
    showMainWindow()
  })

  app.whenReady().then(() => {
    // C18：CSP 必须在任何窗口加载内容之前注册，且只注册一次
    installContentSecurityPolicy()

    // 数据迁移必须在注册 IPC 处理器之前完成：渲染层能读到数据之前，数据形状就得是新版本
    // （旧书签补 `pinned: false`），否则「缺失即未置顶」的语义会散落到渲染层的每个角落。
    // 失败不阻塞启动：用户仍应能把应用打开并导出/抢救数据；此时 meta 不会被写成新版本，
    // 下次启动会重试（迁移步骤本身幂等）。
    try {
      const { from, to, applied } = runDataMigrations()
      if (applied.length > 0) {
        console.log(`[schema] Migrated data schema v${from} → v${to}: ${applied.join(', ')}`)
      } else {
        console.log(`[schema] Data schema up to date (v${from})`)
      }
    } catch (error) {
      console.error('[schema] Data migration failed; continuing startup with existing data:', error)
    }

    // 回收站保留期清理：必须在**迁移之后**（v3 保证每条记录都有 `deletedAt`），
    // 且在**建窗之前**（界面第一次读到的数据就是干净的）。
    // 失败不阻塞启动：清理只是维护动作，下次启动会重试。
    try {
      const { purged } = purgeExpiredTrash()
      console.log(
        purged > 0
          ? `[trash] Purged ${purged} expired bookmark(s) (retention: ${TRASH_RETENTION_DAYS} days)`
          : '[trash] No expired bookmarks to purge'
      )
    } catch (error) {
      console.error('[trash] Failed to purge expired bookmarks; continuing startup:', error)
    }

    registerBookmarkHandlers()
    // 访问历史是统计页趋势图的数据源；必须在迁移之后注册（v2 保证 history.json 存在）
    registerHistoryHandlers()
    registerFolderHandlers()
    registerTagHandlers()
    registerSettingsHandlers()
    registerImportExportHandlers()
    // 浏览器书签直读：依赖 import-export 的共享导入核心（applyImportedData），
    // 放在它之后注册只是为了让「导入相关通道」在启动日志里保持相邻
    registerBrowserImportHandlers()
    // 死链检查：只读写 bookmarks.json，不依赖其它 IPC 通道，放在最后注册
    registerLinkHandlers()

    // 自动更新：同样在建窗之前注册（渲染层设置页挂载即可能调用 `get-update-status`）
    registerUpdaterHandlers()

    // 外壳（托盘 / 浮窗）专属的两个通道：注册顺序与其它 IPC 一致（窗口创建之前）——
    // 渲染层一挂载就可能调用它们，晚注册会得到 `No handler registered` 的 rejected Promise。
    //
    // `close-quick-add`：只隐藏不销毁（保持渲染进程热态，下次呼出无需重新加载），无返回值
    ipcMain.handle('close-quick-add', () => {
      quickAddController.hide()
    })

    // `notify-bookmarks-changed`：向**除发送者外**的所有窗口广播。
    // 排除发送者是关键：浮窗自己也会刷新书签列表的话，`addBookmark` 会把刚存的记录
    // push 进本地数组一次、广播回来再拉一次（重复渲染/闪烁）；主窗口才是需要刷新的那一方。
    ipcMain.handle('notify-bookmarks-changed', event => {
      const sender = event.sender
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.isDestroyed() || win.webContents === sender) continue
        win.webContents.send('bookmarks-changed')
      }
    })

    createWindow()

    // 托盘必须在主窗口之后创建：`showMainWindow` / `showStats` 等 handler 都依赖 `mainWindow` 已存在
    //（虽然 `showMainWindow()` 能兜底重建，但先建窗更直观且避免首次点击触发重建）。
    tray = createTray({
      showMainWindow,
      toggleMainWindow,
      toggleQuickAdd: () => quickAddController.toggle(),
      showStats: () => openMainWindowView('stats'),
      showSettings: () => openMainWindowView('settings'),
      quit: () => {
        // 必须先置位再 quit：`app.quit()` 是异步的，期间若主窗口收到 close 会被拦成 hide()，
        // 结果是「点了退出但应用还在托盘里」。
        isQuitting = true
        app.quit()
      }
    })

    if (!tray) {
      // `createTray()` 内部已 console.error 具体原因；这里补充**后果**：
      // 没有托盘 = 没有唤回窗口的入口，因此「关闭到托盘」必须整体关闭（见 createWindow 的 close 处理）。
      console.error(
        '[tray] Tray unavailable; close-to-tray is disabled and closing the main window will quit the app.'
      )
    }

    // 全局快捷键：注册失败（被其它应用占用 / Linux 无 X11 输入抓取权限）只警告，不阻塞启动。
    // 加速键常量与托盘菜单项共用同一份（electron/tray.ts），避免「菜单写着 X、按 X 没反应」。
    const shortcuts: Array<{ accelerator: string; handler: () => void; label: string }> = [
      {
        accelerator: QUICK_ADD_ACCELERATOR,
        handler: () => quickAddController.toggle(),
        label: 'toggle quick add'
      },
      { accelerator: SHOW_WINDOW_ACCELERATOR, handler: showMainWindow, label: 'show main window' }
    ]

    for (const { accelerator, handler, label } of shortcuts) {
      try {
        if (!globalShortcut.register(accelerator, handler)) {
          console.warn(
            `[shortcut] Failed to register ${accelerator} (${label}); it may be taken by another application.`
          )
        }
      } catch (error) {
        console.warn(`[shortcut] Failed to register ${accelerator} (${label}):`, error)
      }
    }

    // 自动更新放在启动流程的**最后**：
    // 1) `init()` 只是配置 + 绑定 updater 事件（不发网络请求、不阻塞），但没必要抢在
    //    迁移/建窗/托盘/快捷键之前；
    // 2) `scheduleStartupCheck()` 只是排一个 10 秒后 unref 的定时器，放在最后能保证
    //    「窗口已经能接收广播」之后再谈更新时间线。
    // 未打包 / 用户关闭自动更新时，这两步都是空操作（状态停在 disabled/idle）。
    updater.init()
    updater.scheduleStartupCheck()
  })

  app.on('window-all-closed', () => {
    // 有托盘时保持后台常驻：用户关掉的是「窗口」，不是应用，托盘菜单仍能唤回。
    // 无托盘时维持原有语义（macOS 上应用留在 Dock，其它平台退出）。
    if (tray) {
      return
    }

    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    // macOS 点 Dock 图标：主窗口可能已被销毁（`closed` 后置 null），`showMainWindow()` 会重建
    showMainWindow()
  })

  // 所有退出路径（Cmd+Q、托盘「退出」、系统关机）都会先经过 `before-quit`：
  // 在此置位后，主窗口的 close 不再被拦截（否则退出流程会被「关闭到托盘」永久挂住）。
  app.on('before-quit', () => {
    isQuitting = true
  })

  app.on('will-quit', () => {
    // 兜底：进程即将结束时释放全局热键、常驻浮窗与托盘，避免热键/托盘图标残留在系统里
    // 指向一个已退出的进程（Linux 上残留图标尤其明显）。
    globalShortcut.unregisterAll()
    quickAddController.destroy()
    tray?.destroy()
  })
}

/**
 * 单实例锁。
 *
 * 必须在 `whenReady` 之前、且在任何窗口/托盘/热键注册之前拿：书签数据是「整文件读改写」的，
 * 两个实例同时写 `bookmarks.json` 会互相覆盖。拿不到锁说明已有实例在运行，立即退出。
 */
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  console.log('[single-instance] Another instance is already running; quitting this one.')
  app.quit()
} else {
  startApplication()
}
