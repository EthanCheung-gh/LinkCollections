/**
 * 关键词高亮工具。
 *
 * 安全约定（A1）：本模块的输出会被 7 处 `v-html` 直接渲染
 * （`ListView.vue:58,63,77,98`、`BookmarkCard.vue:35,40,45`），
 * 因此返回的字符串必须是「可信 HTML」：
 *   - 原文（用户输入 / 导入数据）中的 HTML 特殊字符一律做实体转义；
 *   - 唯一由本模块生成的标签是 `<mark>` 与其闭合标签。
 */

/** HTML 实体转义映射：覆盖 `& < > " '` 五个会改变 HTML 结构/属性的字符。 */
const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

const HTML_ESCAPE_RE = /[&<>"']/g

/**
 * 把纯文本转成可安全嵌入 HTML 的文本（HTML 实体转义）。
 *
 * 边界条件：
 * - 非字符串入参（`null` / `undefined` / 数字等，运行期数据可能不干净）一律返回 `''`，
 *   绝不抛错，因为调用方在 render 中执行。
 * - 只转义结构相关的 5 个字符；已存在的实体（如字面量 `&amp;`）会被二次转义为
 *   `&amp;amp;`，这是正确行为——对 HTML 来说它本来就只是文本 `&amp;`。
 */
export function escapeHtml(text: string): string {
  if (typeof text !== 'string') return ''
  return text.replace(HTML_ESCAPE_RE, char => HTML_ESCAPES[char] ?? char)
}

/**
 * 高亮 `text` 中与 `query` 匹配的片段，返回**已转义**的 HTML 字符串。
 *
 * 实现思路（避免「先转义再定位」导致的下标漂移）：
 * 1. 在**原始文本**上用大小写不敏感的正则找出所有匹配区间（`matchAll`）；
 * 2. 以匹配区间为界把原文切成「未命中段」与「命中段」；
 * 3. 对每个片段**分别**做 HTML 实体转义，命中段外层包 `<mark>`；
 * 4. 拼接输出。因为切分基于原文下标、转义只作用于片段内部，
 *    所以转义后长度变化不会影响高亮位置。
 *
 * 边界条件：
 * - `query` 非字符串、为 `''` 或全为空白 → 不高亮，但仍返回转义后的全文
 *   （原实现直接返回原文，会把 HTML 漏给 `v-html`）。
 * - `text` 非字符串 / 为空 → 返回 `''`。
 * - `query` 中的正则元字符（如 `a(b`、`[`、`\`）会被转义，不会抛错或改变匹配语义。
 * - `query` 内含 `<script>` 等标签时，匹配到的内容来自原文并被转义，
 *   输出只会是 `<mark>&lt;script&gt;</mark>`。
 * - 超长 `query` 只是匹配不到，不会破坏输出结构，也不会截断原文。
 * - 匹配结果不会产生嵌套或未闭合标签：`<mark>` 只包住单个片段。
 *
 * @param text 原始文本（未转义，可能包含恶意 HTML）
 * @param query 搜索关键词（未经转义的用户输入）
 * @returns 可直接交给 `v-html` 的 HTML 字符串
 */
export function highlightText(text: string, query: string): string {
  const source = typeof text === 'string' ? text : ''
  // 无关键词时也必须转义，否则 `v-html` 仍会执行原文中的标签。
  if (typeof query !== 'string' || !query.trim() || !source) {
    return escapeHtml(source)
  }

  const regex = new RegExp(escapeRegExp(query), 'gi')
  const segments: string[] = []
  let cursor = 0

  for (const match of source.matchAll(regex)) {
    const index = match.index
    const matched = match[0]
    // 正则由非空字面量构造，理论上不会出现零宽匹配；这里防御性跳过。
    if (index === undefined || matched.length === 0) continue

    segments.push(escapeHtml(source.slice(cursor, index)))
    segments.push(`<mark>${escapeHtml(matched)}</mark>`)
    cursor = index + matched.length
  }

  // 无任何命中（例如超长关键词）时等价于「整段转义」，输出依然安全。
  segments.push(escapeHtml(source.slice(cursor)))
  return segments.join('')
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
