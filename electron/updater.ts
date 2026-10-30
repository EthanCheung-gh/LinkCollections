import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { ProgressInfo, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater'

/**
 * 自动更新（`electron-updater`）主进程实现。
 *
 * 设计要点（为什么长这样）：
 *
 * 1. **纯函数与运行期分离**。`resolveCheckDecision` / `clampPercent` / `toErrorMessage` /
 *    `mergeStatus` 只吃参数、不碰 electron 与 electron-updater，因此可以在
 *    `tests/updater.test.ts` 里直接断言（`electron-updater` 在单测里由 `vi.mock` 顶替）。
 * 2. **只有打包环境才初始化**。`electron-updater` 在未打包时调用 `checkForUpdates()` 会
 *    直接报错（没有 `app-update.yml`）——这不是异常场景，而是「开发时不具备更新条件」，
 *    因此状态固定为 `disabled`，不建立任何监听、不发任何网络请求。
 * 3. **下载与安装分离**。`autoDownload = false`：发现新版本只置 `available`，
 *    必须由用户显式 `download()` → `downloaded` → `install()`。
 *    但 `autoInstallOnAppQuit = true`：用户选择「退出」时也把已下载的更新装上。
 * 4. **对外方法永不 throw**。更新失败是常态（无发布通道、断网、签名缺失、磁盘只读……），
 *    调用方（IPC handler / 渲染层）不应该被逼着写 try/catch，统一返回 `{ success, error }`。
 * 5. **状态去重广播**。状态机内部会对「完全相同的状态」跳过 `broadcast`，
 *    否则 `check()` 自己置的 `checking` 与 updater 的 `checking-for-update` 事件
 *    会让渲染层收到两条一模一样的通知（进度事件同理，每 0.1% 都在变但取整后可能相同）。
 */

/** 状态机取值（渲染层据此决定展示文案与按钮，不要再发明新态） */
export type UpdateState =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/**
 * 一次更新状态的快照。
 *
 * - `version`：涉及的版本号（`available` / `not-available` / `downloaded` 时为「新版本号」）；
 * - `percent`：下载进度 0–100（仅 `downloading` / `downloaded` 有意义）；
 * - `message`：`error` 的错误摘要；`disabled` 时是机器可读的原因（`'development'`），
 *   渲染层对 `disabled` 只用自己的 i18n 文案，不直接展示这个字段。
 */
export interface UpdateStatus {
  state: UpdateState
  version?: string
  percent?: number
  message?: string
}

/** `get-update-status` 的返回：状态 + 应用版本 + 能力位（是否打包环境）。 */
export interface UpdateStatusSnapshot extends UpdateStatus {
  currentVersion: string
  enabled: boolean
}

/** 所有「动作类」IPC 的统一返回形状：失败是常态，因此不 throw。 */
export interface UpdaterActionResult {
  success: boolean
  error?: string
}

/** 不允许检查更新的原因：`development` = 未打包；`disabled` = 用户关闭了自动更新。 */
export type UpdateUnavailableReason = 'development' | 'disabled'

export interface CheckDecision {
  allowed: boolean
  reason?: UpdateUnavailableReason
}

/** 后台检查的默认延迟：让窗口先画出来，别和迁移/托盘/快捷键抢启动时间。 */
export const STARTUP_CHECK_DELAY_MS = 10_000

/** 错误信息截断长度：避免把整段 HTML/堆栈塞进 IPC 与 UI。 */
const MAX_ERROR_MESSAGE_LENGTH = 200

/** `disabled` 状态的机器可读原因（`message` 字段），渲染层按需忽略。 */
const DEVELOPMENT_REASON = 'development'

const NO_PACKAGE_ERROR = 'Auto update is not available in this environment (app is not packaged)'
const AUTO_UPDATE_DISABLED_ERROR = 'Auto update is disabled in settings'
/** 检查更新的等待上限：超过则判失败，避免 UI 永久停在「检查中」 */
const CHECK_TIMEOUT_MS = 30_000
const CHECK_TIMEOUT_MESSAGE = 'Update check timed out'
/** 尚未下载完成时点「重启并安装」的拒绝原因 */
const NO_DOWNLOADED_UPDATE_ERROR = 'No downloaded update to install'
/** `checkForUpdates()` 正常返回但没有任何事件时的兜底说明 */
const CHECK_NO_RESULT_MESSAGE = 'Update check returned no result for this build'

/** 只有这两个状态才有「进度」语义；其它状态携带 percent 只会让 UI 显示陈旧进度。 */
const PERCENT_STATES: ReadonlySet<UpdateState> = new Set<UpdateState>(['downloading', 'downloaded'])

/** 只有这两个状态才有「说明性消息」；切换状态时旧 message 必须被丢掉。 */
const MESSAGE_STATES: ReadonlySet<UpdateState> = new Set<UpdateState>(['error', 'disabled'])

export interface CheckDecisionInput {
  isPackaged: boolean
  autoUpdateEnabled: boolean
  manual: boolean
}

/**
 * 是否允许发起一次检查。
 *
 * 规则只有两条，顺序也重要：
 * 1. 未打包 → 一律不允许（`development`）。`electron-updater` 在开发环境没有更新配置，
 *    连「试着查一下」都只会抛错，因此手动按钮也不该走到网络请求。
 * 2. 用户关闭自动更新 → **只禁止后台检查**，手动检查仍然允许：设置项语义是
 *    「不要偷偷在后台跑」，不是「禁用这个功能」。
 */
export function resolveCheckDecision({
  isPackaged,
  autoUpdateEnabled,
  manual
}: CheckDecisionInput): CheckDecision {
  if (!isPackaged) {
    return { allowed: false, reason: 'development' }
  }

  if (!manual && !autoUpdateEnabled) {
    return { allowed: false, reason: 'disabled' }
  }

  return { allowed: true }
}

/**
 * 进度百分比归一化：0–100 取整，非法值一律 0。
 *
 * `download-progress` 的 `percent` 是从字节数算出来的浮点，偶尔会是 `NaN`
 * （总长度为 0 时），直接塞进 UI 会显示 `NaN%`。
 */
export function clampPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  const rounded = Math.round(value)
  if (rounded < 0) return 0
  if (rounded > 100) return 100
  return rounded
}

