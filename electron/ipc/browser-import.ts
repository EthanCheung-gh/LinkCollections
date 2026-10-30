import { ipcMain } from 'electron'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isChromiumBookmarks, parseChromiumBookmarks } from '../../shared/chromium-bookmarks'
import {
  applyImportedData,
  type ImportedBookmarkSource,
  type ImportedFolderSource
} from './import-export'

/**
 * 浏览器书签文件直读导入（**仅 Chromium 家族**）。
 *
 * 为什么只做 Chromium：Chrome / Edge / Brave / Chromium 把书签存成
 * `…/User Data/<Profile>/Bookmarks`（纯 JSON），可以直接 `fs.readFileSync` 解析；
 *  - Firefox 的 `places.sqlite` 需要 SQLite 原生依赖（会给打包/ABI 带来一整套麻烦）；
 *  - Safari 的 `Bookmarks.plist` 是二进制 plist。
 * 这两者**有意不实现**，UI 与注释里都提示用户改用「导出 HTML → 用 HTML 导入」。
 *
 * 安全边界（渲染进程不可信）：
 *  1. 渲染层**不能**让主进程读任意文件。只有本模块自己扫描出来的路径才会进入
 *     `detectedPaths` 白名单（见 {@link detectBrowserBookmarks}），导入时要求路径命中白名单；
 *  2. 读取前再 `statSync` 复核「确实存在、确实是文件、确实小于 20MB」——
 *     探测与导入之间文件可能被替换/删除/塞成巨大文件；
 *  3. 解析结果必须通过 `isChromiumBookmarks` 形状校验，否则拒绝。
 */

/** 单个 `Bookmarks` 文件的读取上限：超过直接跳过（正常文件是几百 KB 级） */
export const MAX_BOOKMARKS_FILE_BYTES = 20 * 1024 * 1024

/** Chromium 家族统一的书签名（位于每个 profile 目录下） */
export const BOOKMARKS_FILE_NAME = 'Bookmarks'

/** 一个浏览器根目录：其下每个子目录都是一个 profile（`Default` / `Profile 1` …） */
export interface ChromiumBookmarkRoot {
  /** 展示用浏览器名（Chrome / Microsoft Edge / Brave / Chromium） */
  browser: string
  /** 包含各 profile 子目录的目录（Windows 上是 `…\User Data`） */
  rootPath: string
}

/** 探测结果里的一项（发给渲染层；`id` 是路径的稳定哈希，避免渲染层自己从路径推导身份） */
export interface BrowserBookmarkCandidate {
  /** 路径的稳定哈希（sha256 前 16 位十六进制） */
  id: string
  browser: string
  /** profile 目录名（`Default` / `Profile 1` …） */
  profile: string
  /** 书签文件绝对路径（**仅供展示与回传**，渲染层不得据此做任何逻辑判断） */
  path: string
  bookmarkCount: number
  folderCount: number
  /** 文件最后修改时间（ISO）；`stat` 异常时为 null */
  modifiedAt: string | null
}

export interface BrowserBookmarkDetection {
  success: boolean
  candidates: BrowserBookmarkCandidate[]
  error?: string
}

/** `import-browser-bookmarks` 的返回：与 `import-data` 的返回体保持一致 */
export interface BrowserBookmarkImportResult {
  success: boolean
  imported: { bookmarks: number; folders: number; tags: number }
  skipped: number
  errors: string[]
  error?: string
}

/** 根目录表：`base` 表示用哪个基准目录拼接，`segments` 是相对片段 */
interface RootSpec {
  browser: string
  base: 'localAppData' | 'home'
  segments: string[]
}

/**
 * 平台根目录表。
 *
 * - Windows：`%LOCALAPPDATA%\<厂商>\<产品>\User Data`（Edge 是 `Microsoft\Edge\User Data`）；
 * - macOS：`~/Library/Application Support/<厂商>/<产品>`（Edge 目录名带空格、无厂商层级）；
 * - Linux：`~/.config/<产品目录>`（Brave 多一层 `BraveSoftware/Brave-Browser`）。
 *
 * 只列**已知**安装位置：用户把浏览器装到自定义目录时探测不到，回退方案仍是导出 HTML。
 */
