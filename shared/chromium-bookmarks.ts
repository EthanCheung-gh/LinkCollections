/**
 * Chromium 家族（Chrome / Edge / Brave / Chromium）书签文件解析 —— **纯函数，跨进程共享**。
 *
 * 为什么要「直读文件」：用户不必先在浏览器里「导出 HTML」再导入。
 * 只覆盖 Chromium 家族：它们把书签存成 **JSON**（`…/User Data/<Profile>/Bookmarks`）。
 *  - Firefox 用 `places.sqlite`（需要 SQLite 原生依赖）；
 *  - Safari 用二进制 plist（需要 plist 解析）。
 * 这两类**有意不做**，UI 里明确提示用户改用「导出 HTML → 用 HTML 导入」。
 *
 * 文件结构（Chromium 稳定多年，未随版本变化）：
 * ```
 * {
 *   "roots": {
 *     "bookmark_bar": { "type": "folder", "name": "Bookmarks bar", "children": [ … ] },
 *     "other":        { "type": "folder", "name": "Other bookmarks", "children": [ … ] },
 *     "synced":       { "type": "folder", "name": "Mobile bookmarks", "children": [ … ] }
 *   },
 *   "version": 1
 * }
 * ```
 * 节点：`{ type: 'url' | 'folder', name, url?, children?, date_added? }`。
 *
 * 关键约定：
 *  1. `roots` 里那三个根节点**本身不是文件夹**（它们是「书签栏 / 其它书签 / 移动设备书签」
 *     这三个固定分区），因此它们的 `children` 直接作为顶层，不进入 `folderPath`；
 *  2. `type === 'url'` 且 `url` 非空才算书签；`type === 'folder'` 递归；其它 `type` 忽略；
 *  3. `folderPath` 用**名称数组**表示层级（`['工作', '文档']`），不生成任何 id ——
 *     id 由写库一侧（`electron/ipc/import-export.ts` 的 `applyImportedData`）负责生成，
 *     本模块保持「纯解析、零副作用」，因此可以直接在测试里断言。
 */

/** 解析出的一条书签（尚未分配 id / 文件夹 id） */
export interface ChromiumBookmark {
  url: string
  title: string
  /** ISO 时间字符串：来自 `date_added`，非法/缺失时退化为调用方传入的 `now` */
  createdAt: string
  /** 层级路径（名称数组，不含 `roots` 的三个根分区名）；顶层书签为 `[]` */
  folderPath: string[]
}

export interface ParsedChromiumBookmarks {
  bookmarks: ChromiumBookmark[]
  /** 出现过的全部文件夹路径（去重、按首次出现顺序，父路径一定排在子路径之前） */
  folderPaths: string[][]
}

/** 文件夹名缺失/空白时的兜底名称（Chromium 自己不会产出这种数据，属脏数据防御） */
export const UNNAMED_FOLDER_FALLBACK = 'Untitled'

/** 1601-01-01（Chromium `base::Time` 纪元）到 1970-01-01 的毫秒差 */
const WINDOWS_EPOCH_OFFSET_MS = 11_644_473_600_000

/** 一天的毫秒数（判断「时间戳是否落在未来」用） */
const DAY_MS = 86_400_000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * `date_added` → ISO。
 *
 * 语义：字符串形式的**微秒**时间戳（`'13298944339442817'`）。
 * 两个纪元都要处理：
 *  - 合成数据/测试常按「Unix 纪元微秒」写（`1700000000000000` → 2023-11-14）；
 *  - **真实 Chromium 文件**按 `base::Time` 的 1601 纪元微秒写（`13298944339442817` → 2022-06）。
 *
 * 做法是「先按 Unix 纪元解释，落不进合理区间（1970 之后、不晚于 now+1 天）再减去 1601→1970
 * 的固定偏移」。这样两类输入都得到正确日期，而垃圾输入（负数、非数字、荒谬的未来值）
 * 一律退化为 `now` —— 与既有 JSON 导入的 `createdAt: x || now` 口径一致。
 */
function toCreatedAt(value: unknown, nowIso: string, nowMs: number): string {
  const text =
    typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
  if (!text) return nowIso

  const micros = Number(text)
  if (!Number.isFinite(micros) || micros <= 0) return nowIso

  const asUnixMs = Math.floor(micros / 1000)
  const latest = nowMs + DAY_MS

  for (const candidate of [asUnixMs, asUnixMs - WINDOWS_EPOCH_OFFSET_MS]) {
    if (candidate >= 0 && candidate <= latest) {
      return new Date(candidate).toISOString()
    }
  }

  return nowIso
}

