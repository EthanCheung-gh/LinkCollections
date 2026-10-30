import fs from 'fs'
import os from 'os'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempUserData } from './helpers/electron-stub'
import { isChromiumBookmarks, parseChromiumBookmarks } from '../shared/chromium-bookmarks'

/**
 * 浏览器书签文件直读导入（Chromium 家族）。
 *
 * 覆盖五层：
 *  1. 形状校验 `isChromiumBookmarks`；
 *  2. 纯解析 `parseChromiumBookmarks`（三个根、嵌套层级、脏节点、微秒时间戳）；
 *  3. 探测 `detectBrowserBookmarks`（临时目录伪造 `Bookmarks`，含损坏/超大/多 profile）；
 *  4. 共享写库核心 `applyImportedData`（merge 去重、id 重映射、replace 清空、计数）；
 *  5. IPC `import-browser-bookmarks`（白名单拒绝 + 合法路径落盘），以及
 *     **既有 `import-data` 的 JSON / HTML 两条路径行为不变**的回归断言。
 *
 * 主进程模块在文件顶部 import 'electron'，因此统一用 `tests/helpers/electron-stub.ts` 的桩，
 * 数据目录是固定的临时目录（`useTempUserData()` 每例清空）。
 */

vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

const NOW = new Date('2024-05-01T00:00:00.000Z')

let dataDir = ''

const file = (name: string) => path.join(dataDir, name)

const writeJson = (name: string, data: unknown): void => {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2), 'utf-8')
}

const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(file(name), 'utf-8')) as T

const exists = (name: string): boolean => fs.existsSync(file(name))

/** 构造一条完整书签（字段与落盘对象一致） */
const bookmark = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a',
  url: 'https://example.com/a',
  title: 'A',
  description: '',
  favicon: '',
  color: '#3B82F6',
  folderId: '',
  tags: [],
  visitCount: 0,
  lastVisited: null,
  pinned: false,
  deletedAt: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
  ...over
})

const visit = (bookmarkId: string, visitedAt: string) => ({ bookmarkId, visitedAt })

/** 已注册的 handler 直接调用（第一个参数是 IpcMainInvokeEvent，这里传 undefined） */
const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const { electronStub } = await import('./helpers/electron-stub')
  const handler = electronStub.ipcMain.handlers.get(channel)
  expect(typeof handler).toBe('function')
  return (handler as (event: unknown, ...rest: unknown[]) => unknown)(undefined, ...args)
}

/** 把 `dialog.showOpenDialog` 换成「用户选了某个文件」（import-data 需要） */
const stubOpenDialog = async (filePath: string): Promise<void> => {
  const { electronStub } = await import('./helpers/electron-stub')
  const dialog = electronStub.dialog as unknown as Record<string, unknown>
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
}

/** 最小合法 Chromium 书签文件：三个根分区都可以单独覆盖 children */
const chromiumFile = (
  over: { bar?: unknown[]; other?: unknown[]; synced?: unknown[] } = {}
): Record<string, unknown> => ({
  roots: {
    bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: over.bar ?? [] },
    other: { type: 'folder', name: 'Other bookmarks', children: over.other ?? [] },
    synced: { type: 'folder', name: 'Mobile bookmarks', children: over.synced ?? [] }
  },
  version: 1
})

const chromiumRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'lc-chromium-'))

/** 在伪造的浏览器根目录下写一个 profile 的 Bookmarks 文件，返回该文件路径 */
const writeBookmarksFile = (rootDir: string, profile: string, content: unknown): string => {
  const profileDir = path.join(rootDir, profile)
  fs.mkdirSync(profileDir, { recursive: true })
  const filePath = path.join(profileDir, 'Bookmarks')
  fs.writeFileSync(
    filePath,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    'utf-8'
  )
  return filePath
}

beforeEach(() => {
  dataDir = useTempUserData()
  fs.mkdirSync(dataDir, { recursive: true })
})

/* ------------------------------------------------------------------ *
 * 1. 形状校验
 * ------------------------------------------------------------------ */

