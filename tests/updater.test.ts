import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 自动更新（`electron-updater`）的纯逻辑与状态机测试。
 *
 * 不启动 Electron、不联网、不写盘：
 * - `electron-updater` 由 `vi.hoisted` 手写的极小 stub 顶替（`on` + `emit` + 三个动作方法），
 *   这样「六个事件 → 状态机」的映射可以逐条驱动；
 * - `electron` 只提供 `app.getVersion()`（`getCurrentVersion` 用）。
 *
 * 覆盖的是 `electron/updater.ts` 里**不依赖真实 updater 行为**的部分：
 * 决策闸门、进度归一化、错误摘要、状态合并，以及事件到广播序列的映射。
 */
const updaterMock = vi.hoisted(() => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()

  const autoUpdater = {
    // 与真实 AppUpdater 的默认值相反，用来断言 init() 真的改了它们
    autoDownload: true,
    autoInstallOnAppQuit: false,
    logger: null as unknown,
    on(event: string, handler: (...args: unknown[]) => void): void {
      const handlers = listeners.get(event) ?? []
      handlers.push(handler)
      listeners.set(event, handlers)
    },
    emit(event: string, ...args: unknown[]): void {
      for (const handler of listeners.get(event) ?? []) {
        handler(...args)
      }
    },
    checkForUpdates: async (): Promise<{ isUpdateAvailable: boolean }> => ({
      isUpdateAvailable: false
    }),
    downloadUpdate: async (): Promise<string[]> => ['/tmp/link-collection-1.2.0.AppImage'],
    quitAndInstall: (): void => undefined,
    /** 每个用例之间清空监听与字段，避免用例互相污染 */
    reset(): void {
      listeners.clear()
      autoUpdater.autoDownload = true
      autoUpdater.autoInstallOnAppQuit = false
      autoUpdater.logger = null
    }
  }

  return { autoUpdater, listeners }
})

const electronMock = vi.hoisted(() => ({
  app: {
    getVersion: (): string => '1.1.0',
    isPackaged: false
  }
}))

vi.mock('electron-updater', () => ({ autoUpdater: updaterMock.autoUpdater }))
vi.mock('electron', () => electronMock)

import {
  clampPercent,
  createUpdater,
  mergeStatus,
  resolveCheckDecision,
  toErrorMessage
} from '../electron/updater'
import type { Updater, UpdateStatus } from '../electron/updater'

function createTestUpdater(overrides: {
  isPackaged?: boolean
  autoUpdateEnabled?: boolean
  autoUpdate?: () => boolean
} = {}): { updater: Updater; broadcast: ReturnType<typeof vi.fn> } {
  const broadcast = vi.fn()
  const isPackaged = overrides.isPackaged ?? true
  const autoUpdateEnabled = overrides.autoUpdateEnabled ?? true
  const updater = createUpdater({
    isPackaged,
    getAutoUpdateEnabled: overrides.autoUpdate ?? (() => autoUpdateEnabled),
    broadcast
  })
  return { updater, broadcast }
}

/** 从 broadcast 的调用参数里取出状态序列（每次调用一个快照） */
function broadcastStates(broadcast: ReturnType<typeof vi.fn>): UpdateStatus[] {
  return broadcast.mock.calls.map(call => call[0] as UpdateStatus)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  updaterMock.autoUpdater.reset()
})

describe('resolveCheckDecision：什么时候允许发起检查', () => {
  it('未打包：手动与后台都不允许，原因是 development', () => {
    expect(
      resolveCheckDecision({ isPackaged: false, autoUpdateEnabled: true, manual: true })
    ).toEqual({ allowed: false, reason: 'development' })
    expect(
      resolveCheckDecision({ isPackaged: false, autoUpdateEnabled: true, manual: false })
    ).toEqual({ allowed: false, reason: 'development' })
    // 即便用户「开着」自动更新，未打包也不允许（环境本身不具备更新配置）
    expect(
      resolveCheckDecision({ isPackaged: false, autoUpdateEnabled: false, manual: false })
    ).toEqual({ allowed: false, reason: 'development' })
  })

  it('已打包 + 用户关闭自动更新 + 后台检查：不允许，原因是 disabled', () => {
    expect(
      resolveCheckDecision({ isPackaged: true, autoUpdateEnabled: false, manual: false })
    ).toEqual({ allowed: false, reason: 'disabled' })
  })

  it('已打包 + 用户关闭自动更新 + 手动检查：允许（设置只约束后台静默检查）', () => {
    expect(
      resolveCheckDecision({ isPackaged: true, autoUpdateEnabled: false, manual: true })
    ).toEqual({ allowed: true })
  })

  it('已打包 + 开启自动更新：允许（手动与后台都一样）', () => {
    expect(
      resolveCheckDecision({ isPackaged: true, autoUpdateEnabled: true, manual: false })
    ).toEqual({ allowed: true })
    expect(
      resolveCheckDecision({ isPackaged: true, autoUpdateEnabled: true, manual: true })
    ).toEqual({ allowed: true })
  })
})