const PLATFORM_ROOTS: Record<'win32' | 'darwin' | 'linux', RootSpec[]> = {
  win32: [
    { browser: 'Chrome', base: 'localAppData', segments: ['Google', 'Chrome', 'User Data'] },
    { browser: 'Microsoft Edge', base: 'localAppData', segments: ['Microsoft', 'Edge', 'User Data'] },
    {
      browser: 'Brave',
      base: 'localAppData',
      segments: ['BraveSoftware', 'Brave-Browser', 'User Data']
    },
    { browser: 'Chromium', base: 'localAppData', segments: ['Chromium', 'User Data'] }
  ],
  darwin: [
    { browser: 'Chrome', base: 'home', segments: ['Library', 'Application Support', 'Google', 'Chrome'] },
    { browser: 'Microsoft Edge', base: 'home', segments: ['Library', 'Application Support', 'Microsoft Edge'] },
    {
      browser: 'Brave',
      base: 'home',
      segments: ['Library', 'Application Support', 'BraveSoftware', 'Brave-Browser']
    },
    { browser: 'Chromium', base: 'home', segments: ['Library', 'Application Support', 'Chromium'] }
  ],
  linux: [
    { browser: 'Chrome', base: 'home', segments: ['.config', 'google-chrome'] },
    { browser: 'Chromium', base: 'home', segments: ['.config', 'chromium'] },
    { browser: 'Microsoft Edge', base: 'home', segments: ['.config', 'microsoft-edge'] },
    { browser: 'Brave', base: 'home', segments: ['.config', 'BraveSoftware', 'Brave-Browser'] }
  ]
}

export interface ChromiumRootOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

/**
 * 按平台推导候选根目录（**不触碰文件系统**，因此可以直接断言路径表）。
 *
 * 非 win32/darwin 一律按 Linux 处理（`freebsd` 等平台的浏览器同样用 `~/.config`）；
 * `%LOCALAPPDATA%` 缺失时退化为 `~/AppData/Local`（服务账号/精简环境下常见）。
 */
export function getChromiumBookmarkRoots(options: ChromiumRootOptions = {}): ChromiumBookmarkRoot[] {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()

  const key: 'win32' | 'darwin' | 'linux' =
    platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux'

  const localAppData =
    typeof env.LOCALAPPDATA === 'string' && env.LOCALAPPDATA.trim() !== ''
      ? env.LOCALAPPDATA
      : path.join(homeDir, 'AppData', 'Local')

  return PLATFORM_ROOTS[key].map(spec => ({
    browser: spec.browser,
    rootPath: path.join(spec.base === 'localAppData' ? localAppData : homeDir, ...spec.segments)
  }))
}

/** 白名单比较键：Windows 路径大小写不敏感 */
function toPathKey(filePath: string): string {
  const resolved = path.resolve(filePath)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/** 候选 id：路径的稳定哈希（同一文件每次探测都得到同一个 id） */
function createCandidateId(filePath: string): string {
  return createHash('sha256').update(toPathKey(filePath)).digest('hex').slice(0, 16)
}

/**
 * 已探测到的路径白名单（模块级）。
 *
 * 每次 `detectBrowserBookmarks()` 会**整体重建**它：白名单只代表「最近一次探测的结果」，
 * 用户关掉弹窗再打开会重新探测，因此不存在「很久以前探测过、文件早已不存在」的陈旧条目。
 */
let detectedPaths = new Set<string>()

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

/** 日志统一前缀：探测失败是**预期内**的（没装某个浏览器），只记录不抛错 */
function warn(message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(`[browser-import] ${message}`)
    return
  }
  console.warn(`[browser-import] ${message}`, error)
}

interface ProfileBookmarkFile {
  profile: string
  filePath: string
  size: number
  modifiedAt: string | null
}

/**
 * 列出一个浏览器根目录下所有「含 Bookmarks 文件的 profile」。
 *
 * 容错：
 *  - 根目录不存在 / 无权限 → 返回空数组（只记一条 warn，不区分二者：
 *    对用户来说结论一样是「这里没有可导入的书签」）；
 *  - 子目录不是 profile（`Crashpad` / `ShaderCache` …）→ 没有 Bookmarks 文件，跳过；
 *  - `statSync` 失败（悬空符号链接等）→ 跳过。
 */
