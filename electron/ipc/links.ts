import { ipcMain } from 'electron'
import { readJsonFile, writeJsonFile } from '../utils/storage'

/**
 * 死链检查（`check-links`）。
 *
 * 分成两层：
 * 1. **纯函数**（本文件上半部分，全部 `export`）：状态判定、HEAD→GET 回退规则、
 *    并发调度、结果折叠。这些不接触网络/磁盘，因此可以单测（见 tests/link-check.test.ts）。
 * 2. **网络与 IPC**（下半部分）：`probeUrl` 用 Node 内置 `fetch` 发一次探测，
 *    handler 负责读盘 → 并发探测 → 一次写盘 → 返回汇总。
 *
 * 产品约定（改动时必须与渲染层 UI 同步）：
 * - 判定：`2xx/3xx` = ok；`404/410` 与 DNS/连接失败 = broken；
 *   `401/403/429/5xx` = unknown（反爬或服务端问题，不能直接判死链）。
 * - 先 `HEAD`，遇到 405/501/403 或网络错误再退回 `GET`（很多站点不支持 HEAD）。
 * - 每个请求都有 8s `AbortController` 超时；同一时刻只有一轮检查在跑；并发上限 4。
 * - 结果写在书签的可选字段 `linkStatus` 上（`ok: null` = unknown），**不需要 schema 迁移**：
 *   字段可选，旧数据天然兼容，缺失即「从未检查过」。
 * - 这个字段**只由主进程写入**。`update-bookmark` / `bulk-update-bookmarks` 的白名单里
 *   没有它，渲染层无法改写（见 ipc/bookmarks.ts 的 normalizeBulkPatch / update-bookmark）。
 */

const BOOKMARKS_FILE = 'bookmarks.json'

/** 并发上限：不要一次性把全部请求打出去（目标站点会限流，本机也会耗连接槽） */
const CHECK_CONCURRENCY = 4

/** 单次请求的超时（毫秒）。HEAD 与 GET 各自计时，因此最坏情况下一个 URL 约 16s 后返回。 */
const REQUEST_TIMEOUT_MS = 8000

/** 落盘 `linkStatus.error` 的最大长度：错误原因只用于 UI 展示，不需要完整堆栈 */
const MAX_ERROR_LENGTH = 200

/** 只有 http/https 会被探测（与 ipc/settings.ts 的 open-browser 保持同一策略） */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/** 探测时声明自己是谁：不伪装成浏览器，被反爬拦下会落到 unknown（这是安全的一侧） */
const PROBE_USER_AGENT = 'LinkCollection-LinkChecker/1.1.0'

export type LinkStatusKind = 'ok' | 'broken' | 'unknown'

/**
 * 落盘的单条检查结果。
 *
 * `ok: null` 表示 unknown —— 既不能判活也不能判死（401/403/429/5xx、重定向到登录页等）。
 * `status: null` 表示没拿到任何 HTTP 状态码（DNS 失败/超时/被中止）。
 */
export interface LinkStatus {
  ok: boolean | null
  status: number | null
  checkedAt: string
  error?: string
}

/** `probeUrl` 的返回：要么有状态码，要么有错误原因，二者至少有一个 */
export interface ProbeResult {
  status?: number
  error?: string
}

/** `check-links` 的返回。`bookmarks` 只含**本次实际检查**的记录（已带新 linkStatus）。 */
export interface LinkCheckResult {
  checked: number
  broken: number
  unknown: number
  ok: number
  bookmarks: StoredBookmark[]
}

/**
 * 书签记录的最小形状：只声明检查用得到的字段，其余字段（title/color/tags…）原样透传。
 *
 * 与 `ipc/bookmarks.ts` 的 `Bookmark` 各自持有一份（该接口未导出，且那边是完整白名单定义）；
 * 这里用索引签名保证「不认识的历史字段也不会在写盘时被丢掉」。
 */