describe('isChromiumBookmarks', () => {
  it('最小合法结构返回 true（三个根的 type 都是 folder）', () => {
    expect(isChromiumBookmarks(chromiumFile())).toBe(true)
  })

  it('只要 roots 里有一个 folder 根就算合法（synced 可能缺失）', () => {
    expect(
      isChromiumBookmarks({
        roots: { bookmark_bar: { type: 'folder', name: 'Bookmarks bar', children: [] } }
      })
    ).toBe(true)
  })

  it('缺 roots / roots 形状不对 → false', () => {
    expect(isChromiumBookmarks({})).toBe(false)
    expect(isChromiumBookmarks({ version: 1 })).toBe(false)
    expect(isChromiumBookmarks({ roots: {} })).toBe(false)
    expect(isChromiumBookmarks({ roots: [] })).toBe(false)
    expect(isChromiumBookmarks({ roots: 'folder' })).toBe(false)
  })

  it('roots 全是 url 节点 → false（不是 Chromium 书签文件）', () => {
    expect(
      isChromiumBookmarks({
        roots: {
          bookmark_bar: { type: 'url', name: 'A', url: 'https://example.com' },
          other: { type: 'url', name: 'B', url: 'https://example.com/b' }
        }
      })
    ).toBe(false)
  })

  it('非对象输入 → false（不抛错）', () => {
    for (const value of [null, undefined, [], 'roots', 42, true]) {
      expect(isChromiumBookmarks(value)).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ *
 * 2. 解析
 * ------------------------------------------------------------------ */

describe('parseChromiumBookmarks', () => {
  it('三个根分区都被展开，根节点本身不算文件夹', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [{ type: 'url', name: 'Bar', url: 'https://bar.example.com/' }],
        other: [{ type: 'url', name: 'Other', url: 'https://other.example.com/' }],
        synced: [{ type: 'url', name: 'Mobile', url: 'https://mobile.example.com/' }]
      }),
      NOW
    )

    expect(parsed.bookmarks.map(item => item.title)).toEqual(['Bar', 'Other', 'Mobile'])
    // 根分区名（Bookmarks bar / Other bookmarks / Mobile bookmarks）不进 folderPath
    expect(parsed.bookmarks.every(item => item.folderPath.length === 0)).toBe(true)
    expect(parsed.folderPaths).toEqual([])
  })

  it('嵌套文件夹的层级与 folderPath 正确，folderPaths 去重且父在前', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [
          {
            type: 'folder',
            name: 'Work',
            children: [
              { type: 'url', name: 'Docs', url: 'https://docs.example.com/' },
              {
                type: 'folder',
                name: 'Specs',
                children: [{ type: 'url', name: 'Spec', url: 'https://spec.example.com/' }]
              }
            ]
          },
          {
            // 另一个顶层文件夹，名字与内层文件夹同名：路径不同就是不同文件夹
            type: 'folder',
            name: 'Specs',
            children: [{ type: 'url', name: 'Spec 2', url: 'https://spec2.example.com/' }]
          }
        ]
      }),
      NOW
    )

    expect(parsed.folderPaths).toEqual([['Work'], ['Work', 'Specs'], ['Specs']])
    expect(parsed.bookmarks.map(item => [item.title, item.folderPath])).toEqual([
      ['Docs', ['Work']],
      ['Spec', ['Work', 'Specs']],
      ['Spec 2', ['Specs']]
    ])
  })

  it('type 既不是 url 也不是 folder 的节点被忽略（连同其 children）', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [
          { type: 'separator' },
          {
            type: 'weird',
            name: 'Unknown',
            children: [{ type: 'url', name: 'Hidden', url: 'https://hidden.example.com/' }]
          },
          { type: 'url', name: 'Kept', url: 'https://kept.example.com/' }
        ]
      }),
      NOW
    )

    expect(parsed.bookmarks.map(item => item.title)).toEqual(['Kept'])
    expect(parsed.folderPaths).toEqual([])
  })

  it('无 url 的 url 节点被忽略（空串 / 缺失 / 非字符串）', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [
          { type: 'url', name: 'Empty', url: '' },
          { type: 'url', name: 'Missing' },
          { type: 'url', name: 'Non-string', url: 123 },
          { type: 'url', name: 'Ok', url: 'https://ok.example.com/' }
        ]
      }),
      NOW
    )

    expect(parsed.bookmarks.map(item => item.title)).toEqual(['Ok'])
  })

  it('date_added 微秒 → ISO（Unix 纪元微秒）', () => {
    const micros = String(Date.parse('2021-06-01T00:00:00.000Z') * 1000)
    const parsed = parseChromiumBookmarks(
      chromiumFile({ bar: [{ type: 'url', name: 'A', url: 'https://a.example.com/', date_added: micros }] }),
      NOW
    )

    expect(parsed.bookmarks[0].createdAt).toBe('2021-06-01T00:00:00.000Z')
  })

  it('date_added 微秒 → ISO（真实 Chromium 文件用 1601 纪元）', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [
          {
            type: 'url',
            name: 'Real',
            url: 'https://real.example.com/',
            date_added: '13298944339442817'
          }
        ]
      }),
      NOW
    )

    // 若按 Unix 纪元解释会得到 2391 年（荒谬的未来值），必须回退到 1601 纪元
    expect(parsed.bookmarks[0].createdAt).toBe('2022-06-05T23:12:19.442Z')
  })

  it('date_added 非法 / 缺失 / 未来值 → 用 now', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [
          { type: 'url', name: 'Garbage', url: 'https://a.example.com/', date_added: 'not-a-number' },
          { type: 'url', name: 'Negative', url: 'https://b.example.com/', date_added: '-5' },
          { type: 'url', name: 'Missing', url: 'https://c.example.com/' },
          { type: 'url', name: 'Far future', url: 'https://d.example.com/', date_added: '9999999999999999999' }
        ]
      }),
      NOW
    )

    expect(parsed.bookmarks.map(item => item.createdAt)).toEqual([
      NOW.toISOString(),
      NOW.toISOString(),
      NOW.toISOString(),
      NOW.toISOString()
    ])
  })

  it('空 roots / 无 children → 空结果', () => {
    expect(parseChromiumBookmarks({ roots: {} }, NOW)).toEqual({ bookmarks: [], folderPaths: [] })
    expect(parseChromiumBookmarks(chromiumFile(), NOW)).toEqual({ bookmarks: [], folderPaths: [] })
    // 非 Chromium 文件（如本项目自己的导出 JSON）也返回空结果而不是抛错
    expect(parseChromiumBookmarks({ bookmarks: [] }, NOW)).toEqual({
      bookmarks: [],
      folderPaths: []
    })
  })

  it('名称缺失时兜底：书签标题退化为 URL，文件夹名退化为 Untitled', () => {
    const parsed = parseChromiumBookmarks(
      chromiumFile({
        bar: [
          {
            type: 'folder',
            name: '   ',
            children: [{ type: 'url', url: 'https://nofallback.example.com/' }]
          }
        ]
      }),
      NOW
    )

    expect(parsed.folderPaths).toEqual([['Untitled']])
    expect(parsed.bookmarks[0].title).toBe('https://nofallback.example.com/')
    expect(parsed.bookmarks[0].folderPath).toEqual(['Untitled'])
  })
})