/** 文件夹名归一：缺失/空白走兜底，避免生成一个看不见名字的文件夹 */
function readName(value: unknown): string {
  if (typeof value !== 'string') return UNNAMED_FOLDER_FALLBACK
  const name = value.trim()
  return name === '' ? UNNAMED_FOLDER_FALLBACK : name
}

/** 路径去重键：名称里可能含任意字符，用 JSON 序列化而不是拼接分隔符 */
function pathKey(folderPath: string[]): string {
  return JSON.stringify(folderPath)
}

/**
 * 形状校验：`roots` 是对象，且其中**至少有一个** `type === 'folder'` 的根。
 *
 * 只做「是不是 Chromium 书签文件」这一层判断（足够把任意 JSON —— 包括本项目自己的
 * 导出文件 —— 挡在外面），不校验每个节点的合法性：脏节点由 `parseChromiumBookmarks`
 * 逐条容错，不因为一个坏节点就整份文件作废。
 */
export function isChromiumBookmarks(value: unknown): boolean {
  if (!isPlainObject(value)) return false

  const roots = value.roots
  if (!isPlainObject(roots)) return false

  return Object.values(roots).some(node => isPlainObject(node) && node.type === 'folder')
}

/**
 * 解析 Chromium 书签文件。
 *
 * @param json 已经 `JSON.parse` 的结果，或原始 JSON 字符串（解析失败按空结果处理，不抛错）
 * @param now  时间兜底（非法/缺失的 `date_added` 用它）；接受 `Date` 或 ISO 字符串
 */
export function parseChromiumBookmarks(
  json: unknown,
  now: Date | string = new Date()
): ParsedChromiumBookmarks {
  let parsed: unknown = json

  if (typeof json === 'string') {
    try {
      parsed = JSON.parse(json)
    } catch {
      return { bookmarks: [], folderPaths: [] }
    }
  }

  if (!isChromiumBookmarks(parsed)) {
    return { bookmarks: [], folderPaths: [] }
  }

  const nowDate = now instanceof Date ? now : new Date(now)
  const nowMs = Number.isFinite(nowDate.getTime()) ? nowDate.getTime() : Date.now()
  // 兜底时间本身也必须合法：`new Date(NaN).toISOString()` 会抛 RangeError
  const nowIso = new Date(nowMs).toISOString()

  const bookmarks: ChromiumBookmark[] = []
  const folderPaths: string[][] = []
  const seenPaths = new Set<string>()

  const registerPath = (folderPath: string[]): void => {
    const key = pathKey(folderPath)
    if (seenPaths.has(key)) return
    seenPaths.add(key)
    folderPaths.push([...folderPath])
  }

  /**
   * 递归处理某个节点的 `children`。`folderPath` 是**当前所在文件夹**的路径。
   *
   * 分三类：
   *  - `type === 'url'`：`url` 非空才算书签（空 url 的脏节点直接丢弃）；
   *  - `type === 'folder'`：登记路径后递归（路径登记在递归之前，父路径天然排在子路径之前）；
   *  - 其它 `type`（Chromium 目前没有，未来可能有）：忽略。
   */
  const walkChildren = (parent: Record<string, unknown>, folderPath: string[]): void => {
    const children = Array.isArray(parent.children) ? parent.children : []

    for (const child of children) {
      if (!isPlainObject(child)) continue

      if (child.type === 'url') {
        const url = typeof child.url === 'string' ? child.url.trim() : ''
        if (!url) continue

        const rawTitle = typeof child.name === 'string' ? child.name.trim() : ''
        bookmarks.push({
          url,
          // 标题缺失时退化为 URL，与既有 JSON/HTML 导入的 `title: x || url` 一致
          title: rawTitle === '' ? url : rawTitle,
          createdAt: toCreatedAt(child.date_added, nowIso, nowMs),
          folderPath: [...folderPath]
        })
        continue
      }

      if (child.type === 'folder') {
        const childPath = [...folderPath, readName(child.name)]
        registerPath(childPath)
        walkChildren(child, childPath)
      }
    }
  }

  // roots 的三个根分区本身不作为文件夹：直接把它们的 children 当作顶层处理
  const roots = (parsed as Record<string, unknown>).roots as Record<string, unknown>
  for (const root of Object.values(roots)) {
    if (!isPlainObject(root) || root.type !== 'folder') continue
    walkChildren(root, [])
  }

  return { bookmarks, folderPaths }
}