/**
 * 把任意错误变成一句可展示的话（截断 200 字符）。
 *
 * `electron-updater` 的 `error` 事件参数不保证是 `Error`（HTTP 层可能抛字符串/对象），
 * 渲染层也不该看到 `[object Object]`，因此这里统一兜底。
 */
export function toErrorMessage(error: unknown): string {
  let raw = ''

  if (error instanceof Error) {
    raw = error.message || error.name
  } else if (typeof error === 'string') {
    raw = error
  } else if (error !== null && error !== undefined) {
    try {
      raw = String(error)
    } catch {
      raw = ''
    }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return 'Unknown error'
  }

  return trimmed.length > MAX_ERROR_MESSAGE_LENGTH
    ? trimmed.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : trimmed
}

/**
 * 事件合并：按 patch 覆盖当前状态，**不用 undefined 覆盖已有值**。
 *
 * 关键点（都有对应单测）：
 * - `download-progress` 只带 percent → `version` 必须保留（否则 UI 上的「新版本 1.2.0」会消失）；
 * - `available` 只带 version → 之前的 `percent` 不能残留（新版本还没开始下载）；
 * - `error` 的 message 在切到 `available` 之后必须消失（否则「失败原因」会一直挂着）。
 */
export function mergeStatus(current: UpdateStatus, patch: Partial<UpdateStatus>): UpdateStatus {
  const state = patch.state ?? current.state
  const next: UpdateStatus = { state }

  const version = patch.version ?? current.version
  if (version !== undefined) {
    next.version = version
  }

  // 非进度态：只有 patch 显式给出 percent 才保留（用于「downloaded 置 100」这类收尾）
  const percent = PERCENT_STATES.has(state)
    ? (patch.percent ?? current.percent)
    : patch.percent
  if (percent !== undefined) {
    next.percent = percent
  }

  const message = MESSAGE_STATES.has(state)
    ? (patch.message ?? current.message)
    : patch.message
  if (message !== undefined) {
    next.message = message
  }

  return next
}

/** 两个状态是否「完全一样」（用于广播去重） */
function isSameStatus(a: UpdateStatus, b: UpdateStatus): boolean {
  return (
    a.state === b.state &&
    a.version === b.version &&
    a.percent === b.percent &&
    a.message === b.message
  )
}

export interface UpdaterOptions {
  /** `app.isPackaged`（由调用方传入，便于单测覆盖两种环境） */
  isPackaged: boolean
  /** 读用户设置里的 `autoUpdate`（每次检查都实时读，改设置不需要重启） */
  getAutoUpdateEnabled: () => boolean
  /** 状态广播（主进程遍历所有窗口 `webContents.send('update-status', status)`） */
  broadcast: (status: UpdateStatus) => void
}

export interface Updater {
  init: () => void
  /** `manual = true` 表示设置页按钮（用户关闭自动更新时也允许） */
  check: (manual?: boolean) => Promise<UpdaterActionResult>
  download: () => Promise<UpdaterActionResult>
  install: () => UpdaterActionResult
  getStatus: () => UpdateStatus
  getCurrentVersion: () => string
  scheduleStartupCheck: (delayMs?: number) => void
}

