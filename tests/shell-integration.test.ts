import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { electronStub } from './helpers/electron-stub'
import { isQuickAddView, QUICK_ADD_SEARCH } from '../shared/view-route'
import {
  buildTrayMenuTemplate,
  QUICK_ADD_ACCELERATOR,
  SHOW_WINDOW_ACCELERATOR
} from '../electron/tray'
import type { TrayHandlers } from '../electron/tray'
import { createTrayImage } from '../electron/tray-icon'

/**
 * 「系统托盘 + 全局快捷键 + 快速添加浮窗」的纯逻辑测试。
 *
 * 不启动 Electron、不建窗口/托盘：被断言的三样东西都是**纯函数**
 *  - `isQuickAddView()`：渲染层判定视图（主进程拼查询串时依赖同一份实现）；
 *  - `buildTrayMenuTemplate()`：菜单条目/顺序/快捷键/回调映射；
 *  - `createTrayImage()`：图标解码成功与失败降级。
 *
 * `electron` 用 `tests/helpers/electron-stub.ts` 顶替（只补了 `nativeImage` / `Menu`），
 * 因此这里能 `import` 主进程模块而不会真的加载 Electron 二进制。
 */
vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

describe('isQuickAddView：查询串 → 视图判定', () => {
  it('命中快速添加视图的常见形态（带 ?、裸查询串、与其它参数共存）', () => {
    // location.search 形态
    expect(isQuickAddView('?view=quickadd')).toBe(true)
    // 裸查询串（无前导 ?）—— 日志/调试里直接传字符串时很常见
    expect(isQuickAddView('view=quickadd')).toBe(true)
    // 只看 `view` 键，不要求它是第一个参数
    expect(isQuickAddView('view=quickadd&x=1')).toBe(true)
    expect(isQuickAddView('?x=1&view=quickadd')).toBe(true)
  })

  it('主进程拼的查询串与渲染层判定一致（单一来源）', () => {
    // QUICK_ADD_SEARCH 就是 loadFile(..., { search }) / loadURL(...) 用的那串
    expect(QUICK_ADD_SEARCH).toBe('?view=quickadd')
    expect(isQuickAddView(QUICK_ADD_SEARCH)).toBe(true)
  })

  it('非快速添加视图一律 false（不能误伤主窗口）', () => {
    expect(isQuickAddView('?view=app')).toBe(false)
    // 空串 = 主窗口（生产环境 loadFile 不带 search）
    expect(isQuickAddView('')).toBe(false)
    // 纯空白
    expect(isQuickAddView('   ')).toBe(false)
    // 没有 view 键
    expect(isQuickAddView('?other=1')).toBe(false)
    // 键对但值不对（前缀相同的值也不算命中）
    expect(isQuickAddView('?view=quickadd2')).toBe(false)
  })

  it('#hash 之后的片段不参与判定', () => {
    // 真命中：`#hash` 只是尾随片段
    expect(isQuickAddView('?view=quickadd#hash')).toBe(true)
    // 值只出现在 hash 里 → 不算命中（否则主窗口带锚点会被错挂成浮窗）
    expect(isQuickAddView('?x=1#view=quickadd')).toBe(false)
  })
})

