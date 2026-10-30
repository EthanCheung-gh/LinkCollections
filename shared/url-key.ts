/**
 * URL 去重键 —— **跨进程共享的唯一实现**。
 *
 * 两份消费方：
 *  - 主进程导入去重（`electron/ipc/import-export.ts` 的 `buildUrlIndex`）；
 *  - 重复书签检测（主进程 `merge-duplicates` 与渲染层预览共用 `shared/duplicates.ts`）。
 *
 * 为什么必须共享：导入去重与「重复检测」必须给同一个 URL 判出同一个键，否则
 * 「导入时被判为重复而跳过」的书签会在合并预览里看不见，反之亦然。此前该函数是
 * `import-export.ts` 的私有实现，现在原样搬到这里，语义**一字未改**。
 *
 * 归一化规则（按顺序）：
 *  1. 只接受字符串（`null` / `undefined` / 数字…一律返回空串，调用方据此跳过分组）；
 *  2. `trim()` 后为空 → 空串；
 *  3. **补协议**：字符串里没有 `scheme:` 前缀时按 `https://` 补全（`example.com` →
 *     `https://example.com`）；已有协议（`http:` / `file:` / 自定义 scheme）原样保留；
 *  4. 交给 `new URL()` 解析，键 = `protocol + '//' + host(小写) + pathname(去尾部斜杠)
 *     + search + hash`：
 *     - `protocol` 保留原样（**http 与 https 因此是两个不同的键**）；
 *     - `host` 统一小写（`Example.COM` 与 `example.com` 同键）；
 *     - `pathname` 只裁掉尾部斜杠（`/a/` → `/a`、`/` → 空），大小写不敏感化**不做**；
 *     - `search` / `hash` 原样保留（query 不同即不同键）；
 *  5. **解析失败时退化**为「去掉尾部斜杠 + 整体小写」的朴素字符串比较，
 *     保证脏数据（含空格、中文、缺 host 等）也能得到稳定、可复现的键而不是抛错。
 *
 * 例：
 *  - `Example.COM` → `https://example.com`
 *  - `https://example.com/` → `https://example.com`
 *  - `https://example.com/a/?x=1#y` → `https://example.com/a?x=1#y`
 *  - `not a url` → `not a url`（解析失败，退化为小写比较）
 */
export function normalizeUrlKey(value: unknown): string {
  if (typeof value !== 'string') return ''

  const input = value.trim()
  if (!input) return ''

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(input) ? input : `https://${input}`

  try {
    const parsed = new URL(candidate)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return input.replace(/\/+$/, '').toLowerCase()
  }
}
