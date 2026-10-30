import { Menu, Tray } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { createTrayImage } from './tray-icon'

/**
 * 系统托盘。
 *
 * 设计取舍：
 * - 菜单模板由纯函数 `buildTrayMenuTemplate()` 产出（只返回普通对象、click 里转调
 *   handlers），这样单测可以不开 Electron、不建托盘就断言「条目、顺序、快捷键、回调映射」；
 * - `createTray()` 只负责把模板变成真实 Tray，并处理平台差异与失败降级。
 *
 * 文案为什么中英双写：**主进程没有 i18n 运行时**。
 * vue-i18n 实例活在渲染进程，主进程拿不到当前语言（要拿得走额外 IPC，且托盘在
 * 渲染进程就绪之前就要建好）；因此菜单用「中文 / English」双写，任何语言环境下都自解释。
 */

/**
 * 「显示主窗口」的快捷键。
 *
 * 与 `globalShortcut` 注册的加速键**是同一个字符串**（见 electron/main.ts），
 * 单一来源放在这里：菜单项的 `accelerator` 只是展示/本窗口内生效，
 * 真正的全局热键由 main 注册，两者若不同步会出现「菜单写着 X、按 X 没反应」。
 */
export const SHOW_WINDOW_ACCELERATOR = 'CommandOrControl+Shift+O'

/** 「快速添加书签」的快捷键（同上：菜单展示 + 全局注册共用）。 */
export const QUICK_ADD_ACCELERATOR = 'CommandOrControl+Shift+L'

/** 托盘菜单的行为注入点：托盘本身不 import main.ts（避免循环依赖）。 */
export interface TrayHandlers {
  /** 显示并聚焦主窗口（菜单项「显示主窗口」） */
  showMainWindow: () => void
  /** 切换主窗口显示/隐藏（Windows/Linux 托盘左键单击） */
  toggleMainWindow: () => void
  /** 显示/隐藏快速添加浮窗（菜单项「快速添加书签」） */
  toggleQuickAdd: () => void
  /** 进入统计页 */
  showStats: () => void
  /** 进入设置页 */
  showSettings: () => void
  /** 退出应用（调用方负责先置 `isQuitting = true`） */
  quit: () => void
}

/**
 * 托盘菜单模板（顺序固定，共 5 项）。
 *
 * click 只做转调，不放业务逻辑：真实行为由调用方注入，
 * 因此这里可以在 Node 环境里被直接单测。
 *
 * 注意：不返回 `type: 'separator'` 之类的额外条目——菜单条数与顺序被
 * `tests/shell-integration.test.ts` 断言，加了分隔符会让「第 n 项对应哪个 handler」变脆。
 */
export function buildTrayMenuTemplate(handlers: TrayHandlers): MenuItemConstructorOptions[] {
  return [
    {
      label: '显示主窗口 / Show Window',
      accelerator: SHOW_WINDOW_ACCELERATOR,
      click: () => handlers.showMainWindow()
    },
    {
      label: '快速添加书签 / Quick Add',
      accelerator: QUICK_ADD_ACCELERATOR,
      click: () => handlers.toggleQuickAdd()
    },
    {
      label: '统计 / Statistics',
      click: () => handlers.showStats()
    },
    {
      label: '设置 / Settings',
      click: () => handlers.showSettings()
    },
    {
      label: '退出 / Quit',
      click: () => handlers.quit()
    }
  ]
}

/**
 * 创建托盘。
 *
 * 平台差异：
 * - Windows / Linux：`setContextMenu` 让右键出菜单，左键 `click` 切换主窗口；
 * - macOS：`setContextMenu` 会让**左键自动弹出菜单**，若再在 `click` 里手动
 *   `popUpContextMenu` 就会弹两次。因此 macOS 上不调用 `setContextMenu`，
 *   只在 `click` 里 `popUpContextMenu(menu)`（符合「macOS 只弹菜单」的约定）。
 *
 * @returns 创建成功的 Tray；失败（图标不可用 / 当前桌面环境没有托盘支持）返回 `null`，
 *          此时调用方必须关闭「关闭到托盘」，否则用户关掉主窗口后将无法再唤回界面。
 */
export function createTray(handlers: TrayHandlers): Tray | null {
  try {
    const tray = new Tray(createTrayImage())
    tray.setToolTip('LinkCollection')

    const menu = Menu.buildFromTemplate(buildTrayMenuTemplate(handlers))

    if (process.platform === 'darwin') {
      tray.on('click', () => tray.popUpContextMenu(menu))
    } else {
      tray.setContextMenu(menu)
      tray.on('click', () => handlers.toggleMainWindow())
    }

    return tray
  } catch (error) {
    console.error('[tray] Failed to create the tray icon:', error)
    return null
  }
}
