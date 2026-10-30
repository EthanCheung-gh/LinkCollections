import { ipcMain, dialog, app } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'
import { readJsonFile, writeJsonFile } from '../utils/storage'
// URL 去重键的唯一实现放在 `shared/`：导入去重与「重复书签合并」必须用同一套归一化规则，
// 否则「导入时被判重而跳过」的 URL 在合并预览里会看不见（反之亦然）。
import { normalizeUrlKey } from '../../shared/url-key'
// replace 模式会丢弃全部旧书签，它们的访问历史必须一起清掉，并纳入同一个写入事务
import { restoreHistory, snapshotHistory } from './history'

const HISTORY_FILE = 'history.json'

interface Bookmark {
  id: string
  url: string
  title: string
  description: string
  favicon: string
  color: string
  folderId: string
  tags: string[]
  visitCount: number
  lastVisited: string | null
  /** 置顶标记：导入时脏值一律收敛为 false（与 ipc/bookmarks.ts 的口径一致） */
  pinned: boolean
  createdAt: string
  updatedAt: string
}

interface Folder {
  id: string
  name: string
  icon: string | null
  color: string
  createdAt: string
  order: number
  /**
   * 可选的上级目录 id。当前数据层不写入该字段（Folder 为扁平结构），
   * 但导出逻辑按「父级 id 为空/不存在即为根」处理，以便未来或外部数据
   * 携带层级时仍能完整导出全部后代，而不是静默丢弃。
   */
  parentId?: string | null
}

interface Tag {
  id: string
  name: string
  color: string
  createdAt: string
}

const BOOKMARKS_FILE = 'bookmarks.json'
const FOLDERS_FILE = 'folders.json'
const TAGS_FILE = 'tags.json'

const DEFAULT_COLOR = '#3B82F6'

function getBookmarks(): Bookmark[] {
  return readJsonFile<Bookmark[]>(BOOKMARKS_FILE, [])
}

function getFolders(): Folder[] {
  return readJsonFile<Folder[]>(FOLDERS_FILE, [])
}

function getTags(): Tag[] {
  return readJsonFile<Tag[]>(TAGS_FILE, [])
}

function saveBookmarks(bookmarks: Bookmark[]): boolean {
  return writeJsonFile(BOOKMARKS_FILE, bookmarks)
}

function saveFolders(folders: Folder[]): boolean {
  return writeJsonFile(FOLDERS_FILE, folders)
}

function saveTags(tags: Tag[]): boolean {
  return writeJsonFile(TAGS_FILE, tags)
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}

/**
 * 去重键：文件夹/标签名按「去首尾空白 + 大小写不敏感」归一化。
 */
function normalizeNameKey(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : ''
}

/**
 * URL 去重键：实现已抽到 `shared/url-key.ts`（导入去重与重复书签合并共用）。
 * 这里保留同名调用点，因此本文件其余逻辑一字未改。
 */
function buildUrlIndex(bookmarks: Array<{ url?: unknown }>): Set<string> {
  const index = new Set<string>()
  bookmarks.forEach(bookmark => {
    const key = normalizeUrlKey(bookmark?.url)
    if (key) index.add(key)
  })
  return index
}

function buildFolderNameIndex(folders: Folder[]): Map<string, string> {
  const index = new Map<string, string>()
  folders.forEach(folder => {
    const key = normalizeNameKey(folder?.name)
    if (key && !index.has(key) && typeof folder.id === 'string') {
      index.set(key, folder.id)
    }
  })
  return index
}

function buildTagNameIndex(tags: Tag[]): Map<string, string> {
  const index = new Map<string, string>()
  tags.forEach(tag => {
    const key = normalizeNameKey(tag?.name)
    if (key && !index.has(key) && typeof tag.id === 'string') {
      index.set(key, tag.id)
    }
  })
  return index
}

/**
 * 写入按顺序执行；任一步失败则回滚已经写入的文件，保证要么整体生效、
 * 要么保持导入前的数据（不再出现「半写入却报告成功」）。
 */