/* ------------------------------------------------------------------ *
 * 3. 探测
 * ------------------------------------------------------------------ */

describe('getChromiumBookmarkRoots', () => {
  it('按平台给出已知目录（Windows 用 %LOCALAPPDATA% 下的 User Data）', async () => {
    const { getChromiumBookmarkRoots } = await import('../electron/ipc/browser-import')
    const localAppData = path.join('C:', 'Users', 'u', 'AppData', 'Local')

    const roots = getChromiumBookmarkRoots({
      platform: 'win32',
      env: { LOCALAPPDATA: localAppData },
      homeDir: path.join('C:', 'Users', 'u')
    })

    const paths = roots.map(root => root.rootPath)
    expect(paths).toContain(path.join(localAppData, 'Google', 'Chrome', 'User Data'))
    expect(paths).toContain(path.join(localAppData, 'Microsoft', 'Edge', 'User Data'))
    expect(paths).toContain(path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'))
    expect(paths).toContain(path.join(localAppData, 'Chromium', 'User Data'))
    expect(roots.map(root => root.browser)).toEqual([
      'Chrome',
      'Microsoft Edge',
      'Brave',
      'Chromium'
    ])
  })

  it('macOS 用 ~/Library/Application Support，Linux 用 ~/.config', async () => {
    const { getChromiumBookmarkRoots } = await import('../electron/ipc/browser-import')
    const home = path.join('/', 'home', 'u')

    const mac = getChromiumBookmarkRoots({ platform: 'darwin', env: {}, homeDir: home }).map(
      root => root.rootPath
    )
    expect(mac).toContain(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'))
    expect(mac).toContain(path.join(home, 'Library', 'Application Support', 'Microsoft Edge'))
    expect(mac).toContain(
      path.join(home, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser')
    )

    const linux = getChromiumBookmarkRoots({ platform: 'linux', env: {}, homeDir: home }).map(
      root => root.rootPath
    )
    expect(linux).toContain(path.join(home, '.config', 'google-chrome'))
    expect(linux).toContain(path.join(home, '.config', 'chromium'))
    expect(linux).toContain(path.join(home, '.config', 'microsoft-edge'))
    expect(linux).toContain(path.join(home, '.config', 'BraveSoftware', 'Brave-Browser'))
  })

  it('%LOCALAPPDATA% 缺失时退化为 ~/AppData/Local', async () => {
    const { getChromiumBookmarkRoots } = await import('../electron/ipc/browser-import')
    const home = path.join('C:', 'Users', 'u')
    const roots = getChromiumBookmarkRoots({ platform: 'win32', env: {}, homeDir: home })

    expect(roots[0].rootPath).toBe(
      path.join(home, 'AppData', 'Local', 'Google', 'Chrome', 'User Data')
    )
  })
})

describe('detectBrowserBookmarks', () => {
  it('识别多 profile 候选并统计书签数 / 文件夹数', async () => {
    const { detectBrowserBookmarks } = await import('../electron/ipc/browser-import')
    const root = chromiumRoot()

    const defaultPath = writeBookmarksFile(
      root,
      'Default',
      chromiumFile({
        bar: [
          { type: 'url', name: 'A', url: 'https://a.example.com/' },
          {
            type: 'folder',
            name: 'Work',
            children: [
              { type: 'url', name: 'B', url: 'https://b.example.com/' },
              { type: 'folder', name: 'Nested', children: [] }
            ]
          }
        ]
      })
    )
    const profilePath = writeBookmarksFile(
      root,
      'Profile 1',
      chromiumFile({ other: [{ type: 'url', name: 'C', url: 'https://c.example.com/' }] })
    )
    // 真实浏览器根目录下的非 profile 子目录：没有 Bookmarks 文件，必须被跳过
    fs.mkdirSync(path.join(root, 'Crashpad'), { recursive: true })

    const candidates = detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: root }] })

    expect(candidates.map(item => item.profile)).toEqual(['Default', 'Profile 1'])
    expect(candidates.map(item => item.path)).toEqual([defaultPath, profilePath])

    const [first, second] = candidates
    expect(first.browser).toBe('Chrome')
    expect(first.bookmarkCount).toBe(2)
    expect(first.folderCount).toBe(2)
    expect(typeof first.modifiedAt).toBe('string')
    expect(second.bookmarkCount).toBe(1)
    expect(second.folderCount).toBe(0)

    // id 是路径的稳定哈希：同一文件反复探测得到同一个 id，不同文件不同 id
    expect(first.id).toHaveLength(16)
    expect(first.id).not.toBe(second.id)
    expect(first.id).not.toContain(root)
    const again = detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: root }] })
    expect(again.map(item => item.id)).toEqual([first.id, second.id])
  })

  it('损坏 JSON / 非 Chromium JSON 被跳过，其它候选照常返回', async () => {
    const { detectBrowserBookmarks } = await import('../electron/ipc/browser-import')
    const root = chromiumRoot()

    writeBookmarksFile(root, 'Default', chromiumFile())
    writeBookmarksFile(root, 'Profile 1', '{ this is not json')
    writeBookmarksFile(root, 'Profile 2', { bookmarks: [] })
    writeBookmarksFile(root, 'Profile 3', chromiumFile({ bar: [{ type: 'url', name: 'X', url: 'https://x.example.com/' }] }))

    const candidates = detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: root }] })

    expect(candidates.map(item => item.profile)).toEqual(['Default', 'Profile 3'])
  })

  it('超过大小上限的文件被跳过（上限可注入，默认 20MB）', async () => {
    const { detectBrowserBookmarks, MAX_BOOKMARKS_FILE_BYTES } = await import(
      '../electron/ipc/browser-import'
    )
    expect(MAX_BOOKMARKS_FILE_BYTES).toBe(20 * 1024 * 1024)

    const root = chromiumRoot()
    writeBookmarksFile(root, 'Default', chromiumFile())
    writeBookmarksFile(
      root,
      'Profile 1',
      chromiumFile({ bar: [{ type: 'url', name: 'X', url: 'https://x.example.com/' }] })
    )

    const candidates = detectBrowserBookmarks({
      roots: [{ browser: 'Chrome', rootPath: root }],
      maxBytes: 64
    })

    expect(candidates).toEqual([])
  })

  it('目录不存在 / 无候选时不抛错，返回空数组', async () => {
    const { detectBrowserBookmarks } = await import('../electron/ipc/browser-import')
    const missingRoot = path.join(os.tmpdir(), `lc-missing-${Date.now()}`)

    expect(detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: missingRoot }] })).toEqual(
      []
    )

    const emptyRoot = chromiumRoot()
    expect(detectBrowserBookmarks({ roots: [{ browser: 'Brave', rootPath: emptyRoot }] })).toEqual(
      []
    )
  })
})

