import { BrowserWindow } from 'electron'
import { QUICK_ADD_SEARCH } from '../shared/view-route'

/**
 * 快速添加浮窗（Quick Add）。
 *
 * 定位：一个**独立的** BrowserWindow，复用同一个 `index.html` + 同一个 preload，
 * 靠查询参数 `?view=quickadd` 让渲染层挂载 `QuickAdd.vue`（判定见 `shared/view-route.ts`）。
 *
 * 为什么独立窗口而不是主窗口里的弹层：
 * - 浮窗需要 `alwaysOnTop` + `skipTaskbar`，与主窗口的窗口属性互斥；
 * - 全局快捷键（Ctrl/Cmd+Shift+L）必须能在主窗口最小化/隐藏时呼出它。
 *
 * 生命周期（回到本文件的数据结构）：
 *   - 首次 `toggle()` → 创建窗口（`show: false`）→ `ready-to-show` 后 `show() + focus()`；
 *   - 再次 `toggle()`：已可见 → 隐藏；已隐藏 → `show() + focus()`（**复用**，不重建）；
 *   - `blur` → 隐藏（点走焦点即收起，符合「浮窗」语义）；
 *   - `closed` → 引用置空（窗口可能被 `destroy()` 或系统回收）；
 *   - `hide()` 只隐藏不销毁：保持渲染进程热态，第二次呼出无需重新加载。
 *
 * 安全基线与主窗口完全一致：同一个 preload、`contextIsolation: true`、
 * `nodeIntegration: false`、`sandbox: true`，并注入**同一份**导航守卫
 * （由 main.ts 传入，避免两处复制导致某个窗口漏装）。
 */

/** 浮窗宽度（固定，`resizable: false`） */
export const QUICK_ADD_WIDTH = 460

/** 浮窗高度（固定，内容区按 460×190 设计：标题 + URL + 可选标题 + 按钮，无滚动条） */
export const QUICK_ADD_HEIGHT = 190

export interface QuickAddWindowOptions {
  /** 与主窗口相同的 preload 产物路径 */
  preloadPath: string
  /** 生产环境 `dist/index.html` 的绝对路径 */
  indexHtmlPath: string
  /** dev server 地址；`null` 表示生产模式（用 `loadFile` 加载本地文件） */
  devServerUrl: string | null
  /** 与主窗口一致的导航守卫（由 main.ts 注入） */
  installNavigationGuards: (window: BrowserWindow) => void
}

export interface QuickAddController {
  /** 切换浮窗显示状态（全局快捷键与托盘菜单「快速添加书签」都走这里） */
  toggle: () => void
  /** 隐藏浮窗（`close-quick-add` IPC：Esc / 取消 / 保存成功后） */
  hide: () => void
  /** 浮窗当前是否可见 */
  isVisible: () => boolean
  /** 当前窗口引用（未创建或已销毁时为 `null`），测试/调试用 */
  getWindow: () => BrowserWindow | null
  /** 销毁窗口并置空引用（退出时调用，避免残留 alwaysOnTop 窗口） */
  destroy: () => void
}

/**
 * 创建一个浮窗实例（不做任何显示/复用判断，纯构造）。
 */
function createQuickAddWindow(options: QuickAddWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: QUICK_ADD_WIDTH,
    height: QUICK_ADD_HEIGHT,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // 先不显示：等 ready-to-show（避免深色主题下的白底闪一下，也避免显示空窗口）
    show: false,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // 与主窗口一致：preload 产物是 CJS 且只 require('electron')，满足 sandbox 限制
      sandbox: true,
      webSecurity: true
    }
  })

  options.installNavigationGuards(win)

  // 复用同一张 index.html：dev 走 dev server（带查询串），生产走本地文件（`search` 选项）
  if (options.devServerUrl) {
    win.loadURL(`${options.devServerUrl}${QUICK_ADD_SEARCH}`).catch(error => {
      console.error('[quick-add] Failed to load the quick add view from the dev server:', error)
    })
  } else {
    win.loadFile(options.indexHtmlPath, { search: QUICK_ADD_SEARCH }).catch(error => {
      console.error('[quick-add] Failed to load the quick add HTML file:', error)
    })
  }

  return win
}

/**
 * 创建浮窗控制器（闭包持有唯一窗口引用）。
 *
 * 用工厂函数而不是模块级单例：主进程里只有一份实例（由 main.ts 创建），
 * 但工厂让「状态封装」不依赖模块加载顺序，也便于将来做多窗口。
 */
export function createQuickAddController(options: QuickAddWindowOptions): QuickAddController {
  let quickAddWindow: BrowserWindow | null = null

  const reveal = (win: BrowserWindow): void => {
    if (win.isDestroyed()) return
    win.show()
    win.focus()
  }

  const ensureWindow = (): BrowserWindow => {
    if (quickAddWindow && !quickAddWindow.isDestroyed()) {
      return quickAddWindow
    }

    const win = createQuickAddWindow(options)

    // 首次加载完成再显示：`show()` 在 paint 之前调用会看到空白/白底
    win.once('ready-to-show', () => reveal(win))
    win.on('blur', () => {
      if (!win.isDestroyed()) win.hide()
    })
    win.on('closed', () => {
      // 只清理指向自己的引用：避免「旧窗口的 closed 把新窗口的引用抹掉」
      if (quickAddWindow === win) quickAddWindow = null
    })

    quickAddWindow = win
    return win
  }

  const hide = (): void => {
    if (quickAddWindow && !quickAddWindow.isDestroyed()) {
      quickAddWindow.hide()
    }
  }

  const toggle = (): void => {
    const win = ensureWindow()
    if (win.isVisible()) {
      hide()
      return
    }
    reveal(win)
  }

  const destroy = (): void => {
    const win = quickAddWindow
    quickAddWindow = null
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
  }

  return {
    toggle,
    hide,
    isVisible: () => Boolean(quickAddWindow && !quickAddWindow.isDestroyed() && quickAddWindow.isVisible()),
    getWindow: () => quickAddWindow,
    destroy
  }
}