interface PendingWrite {
  label: string
  save: () => boolean
  restore: () => boolean
}

function writeAllOrRollback(writes: PendingWrite[]): void {
  const applied: PendingWrite[] = []

  for (const write of writes) {
    if (write.save()) {
      applied.push(write)
      continue
    }

    const failedRollbacks: string[] = []
    for (const appliedWrite of [...applied].reverse()) {
      try {
        if (!appliedWrite.restore()) {
          failedRollbacks.push(appliedWrite.label)
        }
      } catch (rollbackError) {
        console.error(`Rollback error for ${appliedWrite.label}:`, rollbackError)
        failedRollbacks.push(appliedWrite.label)
      }
    }

    const rollbackNote =
      failedRollbacks.length > 0
        ? `Rollback also failed for: ${failedRollbacks.join(', ')}.`
        : 'Previously written files were restored.'

    throw new Error(`Failed to write ${write.label}. ${rollbackNote}`)
  }
}

function escapeHtml(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 访问次数归一化（C22）：导入数据不可信，只接受有限非负整数，其余按 0 处理。
 * 与 `ipc/bookmarks.ts` 里 increment-visit-count 对存量脏数据的处理口径一致。
 */
function sanitizeVisitCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.floor(value)
}

/**
 * 最近访问时间归一化（C22）：只有可被 `Date` 解析的字符串才保留，其余归 null。
 * 保留原字符串而不是重新格式化，避免时区信息被改写。
 */
function sanitizeLastVisited(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }
  return Number.isNaN(new Date(value).getTime()) ? null : value
}

const HTML_ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/**
 * 反向解码导出/第三方 Netscape 文件里的命名实体与数字实体。
 * 去重键（name / url）必须先解码，否则 `a=1&amp;b=2` 与 `a=1&b=2`
 * 会被当成两个不同的键。
 */
function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[0-9]+|#x[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase()

    if (key.startsWith('#')) {
      const isHex = key.startsWith('#x')
      const code = isHex ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10)
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }

    return HTML_ENTITY_MAP[key] ?? match
  })
}

function getFolderParentId(folder: Folder): string {
  const parentId = folder?.parentId
  return typeof parentId === 'string' ? parentId.trim() : ''
}

/**
 * 根节点判定：没有父级 id，或父级 id 不在当前集合内（含自引用）。
 * 除根之外的文件夹一律通过 childrenByParent 递归收集。
 */
function buildFolderTree(folders: Folder[]): {
  roots: Folder[]
  childrenByParent: Map<string, Folder[]>
} {
  const knownIds = new Set<string>()
  folders.forEach(folder => {
    if (folder && typeof folder.id === 'string') knownIds.add(folder.id)
  })

  const roots: Folder[] = []
  const childrenByParent = new Map<string, Folder[]>()

  folders.forEach(folder => {
    const parentId = getFolderParentId(folder)
    const hasKnownParent = parentId !== '' && parentId !== folder.id && knownIds.has(parentId)

    if (!hasKnownParent) {
      roots.push(folder)
      return
    }

    const siblings = childrenByParent.get(parentId)
    if (siblings) {
      siblings.push(folder)
    } else {
      childrenByParent.set(parentId, [folder])
    }
  })

  return { roots, childrenByParent }
}

interface FolderRenderContext {
  timestamp: number
  bookmarksByFolder: Map<string, Bookmark[]>
  childrenByParent: Map<string, Folder[]>
  rendered: Set<string>
}

function renderBookmarkLine(bookmark: Bookmark, depth: number, timestamp: number): string {
  const indent = '    '.repeat(depth)
  return `${indent}<DT><A HREF="${escapeHtml(bookmark.url)}" ADD_DATE="${timestamp}">${escapeHtml(
    bookmark.title
  )}</A>\n`
}