describe('clampPercent：进度归一化', () => {
  it('合法值取整并夹在 0–100', () => {
    expect(clampPercent(0)).toBe(0)
    expect(clampPercent(50.4)).toBe(50)
    expect(clampPercent(100)).toBe(100)
    expect(clampPercent(150)).toBe(100)
    expect(clampPercent(-1)).toBe(0)
  })

  it('非法值一律 0（不把 NaN% 漏到 UI）', () => {
    expect(clampPercent('abc')).toBe(0)
    expect(clampPercent(Number.NaN)).toBe(0)
    expect(clampPercent(undefined)).toBe(0)
    expect(clampPercent(null)).toBe(0)
  })
})

describe('toErrorMessage：错误摘要', () => {
  it('Error 取 message', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('字符串原样（去首尾空白）', () => {
    expect(toErrorMessage('  network unreachable ')).toBe('network unreachable')
  })

  it('null / undefined / 空串兜底为 Unknown error', () => {
    expect(toErrorMessage(null)).toBe('Unknown error')
    expect(toErrorMessage(undefined)).toBe('Unknown error')
    expect(toErrorMessage('')).toBe('Unknown error')
    expect(toErrorMessage(new Error(''))).toBe('Error')
  })

  it('超长消息截断到 200 字符', () => {
    const message = toErrorMessage('x'.repeat(500))
    expect(message).toHaveLength(200)
    expect(message).toBe('x'.repeat(200))
  })
})

describe('mergeStatus：事件合并（不丢已有字段）', () => {
  it('downloading 只更新 percent，保留 version', () => {
    const current: UpdateStatus = { state: 'available', version: '1.2.0' }
    expect(mergeStatus(current, { state: 'downloading', percent: 50 })).toEqual({
      state: 'downloading',
      version: '1.2.0',
      percent: 50
    })
  })

  it('available 带上新的 version', () => {
    expect(mergeStatus({ state: 'checking' }, { state: 'available', version: '1.3.0' })).toEqual({
      state: 'available',
      version: '1.3.0'
    })
  })

  it('error 带上 message', () => {
    expect(
      mergeStatus({ state: 'downloading', version: '1.2.0', percent: 40 }, { state: 'error', message: '404' })
    ).toEqual({ state: 'error', version: '1.2.0', message: '404' })
  })

  it('不得用 undefined 覆盖已有 version', () => {
    const current: UpdateStatus = { state: 'available', version: '1.2.0' }
    expect(mergeStatus(current, { state: 'downloading', percent: 10 }).version).toBe('1.2.0')
    // patch 里显式写 undefined 与「没写」等价
    expect(mergeStatus(current, { version: undefined }).version).toBe('1.2.0')
    expect(mergeStatus(current, { state: 'checking' }).version).toBe('1.2.0')
  })

  it('切换到非进度/非错误态时丢掉不适用的字段', () => {
    // 失败后重新发现新版本：旧错误信息不该继续显示
    expect(
      mergeStatus({ state: 'error', version: '1.2.0', message: '404' }, { state: 'available' })
    ).toEqual({ state: 'available', version: '1.2.0' })
    // 新版本还没下载：旧的 40% 不能残留
    expect(
      mergeStatus({ state: 'downloading', version: '1.2.0', percent: 40 }, { state: 'available' })
    ).toEqual({ state: 'available', version: '1.2.0' })
  })
})

describe('createUpdater：六个事件的映射与广播序列', () => {
  beforeEach(() => {
    updaterMock.autoUpdater.reset()
  })

  it('init() 配置 autoDownload=false / autoInstallOnAppQuit=true / logger=console', () => {
    const { updater } = createTestUpdater()

    updater.init()

    expect(updaterMock.autoUpdater.autoDownload).toBe(false)
    expect(updaterMock.autoUpdater.autoInstallOnAppQuit).toBe(true)
    expect(updaterMock.autoUpdater.logger).toBe(console)
    // 初始化本身不改状态、不发广播（此时通常还没有窗口）
    expect(updater.getStatus()).toEqual({ state: 'idle' })
  })

  it('checking → available → downloading 50% → downloaded 的广播序列', async () => {
    const { updater, broadcast } = createTestUpdater()
    updater.init()

    await expect(updater.check(true)).resolves.toEqual({ success: true })
    // check() 自己已经置过 checking；updater 的 checking-for-update 事件内容相同 → 去重不再广播
    updaterMock.autoUpdater.emit('checking-for-update')
    updaterMock.autoUpdater.emit('update-available', { version: '1.2.0' })
    updaterMock.autoUpdater.emit('download-progress', { percent: 50.4 })
    updaterMock.autoUpdater.emit('update-downloaded', { version: '1.2.0' })

    const states = broadcastStates(broadcast).map(status => status.state)
    expect(states).toEqual(['checking', 'available', 'downloading', 'downloaded'])

    const [, available, downloading, downloaded] = broadcastStates(broadcast)
    expect(available).toEqual({ state: 'available', version: '1.2.0' })
    expect(downloading).toEqual({ state: 'downloading', version: '1.2.0', percent: 50 })
    expect(downloaded).toEqual({ state: 'downloaded', version: '1.2.0', percent: 100 })

    expect(updater.getStatus()).toEqual({ state: 'downloaded', version: '1.2.0', percent: 100 })
  })

  it('update-not-available → not-available（已是最新）', async () => {
    const { updater, broadcast } = createTestUpdater()
    updater.init()

    await updater.check(true)
    updaterMock.autoUpdater.emit('update-not-available', { version: '1.1.0' })

    expect(updater.getStatus()).toEqual({ state: 'not-available', version: '1.1.0' })
    expect(broadcastStates(broadcast).map(status => status.state)).toEqual([
      'checking',
      'not-available'
    ])
  })

  it('error 事件只记录并置 error（message 截断 200 字符），不抛给调用方', async () => {
    const { updater, broadcast } = createTestUpdater()
    updater.init()

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await updater.check(true)
    updaterMock.autoUpdater.emit('error', new Error('y'.repeat(500)))

    const status = updater.getStatus()
    expect(status.state).toBe('error')
    expect(status.message).toHaveLength(200)
    expect(broadcastStates(broadcast).at(-1)).toEqual(status)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('checkForUpdates 抛错时返回 { success: false } 并兜底置 error（不会永久停在 checking）', async () => {
    const { updater } = createTestUpdater()
    updater.init()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates').mockRejectedValueOnce(
      new Error('Cannot find app-update.yml')
    )

    await expect(updater.check(true)).resolves.toEqual({
      success: false,
      error: 'Cannot find app-update.yml'
    })
    expect(updater.getStatus()).toEqual({
      state: 'error',
      message: 'Cannot find app-update.yml'
    })
  })

  it('未打包：init() 直接 disabled，check() 不发网络请求也不广播', async () => {
    const { updater, broadcast } = createTestUpdater({ isPackaged: false })

    const checkSpy = vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates')

    updater.init()
    expect(updater.getStatus()).toEqual({ state: 'disabled', message: 'development' })

    const manual = await updater.check(true)
    expect(manual.success).toBe(false)
    expect(checkSpy).not.toHaveBeenCalled()

    const automatic = await updater.check(false)
    expect(automatic.success).toBe(false)
    expect(checkSpy).not.toHaveBeenCalled()

    // 状态没有变化（本来就是 disabled），因此不会产生广播
    expect(broadcast).not.toHaveBeenCalled()
  })

  it('已打包 + 关闭自动更新：后台检查被拒（无广播），手动检查仍会调用 updater', async () => {
    const { updater, broadcast } = createTestUpdater({ autoUpdateEnabled: false })
    updater.init()

    const checkSpy = vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates')

    const automatic = await updater.check(false)
    expect(automatic.success).toBe(false)
    expect(checkSpy).not.toHaveBeenCalled()
    expect(broadcast).not.toHaveBeenCalled()

    await expect(updater.check(true)).resolves.toEqual({ success: true })
    expect(checkSpy).toHaveBeenCalledTimes(1)
  })

  it('download 调 downloadUpdate；下载完成后 install 调 quitAndInstall', async () => {
    const { updater } = createTestUpdater()
    updater.init()

    const downloadSpy = vi.spyOn(updaterMock.autoUpdater, 'downloadUpdate')
    const installSpy = vi.spyOn(updaterMock.autoUpdater, 'quitAndInstall')

    await expect(updater.download()).resolves.toEqual({ success: true })
    expect(downloadSpy).toHaveBeenCalledTimes(1)

    // 未下载完成时必须拒绝：electron-updater 会抛 "No update filepath provided"，
    // 旧实现 catch 后仍返回 success，会让 UI 误以为正在安装。
    expect(updater.install()).toEqual({ success: false, error: 'No downloaded update to install' })
    expect(installSpy).not.toHaveBeenCalled()

    updaterMock.autoUpdater.emit('update-downloaded', { version: '1.2.0' })
    expect(updater.getStatus().state).toBe('downloaded')

    expect(updater.install()).toEqual({ success: true })
    expect(installSpy).toHaveBeenCalledTimes(1)
  })

  it('checkForUpdates 长时间不返回时由超时兜底置为 error（不再永久停在 checking）', async () => {
    vi.useFakeTimers()
    try {
      const { updater, broadcast } = createTestUpdater()
      updater.init()

      // 模拟「无发布通道/断网」时既不 resolve 也不 emit error 的挂起
      vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates').mockImplementationOnce(
        () => new Promise(() => undefined)
      )
      vi.spyOn(console, 'error').mockImplementation(() => undefined)

      const pending = updater.check(true)
      await vi.advanceTimersByTimeAsync(30_000)
      await expect(pending).resolves.toEqual({ success: false, error: 'Update check timed out' })
      expect(updater.getStatus().state).toBe('error')
      expect(broadcast).toHaveBeenLastCalledWith(
        expect.objectContaining({ state: 'error', message: 'Update check timed out' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('download / install 失败也只返回 { success: false, error }', async () => {
    const { updater } = createTestUpdater()
    updater.init()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(updaterMock.autoUpdater, 'downloadUpdate').mockRejectedValueOnce('disk full')
    vi.spyOn(updaterMock.autoUpdater, 'quitAndInstall').mockImplementationOnce(() => {
      throw new Error('installer missing')
    })

    await expect(updater.download()).resolves.toEqual({ success: false, error: 'disk full' })

    // 先进入 downloaded 状态，才能走到 quitAndInstall 的失败分支
    updaterMock.autoUpdater.emit('update-downloaded', { version: '1.2.0' })
    expect(updater.install()).toEqual({ success: false, error: 'installer missing' })
  })

  it('getCurrentVersion 取 app.getVersion()', () => {
    const { updater } = createTestUpdater()
    expect(updater.getCurrentVersion()).toBe('1.1.0')
  })

  it('读设置本身抛错时按「已开启」降级，不让主进程崩溃 / IPC 拒绝', async () => {
    const { updater } = createTestUpdater({
      autoUpdate: () => {
        throw new Error('EACCES: settings.json')
      }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    updater.init()

    // 定时器回调路径不能同步抛（否则是主进程未捕获异常）
    expect(() => updater.scheduleStartupCheck()).not.toThrow()
    await expect(updater.check(false)).resolves.toEqual({ success: true })
  })

  it('scheduleStartupCheck：未打包 / 关闭自动更新时不排定时器', () => {
    vi.useFakeTimers()
    const checkSpy = vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates')

    const unpackaged = createTestUpdater({ isPackaged: false })
    unpackaged.updater.init()
    unpackaged.updater.scheduleStartupCheck()
    vi.advanceTimersByTime(20_000)
    expect(checkSpy).not.toHaveBeenCalled()

    const disabled = createTestUpdater({ autoUpdateEnabled: false })
    disabled.updater.init()
    disabled.updater.scheduleStartupCheck()
    vi.advanceTimersByTime(20_000)
    expect(checkSpy).not.toHaveBeenCalled()
  })

  it('scheduleStartupCheck：打包 + 开启时延迟 10 秒后才检查一次', async () => {
    vi.useFakeTimers()
    const checkSpy = vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates')

    const { updater } = createTestUpdater()
    updater.init()
    updater.scheduleStartupCheck()

    // 9.9 秒时还没有动作（不拖慢启动）
    await vi.advanceTimersByTimeAsync(9_900)
    expect(checkSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)
    expect(checkSpy).toHaveBeenCalledTimes(1)
  })
})

describe('checkForUpdates 无结论时的兜底', () => {
  it('resolve 但没发任何事件时置为 error，而不是停在 checking', async () => {
    const { updater, broadcast } = createTestUpdater()
    updater.init()

    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // 非 AppImage 目录构建里的真实行为：静默 resolve，一个事件都不发
    vi.spyOn(updaterMock.autoUpdater, 'checkForUpdates').mockResolvedValueOnce(null)

    await expect(updater.check(true)).resolves.toEqual({
      success: false,
      error: 'Update check returned no result for this build'
    })
    expect(updater.getStatus().state).toBe('error')
    expect(broadcast).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: 'error', message: 'Update check returned no result for this build' })
    )
  })
})