/**
 * 创建更新控制器。
 *
 * 单例由调用方（`electron/main.ts`）在模块级持有：`init()` 的监听绑定必须只有一份，
 * 否则每个窗口/每次重建都会让状态机被同一事件推多次。
 */
export function createUpdater({
  isPackaged,
  getAutoUpdateEnabled,
  broadcast
}: UpdaterOptions): Updater {
  let status: UpdateStatus = isPackaged
    ? { state: 'idle' }
    : { state: 'disabled', message: DEVELOPMENT_REASON }
  let initialized = false

  /** 状态变更 + 去重广播；广播失败只影响 UI，绝不影响主流程 */
  function setStatus(next: UpdateStatus): void {
    if (isSameStatus(next, status)) {
      return
    }

    status = next

    try {
      // 传入副本：调用方（IPC 序列化）不应拿到内部可变引用
      broadcast({ ...status })
    } catch (error) {
      console.error('[updater] Failed to broadcast update status:', error)
    }
  }

  function applyStatus(patch: Partial<UpdateStatus>): void {
    setStatus(mergeStatus(status, patch))
  }

  /**
   * 读用户设置（防御式）。
   *
   * `getSettings()` 会读盘，`ensureDataDir()` 在极端情况（磁盘只读/权限被改）会抛错。
   * 这个读操作发生在**定时器回调**与 `whenReady` 里，抛出去就是主进程未捕获异常
   * （Electron 会弹崩溃对话框）——「读不到设置」绝不能升级成「应用崩溃」。
   */
  function autoUpdateEnabled(): boolean {
    try {
      return getAutoUpdateEnabled() === true
    } catch (error) {
      console.warn('[updater] Failed to read the autoUpdate setting; assuming enabled:', error)
      return true
    }
  }

  /**
   * 绑定配置与六个事件（幂等）。
   *
   * 未打包时**不碰** `autoUpdater`：`electron-updater` 在构造/赋值阶段没问题，
   * 但任何网络动作都会抛错，提前返回可以保证开发环境完全静默。
   */
  function init(): void {
    if (initialized) return
    initialized = true

    if (!isPackaged) {
      status = { state: 'disabled', message: DEVELOPMENT_REASON }
      // 此时还没有窗口（init 早于 createWindow），广播也无对象可发；
      // 渲染层挂载时会用 `get-update-status` 主动拉一次，拿到就是这个 disabled。
      return
    }

    // 下载与安装分离：发现新版本只通知，下载要用户点头
    autoUpdater.autoDownload = false
    // 但用户选择「退出应用」时，已下载的更新直接装上（不强制重启）
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = console

    autoUpdater.on('checking-for-update', () => {
      applyStatus({ state: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      applyStatus({ state: 'available', version: info?.version })
    })

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      applyStatus({ state: 'not-available', version: info?.version })
    })

    autoUpdater.on('download-progress', (info: ProgressInfo) => {
      applyStatus({ state: 'downloading', percent: clampPercent(info?.percent) })
    })

    autoUpdater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      applyStatus({ state: 'downloaded', version: info?.version, percent: 100 })
    })

    // 错误只记录 + 置状态：更新通道没发布、断网、签名缺失都会走到这里，
    // 让一个「更新失败」把主进程搞崩是最差的结果。
    autoUpdater.on('error', (error: Error) => {
      const message = toErrorMessage(error)
      console.error('[updater] Update error:', message)
      applyStatus({ state: 'error', message })
    })
  }

  /** 未打包时的统一拒绝：同时把状态摆回 `disabled`（手动调用也不该显示成「失败」） */
  function rejectUnpackaged(): UpdaterActionResult {
    setStatus({ state: 'disabled', message: DEVELOPMENT_REASON })
    return { success: false, error: NO_PACKAGE_ERROR }
  }

  async function check(manual = false): Promise<UpdaterActionResult> {
    const decision = resolveCheckDecision({
      isPackaged,
      autoUpdateEnabled: autoUpdateEnabled(),
      manual
    })

    if (!decision.allowed) {
      if (decision.reason === 'development') {
        return rejectUnpackaged()
      }
      // 用户关闭了自动更新：只拒绝「后台检查」，不改变当前状态（不是错误，也不该打扰）
      return { success: false, error: AUTO_UPDATE_DISABLED_ERROR }
    }

    try {
      init()
      // 立刻置 checking：不然点了按钮到 updater 发出 `checking-for-update` 之间会有空窗，
      // 用户会以为点击没生效（按钮 loading 依赖这个状态）。
      applyStatus({ state: 'checking' })

      // 超时兜底：无发布通道 / 断网 / 代理吞包时 `checkForUpdates()` 可能既不 resolve
      // 也不 emit `error`（实测在无 release 的仓库上会一直挂着），
      // 那样 UI 会永久停在「检查中」。这里用竞速把等待上限钉死。
      let timer: NodeJS.Timeout | undefined
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(CHECK_TIMEOUT_MESSAGE)), CHECK_TIMEOUT_MS)
        timer.unref?.()
      })

      let result: unknown
      try {
        result = await Promise.race([autoUpdater.checkForUpdates(), timeout])
      } finally {
        if (timer) clearTimeout(timer)
      }

      // 第三种「没有结论」的情况：`checkForUpdates()` resolve 成 **null** 且一个事件都没发。
      // 实测在非 AppImage 的目录构建里就是这样（没有 APPIMAGE 环境变量时它静默返回 null），
      // 不兜底的话状态会永远停在 `checking`，用户看到「检查中…」永不结束。
      // 注意只在「返回值为空」时兜底：正常结果对象一定伴随 available/not-available 事件。
      if (result == null && status.state === 'checking') {
        console.error('[updater] checkForUpdates returned no result and emitted no event')
        applyStatus({ state: 'error', message: CHECK_NO_RESULT_MESSAGE })
        return { success: false, error: CHECK_NO_RESULT_MESSAGE }
      }

      return { success: true }
    } catch (error) {
      const message = toErrorMessage(error)
      // 没有发布通道 / 无 `app-update.yml` / 断网 / 超时才走这里，且不一定伴随 `error` 事件，
      // 因此必须自己兜底置状态，否则 UI 会永久卡在 `checking`。
      console.error('[updater] checkForUpdates failed:', message)
      applyStatus({ state: 'error', message })
      return { success: false, error: message }
    }
  }

  async function download(): Promise<UpdaterActionResult> {
    if (!isPackaged) {
      return rejectUnpackaged()
    }

    try {
      init()
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      const message = toErrorMessage(error)
      console.error('[updater] downloadUpdate failed:', message)
      applyStatus({ state: 'error', message })
      return { success: false, error: message }
    }
  }

  function install(): UpdaterActionResult {
    if (!isPackaged) {
      return rejectUnpackaged()
    }

    // 只有下载完成才允许重启安装：否则 electron-updater 会抛
    // "No update filepath provided, can't quit and install"，
    // 而旧实现 catch 之后仍返回 success，调用方会误以为正在安装。
    if (status.state !== 'downloaded') {
      return { success: false, error: NO_DOWNLOADED_UPDATE_ERROR }
    }

    try {
      init()
      // 内部会走 `app.quit()`：主进程 `before-quit` 会解除「关闭到托盘」拦截，
      // 否则窗口被 hide 掉、退出流程挂住，安装永远不会开始。
      autoUpdater.quitAndInstall()
      return { success: true }
    } catch (error) {
      const message = toErrorMessage(error)
      console.error('[updater] quitAndInstall failed:', message)
      applyStatus({ state: 'error', message })
      return { success: false, error: message }
    }
  }

  /** 返回副本，避免调用方改到状态机内部对象 */
  function getStatus(): UpdateStatus {
    return { ...status }
  }

  function getCurrentVersion(): string {
    try {
      return app.getVersion()
    } catch (error) {
      console.warn('[updater] Failed to read app version:', error)
      return ''
    }
  }

  /**
   * 启动后延迟检查一次（后台、静默）。
   *
   * - 未打包或用户关闭自动更新 → 什么都不做（连定时器都不建）；
   * - `unref()`：桌面应用关窗后常常还要退出，这个 10 秒的定时器不该成为退出阻碍。
   */
  function scheduleStartupCheck(delayMs = STARTUP_CHECK_DELAY_MS): void {
    if (!isPackaged || !autoUpdateEnabled()) {
      return
    }

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      void check(false)
        .then(result => {
          if (!result.success) {
            // 后台检查失败属于预期（仓库可能还没有 release 产物），只留日志：
            // 不弹 toast、不切视图，用户主动打开设置页时才看到 error 状态。
            console.warn('[updater] Background update check failed:', result.error)
          }
        })
        .catch(error => {
          // 兜底：`check()` 内部已全 catch，这里是为了「定时器回调里绝不出现未处理拒绝」
          console.warn('[updater] Background update check crashed:', error)
        })
    }, delayMs)

    // Node 的定时器对象有 unref()；DOM 类型下 setTimeout 返回 number，因此做能力检测
    if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref()
    }
  }

  return { init, check, download, install, getStatus, getCurrentVersion, scheduleStartupCheck }
}
