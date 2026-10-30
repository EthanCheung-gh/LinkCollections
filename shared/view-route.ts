/**
 * 视图路由判定（渲染层 + 单测共用；主进程不依赖它，但放在 `shared/` 便于一处修改两处生效）。
 *
 * 应用只有一张 `index.html`，通过查询参数区分子视图：
 * - `?view=quickadd` → 快速添加浮窗（挂载 `QuickAdd.vue`）；
 * - 其余（含空串）→ 主窗口（挂载 `App.vue`）。
 *
 * 为什么抽成纯函数：`location.search` 的解析很容易写歪（有没有前导 `?`、
 * `&` 分隔、`#` 之后再出现参数、百分号编码），主进程 `loadFile(..., { search })`
 * 与渲染层判定必须对同一个字符串得出同一个结论，因此实现只留一份并有直接单测。
 */

/** 视图查询参数的键名 */
export const VIEW_PARAM = 'view'

/** 快速添加浮窗的视图值 */
export const QUICK_ADD_VIEW = 'quickadd'

/**
 * 快速添加浮窗的完整查询串。
 *
 * 主进程（`loadFile` 的 `search` / dev 环境的 `loadURL`）与渲染层判定共用这一个常量，
 * 避免两边字符串各写一份后拼错（例如少写 `?`）。
 */
export const QUICK_ADD_SEARCH = `?${VIEW_PARAM}=${QUICK_ADD_VIEW}`

/** `decodeURIComponent` 对孤立 `%` 会抛错：解析查询串不应该因此失败，退回原文。 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * 判断给定的查询串是否表示「快速添加浮窗」视图。
 *
 * 入参接受三种形态（都视为等价）：
 * - `location.search`：`'?view=quickadd'`
 * - 裸查询串：`'view=quickadd&x=1'`
 * - `location.hash` 片段：`'#view=quickadd'`
 *
 * 边界条件：
 * - 非字符串 / 空串 / 仅空白 → `false`；
 * - 键名与值都做一次百分号解码（`view=quick%61dd` 也算命中）；
 * - 只认 `view` 键，`?other=1`、`?view=app`、`?view=quickadd2` → `false`；
 * - 不抛错。
 */
export function isQuickAddView(search: string): boolean {
  if (typeof search !== 'string') return false

  const trimmed = search.trim()
  if (!trimmed) return false

  // 去掉前导 `?` / `#`，并丢弃 `#` 之后的片段
  const query = trimmed.replace(/^[?#]+/, '').split('#')[0] ?? ''
  if (!query) return false

  for (const segment of query.split('&')) {
    if (!segment) continue

    const separator = segment.indexOf('=')
    const key = separator === -1 ? segment : segment.slice(0, separator)
    const value = separator === -1 ? '' : segment.slice(separator + 1)

    if (safeDecode(key) === VIEW_PARAM && safeDecode(value) === QUICK_ADD_VIEW) {
      return true
    }
  }

  return false
}
