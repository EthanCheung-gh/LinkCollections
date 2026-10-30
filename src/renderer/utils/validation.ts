/**
 * 表单 / 数据校验工具。
 *
 * 本轮变更（见 `.openbitfun/analysis/bug-audit.md`）：
 * - B11：新增 `normalizeUrl()`，`isValidUrl()` 改为基于归一化结果判断且只接受 http/https。
 * - A3：移除 `validateBookmarkData()` 中「Folder is required」，
 *   `folderId === ''` 表示「未分类」，是合法状态。
 */

/** 唯一允许的两种协议（大小写由 `URL.protocol` 保证为小写）。 */
const HTTP_PROTOCOLS = ['http:', 'https:']

/** 形如 `scheme:` 的前缀（RFC 3986），用于识别「用户已写了协议」。 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/**
 * 形如 `host:port` 的前缀，用于把 `example.com:8080`、`localhost:3000`
 * 与 `javascript:alert(1)` 这类「无斜杠协议」区分开（前者应补 https）。
 */
const HOST_WITH_PORT_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?:\d{1,5}(?:[/?#]|$)/i

const tryParseUrl = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * 主机名是否可信。
 *
 * 必须单独判断的原因：Chromium 与 Node 对 `new URL()` 的宽容度不同 ——
 * `new URL('https://not a url')` 在 Node 里抛错，但在 Chromium 里**成功**，
 * 主机名被百分号编码成 `not%20a%20url`。只依赖 `new URL()` 会让
 * 「带空格的假主机名」通过校验（实测能把 `not a url` 存成一条书签）。
 *
 * 规则：
 * - 空主机名不可信；
 * - 含 `%`（主机名里的百分号编码只可能来自非法字符）不可信；
 * - 含空格/制表符等空白不可信；
 * - 其余放行：国际化域名已被 `URL` 转成 punycode（`xn--…`），IPv6 形如 `[::1]`。
 */
export const isTrustworthyHostname = (hostname: string): boolean => {
  if (!hostname) return false
  if (hostname.includes('%')) return false
  return !/\s/.test(hostname)
}

const isHttpUrl = (url: URL): boolean =>
  HTTP_PROTOCOLS.includes(url.protocol) && isTrustworthyHostname(url.hostname)

/**
 * 把用户输入的 URL 归一化成可直接存储/打开的形式。
 *
 * 规则（按顺序）：
 * 1. 非字符串入参 → `''`；首尾空白会被去掉；去空白后为空 → `''`。
 * 2. `host:port...` 形式（`example.com:8080/x`、`localhost:3000`）视为**无协议**，补 `https://`。
 * 3. 已带协议（`scheme:` 形式，且不是 `host:port`）→ **一律原样返回**：
 *    - `http(s)://…` 本身已是目标形态；
 *    - 其它协议（`ftp:` `file:` `mailto:` `javascript:` `data:` …）同样原样返回，
 *      由 `isValidUrl()` 拒绝——本函数**绝不**把这类输入改写成看似合法的 http(s) URL；
 *    - 不可解析（如 `http://`）也是原样返回，同样由 `isValidUrl()` 拒绝。
 * 4. 无协议：
 *    - 以 `//` 开头（协议相对）→ 补 `https:`；
 *    - 其它 → 补 `https://`。
 *    补完仍无法解析为 http/https（如 `exa mple.com`、`http://`）→ 返回去空白后的原文。
 *
 * 边界条件：
 * - 不抛错，任何输入都返回字符串。
 * - 不做 URL 规范化（不补尾斜杠、不转小写、不做百分号编码）：
 *   返回「加了协议头的用户输入」或「原样输入」，避免展示层出现意外改写。
 * - 只保证「是否是 http/https 绝对 URL」这一件事；
 *   主机是否存在、能否访问不在本函数职责内。
 *
 * @param raw 用户原始输入（可能带空白、缺协议、带其它协议）
 * @returns 归一化后的 URL 字符串；不可用时返回原文或 `''`，交由 `isValidUrl()` 判定
 */
export function normalizeUrl(raw: string): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim()
  if (!trimmed) return ''

  // 已带协议：不做任何改写（非 http(s) 或不可解析时同样原样返回，由 isValidUrl 拒绝），
  // 这样 `javascript:` / `file:` 之类绝不会被「补协议」清洗成看似合法的 http URL。
  if (SCHEME_RE.test(trimmed) && !HOST_WITH_PORT_RE.test(trimmed)) return trimmed

  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : `https://${trimmed}`
  const parsed = tryParseUrl(candidate)
  if (!parsed || !isHttpUrl(parsed)) return trimmed
  return candidate
}

/**
 * 判断一个字符串是否是可用的书签 URL（`http` / `https` 绝对 URL）。
 *
 * 边界条件：
 * - 入参先经 `normalizeUrl()`，因此 `example.com` 视为合法（B11）。
 * - 非字符串 / 空串 / 仅空白 → `false`。
 * - 非 http(s) 协议（`ftp:` `file:` `mailto:` `javascript:` `data:` …）→ `false`。
 * - 缺少主机名（如 `https://`）→ `false`。
 * - 不抛错。
 */
export const isValidUrl = (url: string): boolean => {
  if (typeof url !== 'string' || !url.trim()) return false
  const normalized = normalizeUrl(url)
  if (!normalized) return false
  const parsed = tryParseUrl(normalized)
  return parsed !== null && isHttpUrl(parsed)
}

export const isValidColor = (color: string): boolean => {
  if (!color) return false
  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
  return hexColorRegex.test(color)
}

export const validateRequired = (value: any, fieldName: string): void => {
  if (value === null || value === undefined || value === '') {
    throw new Error(`${fieldName} is required`)
  }
}

/**
 * 书签数据的二次校验。
 *
 * A3：`folderId` 为空（`''` / 未提供）表示「未分类」，是合法状态，
 * 因此不再产生 `Folder is required`。本函数拿不到文件夹列表，
 * 也无法校验「引用的文件夹是否存在」——那属于主进程 / store 的职责。
 *
 * 返回结构保持 `{ valid, errors }` 不变。
 */
export const validateBookmarkData = (bookmark: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  if (!bookmark.url) {
    errors.push('URL is required')
  } else if (!isValidUrl(bookmark.url)) {
    errors.push('Invalid URL format')
  }

  if (!bookmark.title || bookmark.title.trim() === '') {
    errors.push('Title is required')
  }

  if (bookmark.color && !isValidColor(bookmark.color)) {
    errors.push('Invalid color format')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

export const validateFolderData = (folder: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  if (!folder.name || folder.name.trim() === '') {
    errors.push('Folder name is required')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

export const validateTagData = (tag: any): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  if (!tag.name || tag.name.trim() === '') {
    errors.push('Tag name is required')
  }

  if (!tag.color || !isValidColor(tag.color)) {
    errors.push('Valid color is required')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}