interface StoredBookmark {
  id: string
  url: string
  linkStatus?: LinkStatus
  /** 软删除标记（回收站）：`null` / 缺失 = 未删除，非空字符串 = 已删除 */
  deletedAt?: string | null
  [key: string]: unknown
}

/* ------------------------------------------------------------------ *
 * 纯函数层（可单测，不接触网络/磁盘）
 * ------------------------------------------------------------------ */

/**
 * 仅接受可被 `new URL()` 解析且协议为 http/https 的地址。
 *
 * 与 `ipc/settings.ts` 的 `parseHttpUrl` 规则等价，但**不 import 它的私有函数**
 * （那个函数没导出，跨模块 import 私有实现会耦合到别人的内部结构）。
 */
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

/**
 * 状态码分类（约定 4）。
 *
 * - `2xx / 3xx` → ok
 * - `404 / 410` → broken（明确表示资源不存在）
 * - `<= 0` → broken：这是「没有拿到任何状态码」的哨兵值，等价于连接层失败
 *   （DNS 解析失败、连接被拒、超时），产品上按死链处理
 * - 其余（`401/403/429/5xx`、1xx、异常值）→ unknown：反爬/鉴权/服务端故障都可能，
 *   错误地判死链会让用户删掉有效书签，因此宁可不确定
 */
export function classifyStatus(status: number): LinkStatusKind {
  if (!Number.isFinite(status) || status <= 0) return 'broken'
  if (status >= 200 && status < 400) return 'ok'
  if (status === 404 || status === 410) return 'broken'
  return 'unknown'
}

/**
 * HEAD 失败后是否退回 GET（约定 2）。
 *
 * - 拿到网络错误/超时（`error` 非空）→ 重试：HEAD 失败不代表资源不存在
 * - `405 / 501` → 服务器不支持 HEAD，必须用 GET
 * - `403` → 很多 CDN/WAF 只拦 HEAD（无 body 的请求常被当成爬虫），GET 往往能过
 * - 没拿到状态码也没有错误原因（理论上不该出现）→ 也重试一次，成本可接受
 * - 其它状态码（含 2xx/404/500…）→ 已经有可信结论，不再多发一次请求
 */
export function shouldRetryWithGet(result: { status?: number; error?: string }): boolean {
  if (typeof result.error === 'string' && result.error !== '') return true
  if (typeof result.status !== 'number') return true
  return result.status === 403 || result.status === 405 || result.status === 501
}

/**
 * 固定并发度的调度器：**保持输入顺序**返回结果数组。
 *
 * 实现方式是「N 个 worker 共享一个游标」，而不是分批 `Promise.all`：
 * 分批会在最慢的一批上等齐，固定并发能跑满槽位。
 *
 * - `limit` 非法（0/负数/NaN）时兜底为 1（串行），永不出现「0 个 worker 什么都不做」；
 * - worker 抛错时整个函数 reject（调用方需要自己保证 worker 不抛，`probeUrl` 用 try/catch 兜住）。
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const size = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1
  const results = new Array<R>(items.length)

  let cursor = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * 把单次探测结果折叠成要落盘的 `linkStatus`。
 *
 * - `ok`：`true` / `false` / `null`（unknown），由 {@link classifyStatus} 决定；
 *   没有状态码（`status: null`）说明是连接层失败，按约定判为 broken；
 * - `error` 截断到 {@link MAX_ERROR_LENGTH} 字符，且**只有存在原因时才写这个键**，
 *   避免无意义的 `error: undefined` 落进 JSON；
 * - `checkedAt` 由调用方传入（同一轮检查共用一个时间戳，便于「这批结果是一起得出的」）。
 *
 * `_bookmarkId` 只用于调用点可读性/排查定位（本函数保持纯：不读盘、不打日志），
 * 因此按 TS 约定加 `_` 前缀，避免 `noUnusedParameters` 报错。
 */