/* ------------------------------------------------------------------ *
 * 4. 共享写库核心
 * ------------------------------------------------------------------ */

describe('applyImportedData（共享导入核心）', () => {
  const seed = () => {
    writeJson('bookmarks.json', [
      bookmark({ id: 'old', url: 'https://example.com/', title: 'Old', tags: ['t-reading'] })
    ])
    writeJson('folders.json', [
      {
        id: 'f-work',
        name: 'Work',
        icon: null,
        color: '#3B82F6',
        createdAt: '2024-01-01T00:00:00.000Z',
        order: 0
      }
    ])
    writeJson('tags.json', [
      {
        id: 't-reading',
        name: 'Reading',
        color: '#3B82F6',
        createdAt: '2024-01-01T00:00:00.000Z'
      }
    ])
    writeJson('history.json', [visit('old', '2024-04-01T00:00:00.000Z')])
  }

  it('merge：按 normalizeUrlKey 去重、文件夹/标签同名复用、id 重映射、计数正确', async () => {
    seed()
    const { applyImportedData } = await import('../electron/ipc/import-export')

    const result = applyImportedData(
      {
        folders: [
          // 名称只差大小写与空白：应与既有 Work 复用同一个 id
          { id: 'src-work', name: ' work ', parentId: null },
          { id: 'src-inbox', name: 'Inbox' }
        ],
        tags: [
          // 同名标签复用
          { id: 'src-reading', name: 'reading' },
          { id: 'src-later', name: 'Later' }
        ],
        bookmarks: [
          // 与既有书签归一化后同键 → 跳过
          { url: 'https://example.com', title: 'Dup 1' },
          // 本批次内重复 → 也跳过
          { url: 'https://example.com/', title: 'Dup 2' },
          {
            url: 'https://inbox.example.com/a',
            title: 'Inbox item',
            folderId: 'src-inbox',
            tags: ['src-reading', 'src-later']
          }
        ]
      },
      { merge: true }
    )

    expect(result).toEqual({
      imported: { bookmarks: 1, folders: 1, tags: 1 },
      skipped: 2
    })

    const savedBookmarks = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    expect(savedBookmarks).toHaveLength(2)
    expect(savedBookmarks.map(item => item.title)).toEqual(['Old', 'Inbox item'])

    // 既有书签一字未改
    expect(savedBookmarks[0]).toEqual(bookmark({ id: 'old', url: 'https://example.com/', title: 'Old', tags: ['t-reading'] }))

    const savedFolders = readJson<Array<Record<string, unknown>>>('folders.json')
    expect(savedFolders.map(item => item.name)).toEqual(['Work', 'Inbox'])
    expect(savedFolders[0].id).toBe('f-work')

    const savedTags = readJson<Array<Record<string, unknown>>>('tags.json')
    expect(savedTags.map(item => item.name)).toEqual(['Reading', 'Later'])
    expect(savedTags[0].id).toBe('t-reading')

    // id 重映射：folderId / tags 都指向库里真实存在的 id
    const inboxFolderId = savedFolders[1].id as string
    const laterTagId = savedTags[1].id as string
    const imported = savedBookmarks[1]
    expect(imported.folderId).toBe(inboxFolderId)
    expect(imported.tags).toEqual(['t-reading', laterTagId])
    expect(imported.id).not.toBe('old')

    // merge 不动历史
    expect(readJson('history.json')).toEqual([visit('old', '2024-04-01T00:00:00.000Z')])
  })

  it('merge 模式下 folder.parentId 不被写入（与既有 JSON 导入一致）', async () => {
    seed()
    const { applyImportedData } = await import('../electron/ipc/import-export')

    applyImportedData(
      {
        bookmarks: [{ url: 'https://child.example.com/', folderId: 'src-child' }],
        folders: [
          { id: 'src-parent', name: 'Parent' },
          { id: 'src-child', name: 'Child', parentId: 'src-parent' }
        ],
        tags: []
      },
      { merge: true }
    )

    const savedFolders = readJson<Array<Record<string, unknown>>>('folders.json')
    const child = savedFolders.find(folder => folder.name === 'Child')
    expect(child).toBeDefined()
    expect(Object.prototype.hasOwnProperty.call(child, 'parentId')).toBe(false)
  })

  it('preserveFolderHierarchy: true 时保留 parentId 链', async () => {
    const { applyImportedData } = await import('../electron/ipc/import-export')

    applyImportedData(
      {
        bookmarks: [{ url: 'https://nested.example.com/', folderId: 'src-child' }],
        folders: [
          { id: 'src-parent', name: 'Parent' },
          { id: 'src-child', name: 'Child', parentId: 'src-parent' }
        ],
        tags: []
      },
      { merge: true, preserveFolderHierarchy: true }
    )

    const savedFolders = readJson<Array<Record<string, unknown>>>('folders.json')
    const parent = savedFolders.find(folder => folder.name === 'Parent') as Record<string, unknown>
    const child = savedFolders.find(folder => folder.name === 'Child') as Record<string, unknown>
    expect(parent.parentId).toBeNull()
    expect(child.parentId).toBe(parent.id)

    expect(readJson<Array<Record<string, unknown>>>('bookmarks.json')[0].folderId).toBe(child.id)
  })

  it('replace：清空既有书签/文件夹/标签/历史，只留新导入的数据', async () => {
    seed()
    const { applyImportedData } = await import('../electron/ipc/import-export')

    const result = applyImportedData(
      {
        bookmarks: [{ url: 'https://fresh.example.com/', title: 'Fresh' }],
        folders: [{ id: 'src-1', name: 'Fresh folder' }],
        tags: []
      },
      { merge: false }
    )

    expect(result).toEqual({
      imported: { bookmarks: 1, folders: 1, tags: 0 },
      skipped: 0
    })

    const savedBookmarks = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    expect(savedBookmarks).toHaveLength(1)
    expect(savedBookmarks[0].title).toBe('Fresh')

    expect(readJson<Array<Record<string, unknown>>>('folders.json').map(item => item.name)).toEqual([
      'Fresh folder'
    ])
    // 源数据不带标签 → 标签库必须被清空（而不是残留 Reading）
    expect(readJson('tags.json')).toEqual([])
    // 旧书签被丢弃 → 访问历史一并清空
    expect(readJson('history.json')).toEqual([])
  })
})