function renderFolderBlock(folder: Folder, depth: number, context: FolderRenderContext): string {
  // 防止重复 id / 父链成环导致的无限递归，也保证每个文件夹只输出一次
  if (context.rendered.has(folder.id)) return ''
  context.rendered.add(folder.id)

  const indent = '    '.repeat(depth)
  let html = `${indent}<DT><H3 ADD_DATE="${context.timestamp}">${escapeHtml(folder.name)}</H3>\n`
  html += `${indent}<DL><p>\n`

  const subFolders = context.childrenByParent.get(folder.id) || []
  subFolders.forEach(subFolder => {
    html += renderFolderBlock(subFolder, depth + 1, context)
  })

  const folderBookmarks = context.bookmarksByFolder.get(folder.id) || []
  folderBookmarks.forEach(bookmark => {
    html += renderBookmarkLine(bookmark, depth + 1, context.timestamp)
  })

  html += `${indent}</DL><p>\n`
  return html
}

function countExportedBookmarks(html: string): number {
  const matches = html.match(/<DT><A\s+HREF=/gi)
  return matches ? matches.length : 0
}

function generateNetscapeHtml(bookmarks: Bookmark[], folders: Folder[]): string {
  const timestamp = Math.floor(Date.now() / 1000)

  let html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n`
  html += `<!-- This is an automatically generated file.\n`
  html += `     It will be read and overwritten.\n`
  html += `     DO NOT EDIT! -->\n`
  html += `<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n`
  html += `<TITLE>Bookmarks</TITLE>\n`
  html += `<H1>Bookmarks</H1>\n`
  html += `<DL><p>\n`

  const uncategorized: Bookmark[] = []
  const bookmarksByFolder = new Map<string, Bookmark[]>()
  bookmarksByFolder.set('', uncategorized)
  folders.forEach(folder => bookmarksByFolder.set(folder.id, []))

  bookmarks.forEach(bookmark => {
    const folderId = typeof bookmark.folderId === 'string' ? bookmark.folderId : ''
    const bucket = bookmarksByFolder.get(folderId) || uncategorized
    bucket.push(bookmark)
  })

  const { roots, childrenByParent } = buildFolderTree(folders)
  const context: FolderRenderContext = {
    timestamp,
    bookmarksByFolder,
    childrenByParent,
    rendered: new Set<string>()
  }

  roots.forEach(folder => {
    html += renderFolderBlock(folder, 1, context)
  })

  // 兜底：父级指向未知 id 或父链成环的文件夹也必须输出，
  // 否则其下书签会被静默丢弃（A2 的根因之一）。
  folders.forEach(folder => {
    html += renderFolderBlock(folder, 1, context)
  })

  uncategorized.forEach(bookmark => {
    html += renderBookmarkLine(bookmark, 1, timestamp)
  })

  html += `</DL><p>\n`

  return html
}

/** HTML 导入时解析出的文件夹节点：`parentId` 为 null 表示顶层 */
interface ParsedFolderNode {
  name: string
  parentId: string | null
}

/**
 * 解析 Netscape 书签文件（C20）。
 *
 * 旧实现用一条只匹配 `<DT>` 的正则线性扫描，**完全不处理 `</DL>`**，因此
 * 嵌套目录的层级永远不闭合：一个子目录之后的所有书签都会被错误归到该子目录。
 *
 * 现在的做法是按文档顺序扫「结构 token」：
 *   - `<DT><H3>name</H3>` → 新建目录，`parentId` = 当前栈顶，压栈；
 *   - `</DL>`             → 弹栈（回到父目录）；
 *   - `<DT><A HREF="…">title</A>` → 书签，归到当前栈顶目录；
 *   - `<DD>desc`          → 上一条书签的描述（浏览器导出的文件里很常见）。
 *
 * 目录本身无法自闭合，所以栈是唯一的层级来源；`</DL>` 多余时忽略（不退到负层级）。
 */
function parseNetscapeHtml(html: string): {
  folders: Map<string, ParsedFolderNode>
  bookmarks: Array<{ title: string; url: string; folderId: string; description: string }>
} {
  const folders = new Map<string, ParsedFolderNode>()
  const bookmarks: Array<{ title: string; url: string; folderId: string; description: string }> = []

  // 组 1=目录名 / 2=HREF / 3=书签名 / 4=<DD> 描述；`</DL>` 通过 match[0] 判定
  const tokenRegex =
    /<DT>\s*<H3[^>]*>([\s\S]*?)<\/H3>|<DT>\s*<A\b[^>]*\bHREF\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/A>|<DD>\s*([\s\S]*?)(?=<DT>|<\/DL>|<\/H1>|$)|<\/DL\s*>/gi

  const stack: Array<{ id: string }> = []
  let lastBookmark: { description: string } | null = null

  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(html)) !== null) {
    const token = match[0]

    // </DL>：回到父目录
    if (/^<\/DL/i.test(token)) {
      stack.pop()
      lastBookmark = null
      continue
    }

    // <DD>：给上一条书签补描述
    if (/^<DD/i.test(token)) {
      const description = decodeHtmlEntities((match[4] || '').trim())
      if (lastBookmark) {
        lastBookmark.description = description
      }
      continue
    }

    // <DT><H3>：目录节点
    if (typeof match[1] === 'string') {
      const folderId = uuidv4()
      const parentId = stack.length > 0 ? stack[stack.length - 1].id : null
      folders.set(folderId, {
        name: decodeHtmlEntities(match[1].trim()),
        parentId
      })
      stack.push({ id: folderId })
      lastBookmark = null
      continue
    }

    // <DT><A>：书签节点
    const url = decodeHtmlEntities((match[2] || '').trim())
    const title = decodeHtmlEntities((match[3] || '').trim()) || url
    if (!url) {
      lastBookmark = null
      continue
    }

    const entry = {
      title,
      url,
      folderId: stack.length > 0 ? stack[stack.length - 1].id : '',
      description: ''
    }
    bookmarks.push(entry)
    lastBookmark = entry
  }

  return { folders, bookmarks }
}

export function registerImportExportHandlers(): void {
  ipcMain.handle('export-data', async (_, format: 'json' | 'html') => {
    try {
      const bookmarks = getBookmarks()
      const folders = getFolders()
      const tags = getTags()

      const defaultPath = path.join(
        app.getPath('documents'),
        `LinkCollection_Bookmarks_${new Date().toISOString().slice(0, 10)}.${format}`
      )

      const result = await dialog.showSaveDialog({
        defaultPath,
        filters:
          format === 'json'
            ? [{ name: 'JSON Files', extensions: ['json'] }]
            : [{ name: 'HTML Files', extensions: ['html'] }]
      })

      if (result.canceled || !result.filePath) {
        return { success: false, canceled: true }
      }

      if (format === 'json') {
        const exportData = {
          version: '1.1.0',
          exportedAt: new Date().toISOString(),
          bookmarks,
          folders,
          tags
        }
        fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')

        return {
          success: true,
          filePath: result.filePath,
          exported: { bookmarks: bookmarks.length, folders: folders.length, tags: tags.length }
        }
      }

      const html = generateNetscapeHtml(bookmarks, folders)

      // 自检 1：生成的 HTML 必须包含全部书签，否则不落盘、不报告成功
      const generatedCount = countExportedBookmarks(html)
      if (generatedCount !== bookmarks.length) {
        const error = `HTML export incomplete: generated ${generatedCount} of ${bookmarks.length} bookmarks`
        console.error(error)
        return { success: false, error }
      }

      fs.writeFileSync(result.filePath, html, 'utf-8')

      // 自检 2：回读文件确认写入内容完整（磁盘满/截断时能立即发现）
      const writtenCount = countExportedBookmarks(fs.readFileSync(result.filePath, 'utf-8'))
      if (writtenCount !== bookmarks.length) {
        const error = `HTML export verification failed: file contains ${writtenCount} of ${bookmarks.length} bookmarks`
        console.error(error)
        return { success: false, error }
      }

      return {
        success: true,
        filePath: result.filePath,
        exported: { bookmarks: bookmarks.length, folders: folders.length, tags: 0 }
      }
    } catch (error) {
      console.error('Export error:', error)
      return { success: false, error: toErrorMessage(error) }
    }
  })

  ipcMain.handle(
    'import-data',
    async (_, format: 'json' | 'html', mergeMode: 'replace' | 'merge') => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters:
            format === 'json'
              ? [{ name: 'JSON Files', extensions: ['json'] }]
              : [{ name: 'HTML Files', extensions: ['html', 'htm'] }]
        })

        if (result.canceled || !result.filePaths[0]) {
          return { success: false, canceled: true }
        }

        const content = fs.readFileSync(result.filePaths[0], 'utf-8')
        const merge = mergeMode === 'merge'

        if (format === 'json') {
          const data = JSON.parse(content)

          if (!data.bookmarks || !Array.isArray(data.bookmarks)) {
            throw new Error('Invalid JSON format: missing bookmarks array')
          }

          // 现有数据既用于 merge 去重，也作为失败回滚的还原快照
          const previousBookmarks = getBookmarks()
          const previousFolders = getFolders()
          const previousTags = getTags()
          const previousHistory = snapshotHistory()

          const existingBookmarks = merge ? previousBookmarks : []
          const existingFolders = merge ? previousFolders : []
          const existingTags = merge ? previousTags : []

          const now = new Date().toISOString()

          const folderIdMap = new Map<string, string>()
          const folderIdsByName = merge ? buildFolderNameIndex(existingFolders) : new Map<string, string>()
          const importedFolders: Folder[] = []

          const sourceFolders: Array<Partial<Folder> | null | undefined> = Array.isArray(data.folders)
            ? data.folders
            : []

          sourceFolders.forEach(sourceFolder => {
            const folder = sourceFolder || {}
            const name = typeof folder.name === 'string' ? folder.name : ''
            const nameKey = normalizeNameKey(name)
            const sourceId = typeof folder.id === 'string' ? folder.id : ''

            // merge：同名文件夹视为同一个，复用已存在 id
            const reusableId = nameKey ? folderIdsByName.get(nameKey) : undefined
            if (merge && reusableId) {
              if (sourceId) folderIdMap.set(sourceId, reusableId)
              return
            }

            const newId = uuidv4()
            importedFolders.push({
              id: newId,
              name,
              icon: folder.icon || null,
              color: folder.color || DEFAULT_COLOR,
              createdAt: folder.createdAt || now,
              order: typeof folder.order === 'number' ? folder.order : importedFolders.length
            })

            if (nameKey && !folderIdsByName.has(nameKey)) folderIdsByName.set(nameKey, newId)
            if (sourceId) folderIdMap.set(sourceId, newId)
          })

          const tagIdMap = new Map<string, string>()
          const tagIdsByName = merge ? buildTagNameIndex(existingTags) : new Map<string, string>()
          const importedTags: Tag[] = []

          const sourceTags: Array<Partial<Tag> | null | undefined> = Array.isArray(data.tags) ? data.tags : []

          sourceTags.forEach(sourceTag => {
            const tag = sourceTag || {}
            const name = typeof tag.name === 'string' ? tag.name : ''
            const nameKey = normalizeNameKey(name)
            const sourceId = typeof tag.id === 'string' ? tag.id : ''

            // merge：同名标签视为同一个，复用已存在 id
            const reusableId = nameKey ? tagIdsByName.get(nameKey) : undefined
            if (merge && reusableId) {
              if (sourceId) tagIdMap.set(sourceId, reusableId)
              return
            }

            const newId = uuidv4()
            importedTags.push({
              id: newId,
              name,
              color: tag.color || DEFAULT_COLOR,
              createdAt: tag.createdAt || now
            })

            if (nameKey && !tagIdsByName.has(nameKey)) tagIdsByName.set(nameKey, newId)
            if (sourceId) tagIdMap.set(sourceId, newId)
          })

          const seenUrls = merge ? buildUrlIndex(existingBookmarks) : new Set<string>()
          let skippedBookmarks = 0
          const importedBookmarks: Bookmark[] = []

          const sourceBookmarks: Array<Partial<Bookmark> | null | undefined> = data.bookmarks

          sourceBookmarks.forEach(sourceBookmark => {
            const bookmark = sourceBookmark || {}
            const url = typeof bookmark.url === 'string' ? bookmark.url : ''
            const urlKey = merge ? normalizeUrlKey(url) : ''

            // merge：按归一化 URL 去重，重复导入同一文件不会翻倍
            if (urlKey && seenUrls.has(urlKey)) {
              skippedBookmarks += 1
              return
            }
            if (urlKey) seenUrls.add(urlKey)

            const rawTags: unknown[] = Array.isArray(bookmark.tags) ? bookmark.tags : []

            importedBookmarks.push({
              id: uuidv4(),
              url,
              title: bookmark.title || url,
              description: bookmark.description || '',
              favicon: bookmark.favicon || '',
              color: bookmark.color || DEFAULT_COLOR,
              folderId: (typeof bookmark.folderId === 'string' && folderIdMap.get(bookmark.folderId)) || '',
              tags: rawTags
                .map(tagId => (typeof tagId === 'string' ? tagIdMap.get(tagId) || tagId : ''))
                .filter(tagId => tagId !== ''),
              // C22：沿用导入文件里的访问统计，「导出 → 导入」往返不再清零
              visitCount: sanitizeVisitCount(bookmark.visitCount),
              lastVisited: sanitizeLastVisited(bookmark.lastVisited),
              // 置顶状态沿用导出文件：只认真布尔，脏值一律 false
              pinned: bookmark.pinned === true,
              createdAt: bookmark.createdAt || now,
              updatedAt: now
            })
          })

          const allFolders = [...existingFolders, ...importedFolders]
          const allTags = [...existingTags, ...importedTags]
          const allBookmarks = [...existingBookmarks, ...importedBookmarks]

          writeAllOrRollback([
            {
              label: FOLDERS_FILE,
              save: () => saveFolders(allFolders),
              restore: () => saveFolders(previousFolders)
            },
            {
              label: TAGS_FILE,
              save: () => saveTags(allTags),
              restore: () => saveTags(previousTags)
            },
            {
              label: BOOKMARKS_FILE,
              save: () => saveBookmarks(allBookmarks),
              restore: () => saveBookmarks(previousBookmarks)
            },
            {
              label: HISTORY_FILE,
              // replace：旧书签被丢弃，历史随之清空；merge：保留原历史
              save: () => (merge ? true : restoreHistory([])),
              restore: () => restoreHistory(previousHistory)
            }
          ])

          return {
            success: true,
            imported: {
              bookmarks: importedBookmarks.length,
              folders: importedFolders.length,
              tags: importedTags.length
            },
            skipped: skippedBookmarks,
            errors: [] as string[]
          }
        }

        const { folders, bookmarks } = parseNetscapeHtml(content)

        // 现有数据既用于 merge 去重，也作为失败回滚的还原快照
        const previousBookmarks = getBookmarks()
        const previousFolders = getFolders()
        const previousTags = getTags()
        const previousHistory = snapshotHistory()

        const existingBookmarks = merge ? previousBookmarks : []
        const existingFolders = merge ? previousFolders : []
        // C21：replace 模式语义是「替换全部数据」，Netscape 格式本身不携带标签，
        // 因此必须显式清空标签库，否则会残留旧标签且新书签一条都不带标签。
        const existingTags = merge ? previousTags : []

        const now = new Date().toISOString()

        const folderIdMap = new Map<string, string>()
        const folderIdsByName = merge ? buildFolderNameIndex(existingFolders) : new Map<string, string>()
        const importedFolders: Folder[] = []

        // Map 的插入顺序即文档顺序（父目录总是先于子目录出现），
        // 因此映射 parentId 时父级一定已经处理过（C20）。
        folders.forEach((node, parsedFolderId) => {
          const nameKey = normalizeNameKey(node.name)
          const parentId = node.parentId ? folderIdMap.get(node.parentId) ?? null : null

          // merge：同名文件夹复用已存在 id，并重写书签里的 folderId 引用
          const reusableId = merge && nameKey ? folderIdsByName.get(nameKey) : undefined
          if (reusableId) {
            folderIdMap.set(parsedFolderId, reusableId)
            return
          }

          const newId = uuidv4()
          importedFolders.push({
            id: newId,
            name: node.name,
            icon: null,
            color: DEFAULT_COLOR,
            createdAt: now,
            order: importedFolders.length,
            // C20：保留层级，使「导出 → 导入 → 再导出」不再把嵌套结构压平
            parentId
          })

          if (nameKey && !folderIdsByName.has(nameKey)) folderIdsByName.set(nameKey, newId)
          folderIdMap.set(parsedFolderId, newId)
        })

        const seenUrls = merge ? buildUrlIndex(existingBookmarks) : new Set<string>()
        let skippedBookmarks = 0
        const importedBookmarks: Bookmark[] = []

        bookmarks.forEach(parsedBookmark => {
          const url = parsedBookmark.url
          const urlKey = merge ? normalizeUrlKey(url) : ''

          if (urlKey && seenUrls.has(urlKey)) {
            skippedBookmarks += 1
            return
          }
          if (urlKey) seenUrls.add(urlKey)

          importedBookmarks.push({
            id: uuidv4(),
            url,
            title: parsedBookmark.title || url,
            // C20：<DD> 里的描述现在会被解析出来
            description: parsedBookmark.description || '',
            favicon: '',
            color: DEFAULT_COLOR,
            folderId: folderIdMap.get(parsedBookmark.folderId) || '',
            tags: [],
            // Netscape 书签格式不携带访问次数/最近访问时间，这里只能降级为初始值（不是缺陷）
            visitCount: 0,
            lastVisited: null,
            // Netscape 书签格式同样不携带「置顶」状态，导入后一律视为未置顶
            pinned: false,
            createdAt: now,
            updatedAt: now
          })
        })

        const allFolders = [...existingFolders, ...importedFolders]
        const allBookmarks = [...existingBookmarks, ...importedBookmarks]

        writeAllOrRollback([
          {
            label: FOLDERS_FILE,
            save: () => saveFolders(allFolders),
            restore: () => saveFolders(previousFolders)
          },
          {
            label: TAGS_FILE,
            // C21：replace 模式写入空标签库（真正清空）；merge 模式是原样回写（no-op）
            save: () => saveTags(existingTags),
            restore: () => saveTags(previousTags)
          },
          {
            label: BOOKMARKS_FILE,
            save: () => saveBookmarks(allBookmarks),
            restore: () => saveBookmarks(previousBookmarks)
          },
          {
            label: HISTORY_FILE,
            save: () => (merge ? true : restoreHistory([])),
            restore: () => restoreHistory(previousHistory)
          }
        ])

        return {
          success: true,
          imported: {
            bookmarks: importedBookmarks.length,
            folders: importedFolders.length,
            tags: 0
          },
          skipped: skippedBookmarks,
          errors: [] as string[]
        }
      } catch (error) {
        console.error('Import error:', error)
        const message = toErrorMessage(error)
        return {
          success: false,
          imported: { bookmarks: 0, folders: 0, tags: 0 },
          skipped: 0,
          errors: [message],
          error: message
        }
      }
    }
  )
}