function listProfileBookmarkFiles(rootPath: string): ProfileBookmarkFile[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(rootPath, { withFileTypes: true })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      warn(`Cannot read browser directory: ${rootPath}`, error)
    }
    return []
  }

  const files: ProfileBookmarkFile[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const filePath = path.join(rootPath, entry.name, BOOKMARKS_FILE_NAME)
    try {
      const stats = fs.statSync(filePath)
      if (!stats.isFile()) continue
      const modifiedAt = Number.isFinite(stats.mtimeMs)
        ? new Date(stats.mtimeMs).toISOString()
        : null
      files.push({ profile: entry.name, filePath, size: stats.size, modifiedAt })
    } catch {
      // 没有 Bookmarks 文件（绝大多数子目录）或无法 stat：都不是候选
      continue
    }
  }

  // `Default` 在前，`Profile 2` 排在 `Profile 10` 之前（numeric 比较）
  files.sort((a, b) => a.profile.localeCompare(b.profile, undefined, { numeric: true }))
  return files
}

export interface DetectBrowserBookmarksOptions extends ChromiumRootOptions {
  /** 覆盖根目录表（测试用）；默认按平台推导 */
  roots?: ChromiumBookmarkRoot[]
  /** 覆盖单文件大小上限（测试用）；默认 {@link MAX_BOOKMARKS_FILE_BYTES} */
  maxBytes?: number
}

/**
 * 探测本机所有可导入的 Chromium 书签文件。
 *
 * **永不抛错**：目录不存在、无权限、文件损坏、文件超大、多 profile 都只是「少一个候选」。
 * 侧效应：把本次探测到的路径写入白名单（导入时据此拒绝任意路径）。
 */
export function detectBrowserBookmarks(
  options: DetectBrowserBookmarksOptions = {}
): BrowserBookmarkCandidate[] {
  const roots = options.roots ?? getChromiumBookmarkRoots(options)
  const maxBytes = options.maxBytes ?? MAX_BOOKMARKS_FILE_BYTES

  const candidates: BrowserBookmarkCandidate[] = []
  const allowed = new Set<string>()

  for (const root of roots) {
    for (const profileFile of listProfileBookmarkFiles(root.rootPath)) {
      if (profileFile.size > maxBytes) {
        warn(
          `Skipping ${profileFile.filePath}: file is ${profileFile.size} bytes, ` +
            `larger than the ${maxBytes} bytes limit`
        )
        continue
      }

      let parsed: unknown
      try {
        const raw = fs.readFileSync(profileFile.filePath, 'utf-8')
        parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
      } catch (error) {
        warn(`Skipping ${profileFile.filePath}: not valid JSON`, error)
        continue
      }

      if (!isChromiumBookmarks(parsed)) {
        warn(`Skipping ${profileFile.filePath}: not a Chromium bookmarks file`)
        continue
      }

      // 用真实解析结果计数（而不是另写一套计数逻辑）：UI 显示的条数与导入落盘条数同源
      const { bookmarks, folderPaths } = parseChromiumBookmarks(parsed)

      candidates.push({
        id: createCandidateId(profileFile.filePath),
        browser: root.browser,
        profile: profileFile.profile,
        path: profileFile.filePath,
        bookmarkCount: bookmarks.length,
        folderCount: folderPaths.length,
        modifiedAt: profileFile.modifiedAt
      })

      allowed.add(toPathKey(profileFile.filePath))
    }
  }

  detectedPaths = allowed
  return candidates
}