/* ------------------------------------------------------------------ *
 * 5. import-browser-bookmarks：白名单 + 落盘
 * ------------------------------------------------------------------ */

describe('import-browser-bookmarks', () => {
  beforeEach(async () => {
    const { registerBrowserImportHandlers } = await import('../electron/ipc/browser-import')
    registerBrowserImportHandlers()
  })

  it('拒绝不在探测白名单里的路径（防任意文件读取）', async () => {
    const outside = path.join(chromiumRoot(), 'Default', 'Bookmarks')
    fs.mkdirSync(path.dirname(outside), { recursive: true })
    fs.writeFileSync(outside, JSON.stringify(chromiumFile()), 'utf-8')

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const result = (await invoke('import-browser-bookmarks', {
        path: outside,
        mergeMode: 'merge'
      })) as { success: boolean; error?: string }

      expect(result.success).toBe(false)
      expect(result.error).toContain('not produced by browser detection')
      // 拒绝发生在读盘之前：没有任何文件被写入
      expect(renameSpy).not.toHaveBeenCalled()
      expect(exists('bookmarks.json')).toBe(false)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('拒绝空路径与非字符串路径', async () => {
    expect((await invoke('import-browser-bookmarks', {})) as { success: boolean }).toMatchObject({
      success: false
    })
    expect(
      (await invoke('import-browser-bookmarks', { path: 42, mergeMode: 'merge' })) as {
        success: boolean
      }
    ).toMatchObject({ success: false })
  })

  it('合法路径：解析 → 走共享核心落盘，返回与 import-data 一致的汇总', async () => {
    const { detectBrowserBookmarks } = await import('../electron/ipc/browser-import')
    const root = chromiumRoot()
    const bookmarkPath = writeBookmarksFile(
      root,
      'Default',
      chromiumFile({
        bar: [
          {
            type: 'url',
            name: 'Example',
            url: 'https://example.com/',
            date_added: '1700000000000000'
          },
          {
            type: 'folder',
            name: 'Work',
            children: [{ type: 'url', name: 'Docs', url: 'https://docs.example.com/' }]
          }
        ]
      })
    )

    const [candidate] = detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: root }] })
    expect(candidate.path).toBe(bookmarkPath)

    const result = (await invoke('import-browser-bookmarks', {
      path: candidate.path,
      mergeMode: 'merge'
    })) as {
      success: boolean
      imported: { bookmarks: number; folders: number; tags: number }
      skipped: number
      errors: string[]
    }

    expect(result.success).toBe(true)
    expect(result.imported).toEqual({ bookmarks: 2, folders: 1, tags: 0 })
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])

    const savedBookmarks = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    expect(savedBookmarks.map(item => item.title)).toEqual(['Example', 'Docs'])

    const savedFolders = readJson<Array<Record<string, unknown>>>('folders.json')
    expect(savedFolders.map(item => item.name)).toEqual(['Work'])
    // 顶层文件夹：parentId 为 null（浏览器导入保留层级）
    expect(savedFolders[0].parentId).toBeNull()

    const docs = savedBookmarks.find(item => item.title === 'Docs') as Record<string, unknown>
    expect(docs.folderId).toBe(savedFolders[0].id)
    // Chromium 微秒时间戳被转成 ISO；不携带的字段降级为初始值
    const example = savedBookmarks[0]
    expect(example.createdAt).toBe('2023-11-14T22:13:20.000Z')
    expect(example.tags).toEqual([])
    expect(example.visitCount).toBe(0)
    expect(example.pinned).toBe(false)
  })

  it('重复导入同一文件：merge 模式全部按 URL 判重跳过，不会翻倍', async () => {
    const { detectBrowserBookmarks } = await import('../electron/ipc/browser-import')
    const root = chromiumRoot()
    writeBookmarksFile(
      root,
      'Default',
      chromiumFile({ bar: [{ type: 'url', name: 'A', url: 'https://a.example.com/' }] })
    )

    const [candidate] = detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: root }] })

    await invoke('import-browser-bookmarks', { path: candidate.path, mergeMode: 'merge' })
    const second = (await invoke('import-browser-bookmarks', {
      path: candidate.path,
      mergeMode: 'merge'
    })) as { imported: { bookmarks: number }; skipped: number }

    expect(second.imported.bookmarks).toBe(0)
    expect(second.skipped).toBe(1)
    expect(readJson<unknown[]>('bookmarks.json')).toHaveLength(1)
  })

  it('探测之后文件被删除：返回失败而不是抛错', async () => {
    const { detectBrowserBookmarks } = await import('../electron/ipc/browser-import')
    const root = chromiumRoot()
    writeBookmarksFile(root, 'Default', chromiumFile())

    const [candidate] = detectBrowserBookmarks({ roots: [{ browser: 'Chrome', rootPath: root }] })
    fs.rmSync(candidate.path)

    const result = (await invoke('import-browser-bookmarks', {
      path: candidate.path,
      mergeMode: 'merge'
    })) as { success: boolean }

    expect(result.success).toBe(false)
  })

  it('detect-browser-bookmarks 通道恒 resolve（未装浏览器时是空列表）', async () => {
    const result = (await invoke('detect-browser-bookmarks')) as {
      success: boolean
      candidates: unknown[]
    }

    expect(result.success).toBe(true)
    expect(Array.isArray(result.candidates)).toBe(true)
  })
})