export function mergeLinkStatus(
  _bookmarkId: string,
  result: ProbeResult,
  checkedAt: string
): LinkStatus {
  const status =
    typeof result.status === 'number' && Number.isFinite(result.status)
      ? Math.trunc(result.status)
      : null

  const rawError = typeof result.error === 'string' ? result.error.trim() : ''
  const error = rawError ? rawError.slice(0, MAX_ERROR_LENGTH) : ''

  let ok: boolean | null
  if (status === null) {
    // 没有 HTTP 状态码 = DNS/连接失败/超时，约定里属于 broken
    ok = false
  } else {
    const kind = classifyStatus(status)
    ok = kind === 'ok' ? true : kind === 'broken' ? false : null
  }

  const linkStatus: LinkStatus = { ok, status, checkedAt }
  if (error) {
    linkStatus.error = error
  }
  return linkStatus
}

/* ------------------------------------------------------------------ *
 * 网络层
 * ------------------------------------------------------------------ */

/** 把 fetch 抛出的错误压成一行可读文本（Node 的 cause 里才是真正原因，如 ENOTFOUND） */
function describeFetchError(error: unknown, timedOut: boolean): string {
  if (timedOut) return `timeout after ${REQUEST_TIMEOUT_MS}ms`
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const causeMessage = cause instanceof Error ? cause.message : ''
    return causeMessage ? `${error.message}: ${causeMessage}` : error.message
  }
  return String(error)
}

/**
 * 发一次请求，只关心状态码。
 *
 * - `redirect: 'follow'`：跳转链由 fetch 自己走完，我们判定的是最终状态；
 * - 8s 超时用 `AbortController` + `setTimeout`：`fetch` 本身没有超时参数；
 *   定时器在 `finally` 里清掉，避免每个请求都留一个挂起的 timer 拖住进程退出；
 * - 响应体必须显式丢弃（`body.cancel()`）：GET 不消费 body 会一直占着连接。
 */
async function requestOnce(url: string, method: 'HEAD' | 'GET'): Promise<ProbeResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': PROBE_USER_AGENT,
        accept: '*/*'
      }
    })

    try {
      await response.body?.cancel()
    } catch {
      // 取消失败不影响判定：状态码已经拿到了
    }

    return { status: response.status }
  } catch (error) {
    return { status: undefined, error: describeFetchError(error, timedOut) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 探测一个 URL：先 HEAD，按 {@link shouldRetryWithGet} 决定是否退回 GET。
 *
 * 非 http/https 不发起任何请求，直接返回错误原因（会被判为 broken）：
 * 导入数据里可能存在 `mailto:` / `javascript:` / 相对路径，绝不能拿去发请求。
 */
export async function probeUrl(url: string): Promise<ProbeResult> {
  const parsed = parseHttpUrl(url)
  if (!parsed) {
    return { error: 'Only http(s) URLs can be checked' }
  }

  const head = await requestOnce(parsed.href, 'HEAD')
  if (!shouldRetryWithGet(head)) {
    return head
  }

  return requestOnce(parsed.href, 'GET')
}

/* ------------------------------------------------------------------ *
 * 读写盘 + IPC
 * ------------------------------------------------------------------ */

function getBookmarks(): StoredBookmark[] {
  return readJsonFile<StoredBookmark[]>(BOOKMARKS_FILE, [])
}

function saveBookmarks(bookmarks: StoredBookmark[]): boolean {
  return writeJsonFile(BOOKMARKS_FILE, bookmarks)
}

/** 只保留字符串并去重（保持首次出现顺序），与 ipc/bookmarks.ts 的 dedupeStrings 同语义 */
function dedupeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (seen.has(item)) continue
    seen.add(item)
    result.push(item)
  }
  return result
}

/**
 * 记录是否在回收站里（软删除）。
 *
 * 与 `ipc/bookmarks.ts` 的 `isDeleted` **同一口径**（只有非空字符串才算已删除），
 * 但这里刻意内联而不是 import：`ipc/bookmarks.ts` 是个大模块（注册全部书签通道），
 * 为一个谓词把它整个拖进死链检查的依赖里没有收益；而 `StoredBookmark` 带索引签名
 * （`[key: string]: unknown`），也不适合直接套用那边的泛型签名。
 */