/** 把解析结果转成共享导入核心的数据形状（文件夹路径 → 树；id 只在本批数据内有效） */
function toImportedDataSource(
  bookmarks: Array<{ url: string; title: string; createdAt: string; folderPath: string[] }>,
  folderPaths: string[][]
): { bookmarks: ImportedBookmarkSource[]; folders: ImportedFolderSource[]; tags: [] } {
  const folderPathKey = (folderPath: string[]): string => JSON.stringify(folderPath)

  const folders: ImportedFolderSource[] = []
  const knownPaths = new Set<string>()

  // 逐段展开每条路径前缀：父路径一定先于子路径登记，核心映射 parentId 时父级已处理
  for (const folderPath of folderPaths) {
    for (let depth = 1; depth <= folderPath.length; depth += 1) {
      const prefix = folderPath.slice(0, depth)
      const key = folderPathKey(prefix)
      if (knownPaths.has(key)) continue

      const parentPrefix = prefix.slice(0, -1)
      knownPaths.add(key)
      folders.push({
        // 源 id 只需要「在本批数据内唯一且能表达父子关系」，不必是 uuid
        id: key,
        name: prefix[prefix.length - 1],
        parentId: parentPrefix.length > 0 ? folderPathKey(parentPrefix) : null,
        order: folders.length
      })
    }
  }

  return {
    folders,
    // Chromium 书签没有标签，`tags: []`：replace 模式因此会清空标签库（与 HTML 导入一致）
    tags: [],
    bookmarks: bookmarks.map(bookmark => ({
      url: bookmark.url,
      title: bookmark.title,
      description: '',
      folderId: bookmark.folderPath.length > 0 ? folderPathKey(bookmark.folderPath) : '',
      tags: [],
      // Chromium 文件不携带访问次数/最近访问时间/置顶状态
      visitCount: 0,
      lastVisited: null,
      pinned: false,
      // 微秒级 `date_added` 已由解析层转成 ISO
      createdAt: bookmark.createdAt
    }))
  }
}

/** 失败返回（shape 与 `import-data` 对齐：调用方只需看 `success` + `error`） */
function failure(error: string): BrowserBookmarkImportResult {
  return {
    success: false,
    imported: { bookmarks: 0, folders: 0, tags: 0 },
    skipped: 0,
    errors: [error],
    error
  }
}

export function registerBrowserImportHandlers(): void {
  ipcMain.handle('detect-browser-bookmarks', (): BrowserBookmarkDetection => {
    try {
      return { success: true, candidates: detectBrowserBookmarks() }
    } catch (error) {
      // 探测内部已逐项容错，这里只兜底「连根目录表都算不出来」这种不可能的情况
      console.error('[browser-import] Detection failed:', error)
      return { success: false, candidates: [], error: toErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'import-browser-bookmarks',
    (_, request: { path?: unknown; mergeMode?: unknown } | undefined): BrowserBookmarkImportResult => {
      try {
        const requestedPath = typeof request?.path === 'string' ? request.path.trim() : ''
        const mergeMode = request?.mergeMode === 'replace' ? 'replace' : 'merge'

        if (!requestedPath) {
          return failure('No bookmark file path provided')
        }

        // ① 路径白名单：只允许本次探测发现过的文件，渲染层无法借此读取任意文件
        if (!path.isAbsolute(requestedPath) || !detectedPaths.has(toPathKey(requestedPath))) {
          console.error('[browser-import] Rejected path that was not detected:', requestedPath)
          return failure('Bookmark file path was not produced by browser detection')
        }

        // ② 读取前复核：确实是文件且没有超过大小上限
        let stats: fs.Stats
        try {
          stats = fs.statSync(requestedPath)
        } catch (error) {
          console.error('[browser-import] Bookmark file is no longer readable:', error)
          return failure('Bookmark file is no longer readable')
        }

        if (!stats.isFile()) {
          return failure('Bookmark path does not point to a file')
        }

        if (stats.size > MAX_BOOKMARKS_FILE_BYTES) {
          return failure(
            `Bookmark file is larger than the ${MAX_BOOKMARKS_FILE_BYTES} bytes limit`
          )
        }

        // ③ 形状校验 + 解析
        const raw = fs.readFileSync(requestedPath, 'utf-8')
        let parsed: unknown
        try {
          parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
        } catch (error) {
          console.error('[browser-import] Bookmark file is not valid JSON:', error)
          return failure('Bookmark file is not valid JSON')
        }

        if (!isChromiumBookmarks(parsed)) {
          return failure('Not a Chromium bookmarks file')
        }

        const { bookmarks, folderPaths } = parseChromiumBookmarks(parsed)

        // ④ 写库统一走共享核心（与 JSON / HTML 导入同一套去重、id 重映射、事务回滚）
        const { imported, skipped } = applyImportedData(toImportedDataSource(bookmarks, folderPaths), {
          merge: mergeMode === 'merge',
          preserveFolderHierarchy: true
        })

        return { success: true, imported, skipped, errors: [] }
      } catch (error) {
        console.error('[browser-import] Import failed:', error)
        return failure(toErrorMessage(error))
      }
    }
  )
}