/* ------------------------------------------------------------------ *
 * 6. 既有导入路径行为不变（回归）
 * ------------------------------------------------------------------ */

describe('import-data 行为不变（回归）', () => {
  beforeEach(async () => {
    const { registerImportExportHandlers } = await import('../electron/ipc/import-export')
    registerImportExportHandlers()
  })

  it('JSON merge：按 URL 去重、标签重映射、folder.parentId 保持不写', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'old', url: 'https://example.com/' })])
    writeJson('tags.json', [
      { id: 't-old', name: 'Reading', color: '#3B82F6', createdAt: '2024-01-01T00:00:00.000Z' }
    ])

    const importFile = path.join(chromiumRoot(), 'export.json')
    fs.writeFileSync(
      importFile,
      JSON.stringify({
        version: '1.1.0',
        bookmarks: [
          { url: 'https://example.com', title: 'Dup' },
          { url: 'https://new.example.com/', title: 'New', folderId: 'f-child', tags: ['tag-reading'] }
        ],
        folders: [
          { id: 'f-parent', name: 'Parent' },
          { id: 'f-child', name: 'Child', parentId: 'f-parent' }
        ],
        tags: [{ id: 'tag-reading', name: 'Reading' }]
      }),
      'utf-8'
    )
    await stubOpenDialog(importFile)

    const result = (await invoke('import-data', 'json', 'merge')) as {
      success: boolean
      imported: { bookmarks: number; folders: number; tags: number }
      skipped: number
    }

    expect(result).toMatchObject({
      success: true,
      imported: { bookmarks: 1, folders: 2, tags: 0 },
      skipped: 1
    })

    const savedFolders = readJson<Array<Record<string, unknown>>>('folders.json')
    expect(savedFolders.map(item => item.name)).toEqual(['Parent', 'Child'])
    // 历史行为：JSON 导入不写 parentId
    expect(Object.prototype.hasOwnProperty.call(savedFolders[1], 'parentId')).toBe(false)

    const savedBookmarks = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    expect(savedBookmarks).toHaveLength(2)
    expect(savedBookmarks[1].folderId).toBe(savedFolders[1].id)
    expect(savedBookmarks[1].tags).toEqual(['t-old'])
  })

  it('JSON replace：清空既有数据与标签', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'old', url: 'https://example.com/' })])
    writeJson('tags.json', [
      { id: 't-old', name: 'Reading', color: '#3B82F6', createdAt: '2024-01-01T00:00:00.000Z' }
    ])
    writeJson('history.json', [visit('old', '2024-04-01T00:00:00.000Z')])

    const importFile = path.join(chromiumRoot(), 'export.json')
    fs.writeFileSync(
      importFile,
      JSON.stringify({
        bookmarks: [{ url: 'https://fresh.example.com/', title: 'Fresh' }],
        folders: [],
        tags: []
      }),
      'utf-8'
    )
    await stubOpenDialog(importFile)

    const result = (await invoke('import-data', 'json', 'replace')) as {
      success: boolean
      imported: { bookmarks: number }
    }

    expect(result.success).toBe(true)
    expect(result.imported.bookmarks).toBe(1)
    expect(readJson<Array<Record<string, unknown>>>('bookmarks.json').map(item => item.title)).toEqual([
      'Fresh'
    ])
    expect(readJson('tags.json')).toEqual([])
    expect(readJson('history.json')).toEqual([])
  })

  it('HTML merge：嵌套目录保留 parentId 层级，description 被解析出来', async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000">Work</H3>
    <DL><p>
        <DT><A HREF="https://a.example.com/" ADD_DATE="1700000000">A</A>
        <DD>A description
        <DT><H3>Nested</H3>
        <DL><p>
            <DT><A HREF="https://b.example.com/">B</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://c.example.com/">C</A>
</DL><p>
`
    const importFile = path.join(chromiumRoot(), 'bookmarks.html')
    fs.writeFileSync(importFile, html, 'utf-8')
    await stubOpenDialog(importFile)

    const result = (await invoke('import-data', 'html', 'merge')) as {
      success: boolean
      imported: { bookmarks: number; folders: number; tags: number }
      skipped: number
    }

    expect(result).toMatchObject({
      success: true,
      imported: { bookmarks: 3, folders: 2, tags: 0 },
      skipped: 0
    })

    const savedFolders = readJson<Array<Record<string, unknown>>>('folders.json')
    const work = savedFolders.find(folder => folder.name === 'Work') as Record<string, unknown>
    const nested = savedFolders.find(folder => folder.name === 'Nested') as Record<string, unknown>
    expect(work.parentId).toBeNull()
    expect(nested.parentId).toBe(work.id)

    const savedBookmarks = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    const byTitle = new Map(savedBookmarks.map(item => [item.title, item]))
    expect(byTitle.get('A')?.folderId).toBe(work.id)
    expect(byTitle.get('A')?.description).toBe('A description')
    expect(byTitle.get('B')?.folderId).toBe(nested.id)
    // 顶层书签（不在任何目录里）不归属文件夹
    expect(byTitle.get('C')?.folderId).toBe('')
  })

  it('HTML replace：清空既有标签库', async () => {
    writeJson('tags.json', [
      { id: 't-old', name: 'Reading', color: '#3B82F6', createdAt: '2024-01-01T00:00:00.000Z' }
    ])

    const importFile = path.join(chromiumRoot(), 'bookmarks.html')
    fs.writeFileSync(
      importFile,
      '<DL><p><DT><A HREF="https://only.example.com/">Only</A></DL><p>',
      'utf-8'
    )
    await stubOpenDialog(importFile)

    const result = (await invoke('import-data', 'html', 'replace')) as { success: boolean }
    expect(result.success).toBe(true)
    expect(readJson('tags.json')).toEqual([])
    expect(readJson<Array<Record<string, unknown>>>('bookmarks.json')).toHaveLength(1)
  })
})