describe('buildTrayMenuTemplate：菜单条目 / 顺序 / 快捷键 / 回调映射', () => {
  /** 六个 handler 全为 spy，键集合由 `TrayHandlers` 约束（少写一个会编译失败） */
  type SpyHandlers = { [K in keyof TrayHandlers]: ReturnType<typeof vi.fn> }

  function createHandlers(): SpyHandlers {
    return {
      showMainWindow: vi.fn(),
      toggleMainWindow: vi.fn(),
      toggleQuickAdd: vi.fn(),
      showStats: vi.fn(),
      showSettings: vi.fn(),
      quit: vi.fn()
    }
  }

  /** 把菜单项的 click 当无参函数调用（真实签名带 menuItem/browserWindow/event，单测不需要） */
  function clickItem(item: MenuItemConstructorOptions): void {
    const click = item.click as unknown as (() => void) | undefined
    click?.()
  }

  it('固定 5 项，顺序为：显示窗口 → 快速添加 → 统计 → 设置 → 退出', () => {
    const template = buildTrayMenuTemplate(createHandlers())

    expect(template).toHaveLength(5)
    // 不加 separator：否则「第 n 项对应哪个 handler」立刻变脆
    expect(template.map(item => item.type)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    ])
    expect(template.map(item => String(item.label).split(' / ')[0])).toEqual([
      '显示主窗口',
      '快速添加书签',
      '统计',
      '设置',
      '退出'
    ])
  })

  it('每项 label 中英双写（主进程没有 i18n 运行时，菜单必须自解释）', () => {
    const template = buildTrayMenuTemplate(createHandlers())

    for (const item of template) {
      const label = String(item.label)
      expect(label).toMatch(/[\u4e00-\u9fa5]/) // 含中文
      expect(label).toMatch(/[A-Za-z]/) // 含英文
      expect(label).toContain(' / ')
    }
  })

  it('只有前两项带 accelerator，且用的是与全局注册共享的常量', () => {
    const template = buildTrayMenuTemplate(createHandlers())

    expect(template[0]?.accelerator).toBe(SHOW_WINDOW_ACCELERATOR)
    expect(template[1]?.accelerator).toBe(QUICK_ADD_ACCELERATOR)
    // 统计/设置/退出没有热键：菜单不展示、全局也不注册
    expect(template[2]?.accelerator).toBeUndefined()
    expect(template[3]?.accelerator).toBeUndefined()
    expect(template[4]?.accelerator).toBeUndefined()
  })

  it('只产出模板、不触发任何 handler（点击才执行）', () => {
    const handlers = createHandlers()
    buildTrayMenuTemplate(handlers)

    for (const spy of Object.values(handlers)) {
      expect(spy).not.toHaveBeenCalled()
    }
  })

  it('每个 click 只转到对应 handler，各调用一次', () => {
    const handlers = createHandlers()
    const template = buildTrayMenuTemplate(handlers)

    for (const item of template) {
      clickItem(item)
    }

    expect(handlers.showMainWindow).toHaveBeenCalledTimes(1)
    expect(handlers.toggleQuickAdd).toHaveBeenCalledTimes(1)
    expect(handlers.showStats).toHaveBeenCalledTimes(1)
    expect(handlers.showSettings).toHaveBeenCalledTimes(1)
    expect(handlers.quit).toHaveBeenCalledTimes(1)
    // 托盘左键「切换主窗口」是 `tray.on('click')` 的行为（见 createTray），不属于菜单项
    expect(handlers.toggleMainWindow).not.toHaveBeenCalled()
  })

  it('「退出」项必定存在并映射到 quit（TrayHandlers.quit 必填，没有可选 onQuit 分支）', () => {
    const handlers = createHandlers()
    const template = buildTrayMenuTemplate(handlers)

    const quitItems = template.filter(item => String(item.label).includes('Quit'))
    expect(quitItems).toHaveLength(1)

    clickItem(quitItems[0] as MenuItemConstructorOptions)
    expect(handlers.quit).toHaveBeenCalledTimes(1)
    expect(handlers.showMainWindow).not.toHaveBeenCalled()
  })
})

describe('createTrayImage：内嵌 base64 → NativeImage（含失败降级）', () => {
  beforeEach(() => {
    vi.spyOn(electronStub.nativeImage, 'createFromDataURL')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('解码正常：返回非空图（直接返回 createFromDataURL 的结果）', () => {
    const image = createTrayImage()
    const decode = vi.mocked(electronStub.nativeImage.createFromDataURL)

    expect(image).toBeTruthy()
    expect(image.isEmpty()).toBe(false)
    expect(decode).toHaveBeenCalledTimes(1)
    // 参数必须是内嵌 PNG 的 data URL：打包后不读文件，也就不存在「找不到图标」的路径问题
    expect(String(decode.mock.calls[0]?.[0])).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  })

  it('解码出空图：console.error 并降级为 createEmpty()', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(electronStub.nativeImage.createFromDataURL).mockReturnValue({ isEmpty: () => true })

    const image = createTrayImage()

    expect(image.isEmpty()).toBe(true)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('解码抛异常：不向上冒泡，降级为 createEmpty()', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.mocked(electronStub.nativeImage.createFromDataURL).mockImplementation(() => {
      throw new Error('broken base64')
    })

    const image = createTrayImage()

    expect(image.isEmpty()).toBe(true)
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })
})