function isTrashed(bookmark: StoredBookmark): boolean {
  const { deletedAt } = bookmark
  return typeof deletedAt === 'string' && deletedAt !== ''
}

/** 同一时刻只允许一轮检查：渲染层按钮会禁用，这里是主进程侧的最后一道闸 */
let isChecking = false

export function registerLinkHandlers(): void {
  /**
   * 死链检查：**一次读盘 + 一次写盘**，中间只做网络探测。
   *
   * - `ids` 省略 = 检查全部书签；给了 ids 就只检查匹配项（去重，不存在的 id 直接忽略）；
   * - 目标为空时**不写盘**，返回全 0 与空数组（避免「书签为空」也重写一次文件）；
   * - 本轮结果共用同一个 `checkedAt`；
   * - 失败统一抛 `Failed to check links`：渲染层只需要一条 `message.linkCheckFailed`。
   */
  ipcMain.handle('check-links', async (_, ids?: string[]): Promise<LinkCheckResult> => {
    if (isChecking) {
      // 防御性闸门：即使渲染层绕过按钮禁用（双击/多窗口），也不会出现两轮并发写盘
      console.warn('[check-links] Rejected: a link check is already running')
      throw new Error('Link check already in progress')
    }

    isChecking = true
    try {
      const bookmarks = getBookmarks()

      const requestedIds = Array.isArray(ids) ? dedupeIds(ids) : null
      const idFilter = requestedIds ? new Set(requestedIds) : null
      // 只检查**未删除**的记录：回收站里的书签不该再产生网络请求，
      // 也不该被写回新的 linkStatus（它们对用户不可见，检查结果没有意义）。
      const targets = (idFilter ? bookmarks.filter(bookmark => idFilter.has(bookmark.id)) : bookmarks)
        .filter(bookmark => !isTrashed(bookmark))

      if (targets.length === 0) {
        console.log('[check-links] No bookmarks to check')
        return { checked: 0, broken: 0, unknown: 0, ok: 0, bookmarks: [] }
      }

      const checkedAt = new Date().toISOString()

      const results = await runWithConcurrency(
        targets,
        CHECK_CONCURRENCY,
        async (bookmark): Promise<{ id: string; linkStatus: LinkStatus }> => ({
          id: bookmark.id,
          linkStatus: mergeLinkStatus(bookmark.id, await probeUrl(bookmark.url), checkedAt)
        })
      )

      // 脏数据里同一 id 可能出现多次：按 id 建索引，写盘时所有同 id 条目一起更新
      const statusById = new Map(results.map(item => [item.id, item.linkStatus] as const))

      const updated: StoredBookmark[] = []
      const merged = bookmarks.map(bookmark => {
        const linkStatus = statusById.get(bookmark.id)
        if (!linkStatus) return bookmark
        const next: StoredBookmark = { ...bookmark, linkStatus }
        updated.push(next)
        return next
      })

      // ---- 唯一一次写盘 ----
      if (!saveBookmarks(merged)) {
        throw new Error('saveBookmarks returned false')
      }

      const summary = { ok: 0, broken: 0, unknown: 0 }
      for (const item of results) {
        if (item.linkStatus.ok === true) summary.ok += 1
        else if (item.linkStatus.ok === false) summary.broken += 1
        else summary.unknown += 1
      }

      console.log(
        `[check-links] Checked ${results.length} link(s): ` +
          `${summary.ok} ok, ${summary.broken} broken, ${summary.unknown} unknown`
      )

      return {
        checked: results.length,
        broken: summary.broken,
        unknown: summary.unknown,
        ok: summary.ok,
        bookmarks: updated
      }
    } catch (error) {
      console.error('[check-links] Failed to check links:', error)
      throw new Error('Failed to check links')
    } finally {
      isChecking = false
    }
  })
}
