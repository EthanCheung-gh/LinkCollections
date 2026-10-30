import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempUserData } from './helpers/electron-stub'
import { normalizeUrlKey } from '../shared/url-key'
import {
  groupDuplicates,
  mergeGroup,
  pickKeeper,
  planDuplicateMerges,
  type DuplicateCandidate
} from '../shared/duplicates'

/**
 * 重复书签合并：计划层是纯函数（不发网络、不碰真实数据目录）；
 * 只有最后的 `merge-duplicates` handler 用例会落到 `useTempUserData()` 的临时目录，
 * 并用 `fs` 打点验证「无重复不写盘」与「一次写入」。
 */
vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

const NOW = new Date('2024-05-01T00:00:00.000Z')

/**
 * 搬迁前的私有实现（原 `electron/ipc/import-export.ts` 的 `normalizeUrlKey` 原文）。
 *
 * 保留在这里作为**等价性基准**：共享实现与它必须在同一批 URL 上给出完全相同的键，
 * 否则「导入去重」的行为就变了。
 */
function legacyNormalizeUrlKey(url: unknown): string {
  if (typeof url !== 'string') return ''

  const value = url.trim()
  if (!value) return ''

  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`

  try {
    const parsed = new URL(candidate)
    const pathname = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}${parsed.hash}`
  } catch {
    return value.replace(/\/+$/, '').toLowerCase()
  }
}

/** 构造一条宽松候选记录（所有字段都可被覆盖） */
const candidate = (over: Partial<DuplicateCandidate> = {}): DuplicateCandidate => ({
  id: 'a',
  url: 'https://example.com',
  title: '',
  description: '',
  favicon: '',
  color: '#3B82F6',
  folderId: '',
  tags: [],
  visitCount: 0,
  lastVisited: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  pinned: false,
  // schema v3 之后落盘对象恒有该键；`null` = 未删除
  deletedAt: null,
  ...over
})

describe('normalizeUrlKey（与导入去重共用）', () => {
  it('host 统一小写，path 保持原样（大小写敏感）', () => {
    expect(normalizeUrlKey('Example.COM')).toBe('https://example.com')
    expect(normalizeUrlKey('https://EXAMPLE.com/Path')).toBe('https://example.com/Path')
  })

  it('去掉尾部斜杠（含连续多个）', () => {
    expect(normalizeUrlKey('https://example.com/')).toBe('https://example.com')
    expect(normalizeUrlKey('https://example.com///')).toBe('https://example.com')
    expect(normalizeUrlKey('https://example.com/a//')).toBe('https://example.com/a')
  })

  it('缺少协议时补 https', () => {
    expect(normalizeUrlKey('example.com')).toBe('https://example.com')
    expect(normalizeUrlKey('example.com/a?b=1')).toBe('https://example.com/a?b=1')
  })

  it('既有行为：「host:port」无协议时会被当成 scheme（搬迁时保持不变）', () => {
    // 正则 `^[a-z][a-z0-9+.-]*:` 会把 `example.com:` 误判为协议，这是原实现的既有行为。
    // 本次只搬迁不改语义：宁可保留这个怪癖，也不要在导入去重上悄悄改变判定结果。
    expect(normalizeUrlKey('example.com:8080/a')).toBe('example.com://8080/a')
    expect(normalizeUrlKey('https://example.com:8080/a')).toBe('https://example.com:8080/a')
  })

  it('已有协议原样保留：http 与 https 是两个不同的键', () => {
    expect(normalizeUrlKey('http://example.com')).toBe('http://example.com')
    expect(normalizeUrlKey('http://example.com')).not.toBe(normalizeUrlKey('example.com'))
  })

  it('保留 query 与 hash（query 不同即不同键）', () => {
    expect(normalizeUrlKey('https://example.com/a/?x=1#y')).toBe('https://example.com/a?x=1#y')
    expect(normalizeUrlKey('https://example.com/a?x=1')).not.toBe(
      normalizeUrlKey('https://example.com/a?x=2')
    )
  })

  it('先 trim 首尾空白', () => {
    expect(normalizeUrlKey('  https://Example.com/  ')).toBe('https://example.com')
  })

  it('非字符串 / 空串 / 纯空白 → 空键（调用方据此跳过分组）', () => {
    expect(normalizeUrlKey(null)).toBe('')
    expect(normalizeUrlKey(undefined)).toBe('')
    expect(normalizeUrlKey(42)).toBe('')
    expect(normalizeUrlKey({ url: 'https://example.com' })).toBe('')
    expect(normalizeUrlKey('')).toBe('')
    expect(normalizeUrlKey('   ')).toBe('')
  })

  it('无法解析时退化为「去尾部斜杠 + 小写」', () => {
    expect(normalizeUrlKey('Not A Url/')).toBe('not a url')
    expect(normalizeUrlKey('://broken')).toBe('://broken')
  })

  it('与搬迁前的实现逐分支等价', () => {
    const samples: unknown[] = [
      'https://Example.com/',
      'https://example.com',
      'example.com',
      'example.com/a?b=1#c',
      'http://example.com/',
      'HTTPS://EXAMPLE.COM//',
      'ftp://Example.com/x/',
      '  https://example.com/path/  ',
      'https://example.com:8080/',
      'example.com:8080/a',
      'https://example.com/路径/',
      'https://example.com/a%20b/',
      'Not A Url/',
      '://broken',
      'a=1&amp;b=2',
      '',
      '   ',
      null,
      undefined,
      0,
      []
    ]

    for (const sample of samples) {
      expect(normalizeUrlKey(sample)).toBe(legacyNormalizeUrlKey(sample))
    }
  })
})

describe('groupDuplicates', () => {
  it('键为空（URL 为空 / 不可解析）不参与分组', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', url: '' }),
      candidate({ id: 'b', url: '' }),
      candidate({ id: 'c', url: undefined }),
      candidate({ id: 'd', url: 'Not A Url' }),
      candidate({ id: 'e', url: 'Not A Url/' })
    ])

    // a/b/c 没有键；d/e 归一化后同键（'not a url'）→ 只有这一组
    expect([...groups.keys()]).toEqual(['not a url'])
    expect(groups.get('not a url')?.map(item => item.id)).toEqual(['d', 'e'])
  })

  it('多组并存，组内保持入参顺序', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a1', url: 'https://Example.com/' }),
      candidate({ id: 'b1', url: 'https://b.example.com/x' }),
      candidate({ id: 'a2', url: 'example.com' }),
      candidate({ id: 'b2', url: 'https://b.example.com/x/' }),
      candidate({ id: 'a3', url: 'https://example.com' })
    ])

    expect([...groups.keys()]).toEqual(['https://example.com', 'https://b.example.com/x'])
    expect(groups.get('https://example.com')?.map(item => item.id)).toEqual(['a1', 'a2', 'a3'])
    expect(groups.get('https://b.example.com/x')?.map(item => item.id)).toEqual(['b1', 'b2'])
  })

  it('单条不成组（只返回成员数 ≥ 2 的组）', () => {
    const groups = groupDuplicates([candidate({ id: 'solo', url: 'https://solo.example.com' })])
    expect(groups.size).toBe(0)
  })

  it('缺 id 的记录不参与分组（无法安全定位/删除）', () => {
    const groups = groupDuplicates([
      candidate({ id: undefined, url: 'https://example.com' }),
      candidate({ id: 'a', url: 'https://example.com' })
    ])
    expect(groups.size).toBe(0)
  })
})

describe('pickKeeper', () => {
  it('pinned 优先于其它一切条件', () => {
    const keeper = pickKeeper([
      candidate({ id: 'a', visitCount: 99, createdAt: '2020-01-01T00:00:00.000Z' }),
      candidate({ id: 'z', pinned: true, visitCount: 0, createdAt: '2024-01-01T00:00:00.000Z' })
    ])
    expect(keeper.id).toBe('z')
  })

  it('pinned 相同时 visitCount 大者优先', () => {
    const keeper = pickKeeper([
      candidate({ id: 'a', visitCount: 2 }),
      candidate({ id: 'b', visitCount: 7 })
    ])
    expect(keeper.id).toBe('b')
  })

  it('visitCount 相同时 createdAt 早者优先', () => {
    const keeper = pickKeeper([
      candidate({ id: 'a', createdAt: '2024-02-01T00:00:00.000Z' }),
      candidate({ id: 'b', createdAt: '2023-12-01T00:00:00.000Z' })
    ])
    expect(keeper.id).toBe('b')
  })

  it('一切并列时按 id 字典序升序（确定性）', () => {
    const keeper = pickKeeper([
      candidate({ id: 'c' }),
      candidate({ id: 'a' }),
      candidate({ id: 'b' })
    ])
    expect(keeper.id).toBe('a')
  })

  it('visitCount 为脏值（NaN / 缺失）时按 0 比较', () => {
    const keeper = pickKeeper([
      candidate({ id: 'a', visitCount: Number.NaN }),
      candidate({ id: 'b', visitCount: undefined })
    ])
    expect(keeper.id).toBe('a') // 并列 → id 升序
  })
})

describe('mergeGroup', () => {
  it('tags：keeper 在前，按组内顺序并集去重', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', tags: ['t1', 't2'] }),
        candidate({ id: 'b', tags: ['t2', 't3'] }),
        candidate({ id: 'c', tags: ['t4', 't1'] })
      ],
      NOW
    )

    expect(merged.id).toBe('a')
    expect(merged.tags).toEqual(['t1', 't2', 't3', 't4'])
  })

  it('visitCount：全组求和，非有限数按 0', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', visitCount: 3 }),
        candidate({ id: 'b', visitCount: Number.NaN }),
        candidate({ id: 'c', visitCount: undefined }),
        candidate({ id: 'd', visitCount: 4 })
      ],
      NOW
    )

    expect(merged.visitCount).toBe(7)
  })

  it('lastVisited：全组可解析时间的最大值（原样保留字符串）', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', lastVisited: '2024-01-01T00:00:00.000Z' }),
        candidate({ id: 'b', lastVisited: '2024-03-01T00:00:00.000Z' }),
        candidate({ id: 'c', lastVisited: 'not-a-date' }),
        candidate({ id: 'd', lastVisited: null })
      ],
      NOW
    )

    expect(merged.lastVisited).toBe('2024-03-01T00:00:00.000Z')
  })

  it('lastVisited：全部不可解析时归 null', () => {
    const merged = mergeGroup(
      [candidate({ id: 'a', lastVisited: 'not-a-date' }), candidate({ id: 'b', lastVisited: null })],
      NOW
    )

    expect(merged.lastVisited).toBeNull()
  })

  it('pinned：任一为 true 即 true', () => {
    const merged = mergeGroup(
      [candidate({ id: 'a' }), candidate({ id: 'b', pinned: true })],
      NOW
    )
    expect(merged.pinned).toBe(true)
  })

  it('createdAt：取全组最早的合法时间', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', createdAt: '2024-02-01T00:00:00.000Z' }),
        candidate({ id: 'b', createdAt: '2023-12-01T00:00:00.000Z' }),
        candidate({ id: 'c', createdAt: 'bogus' })
      ],
      NOW
    )

    expect(merged.createdAt).toBe('2023-12-01T00:00:00.000Z')
  })

  it('createdAt：全部非法时保留 keeper 原值', () => {
    const merged = mergeGroup(
      [candidate({ id: 'a', createdAt: 'bogus' }), candidate({ id: 'b', createdAt: '' })],
      NOW
    )

    expect(merged.createdAt).toBe('bogus')
  })

  it('title / description / folderId：keeper 为空时回填组内第一个非空值', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', title: '', description: '', folderId: '' }),
        candidate({ id: 'b', title: 'B', description: 'desc-b', folderId: 'folder-b' }),
        candidate({ id: 'c', title: 'C', description: 'desc-c', folderId: 'folder-c' })
      ],
      NOW
    )

    // keeper 是 a（id 升序），三个字段都从 b 回填
    expect(merged.id).toBe('a')
    expect(merged.title).toBe('B')
    expect(merged.description).toBe('desc-b')
    expect(merged.folderId).toBe('folder-b')
  })

  it('keeper 非空时优先用 keeper 的值（不会被 donors 覆盖）', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', title: 'A', description: 'desc-a', folderId: 'folder-a' }),
        candidate({ id: 'b', title: 'B', description: 'desc-b', folderId: 'folder-b' })
      ],
      NOW
    )

    expect(merged.title).toBe('A')
    expect(merged.description).toBe('desc-a')
    expect(merged.folderId).toBe('folder-a')
  })

  it('linkStatus：keeper 有则用 keeper，否则取组内第一个有结论的，都没有则不带该键', () => {
    const keeperUnknown = { ok: null, status: 403, checkedAt: '2024-04-01T00:00:00.000Z' }
    const donorBroken = { ok: false, status: 404, checkedAt: '2024-04-02T00:00:00.000Z' }

    const fromKeeper = mergeGroup(
      [candidate({ id: 'a', linkStatus: keeperUnknown }), candidate({ id: 'b', linkStatus: donorBroken })],
      NOW
    )
    expect(fromKeeper.linkStatus).toEqual(keeperUnknown)

    const fromDonor = mergeGroup(
      [
        candidate({ id: 'a', linkStatus: null }),
        candidate({ id: 'b', linkStatus: undefined }),
        candidate({ id: 'c', linkStatus: donorBroken })
      ],
      NOW
    )
    expect(fromDonor.linkStatus).toEqual(donorBroken)

    const none = mergeGroup([candidate({ id: 'a' }), candidate({ id: 'b', linkStatus: null })], NOW)
    expect('linkStatus' in none).toBe(false)
  })

  it('url 与 updatedAt：url 取 keeper 的，updatedAt 取 now', () => {
    const merged = mergeGroup(
      [
        candidate({ id: 'a', url: 'https://Example.com/' }),
        candidate({ id: 'b', url: 'example.com' })
      ],
      NOW
    )

    expect(merged.url).toBe('https://Example.com/')
    expect(merged.updatedAt).toBe(NOW.toISOString())
  })
})

describe('planDuplicateMerges', () => {
  const items = [
    candidate({ id: 'a1', url: 'https://Example.com/', tags: ['t1'] }),
    candidate({ id: 'u1', url: 'https://unique.example.com/' }),
    candidate({ id: 'a2', url: 'example.com', tags: ['t2'] }),
    candidate({ id: 'b1', url: 'https://b.example.com/x' }),
    candidate({ id: 'b2', url: 'https://b.example.com/x/' }),
    candidate({ id: 'b3', url: 'https://b.example.com/x//' })
  ]

  it('groups / redundantCount / donorIds 正确', () => {
    const plan = planDuplicateMerges(items, NOW)

    expect(plan.duplicateGroups).toBe(2)
    // (3-1) + (2-1)
    expect(plan.redundantCount).toBe(3)
    expect(plan.donorIds).toEqual(['a2', 'b2', 'b3'])
    expect(plan.keepers.map(keeper => keeper.id)).toEqual(['a1', 'b1'])
    expect(plan.groups).toEqual([
      { key: 'https://example.com', keepId: 'a1', memberIds: ['a1', 'a2'] },
      { key: 'https://b.example.com/x', keepId: 'b1', memberIds: ['b1', 'b2', 'b3'] }
    ])
  })

  it('keepers[].fields 带上合并后的字段（不含 id）', () => {
    const plan = planDuplicateMerges(items, NOW)
    const gatekeeper = plan.keepers[0]

    expect(gatekeeper.id).toBe('a1')
    expect(gatekeeper.fields.tags).toEqual(['t1', 't2'])
    expect(gatekeeper.fields.updatedAt).toBe(NOW.toISOString())
    expect('id' in gatekeeper.fields).toBe(false)
  })

  it('不修改入参', () => {
    const snapshot = JSON.parse(JSON.stringify(items))
    planDuplicateMerges(items, NOW)
    expect(JSON.parse(JSON.stringify(items))).toEqual(snapshot)
  })

  it('无重复时返回全 0 计划', () => {
    const plan = planDuplicateMerges([candidate({ id: 'a' })], NOW)
    expect(plan).toEqual({
      duplicateGroups: 0,
      redundantCount: 0,
      keepers: [],
      donorIds: [],
      groups: []
    })
  })
})

describe('filterBookmarksByIds（bulk-delete 与合并共用）', () => {
  it('返回剩余记录、实际删除条数与未找到的 id', async () => {
    const { filterBookmarksByIds } = await import('../electron/ipc/bookmarks')
    const bookmarks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

    const result = filterBookmarksByIds(bookmarks, ['b', 'zz', 'b'])

    expect(result.deleted).toBe(1)
    expect(result.missing).toEqual(['zz'])
    expect(result.remaining.map(bookmark => bookmark.id)).toEqual(['a', 'c'])
    // 纯函数：不改入参
    expect(bookmarks.map(bookmark => bookmark.id)).toEqual(['a', 'b', 'c'])
  })

  it('空 id 列表不删除任何记录', async () => {
    const { filterBookmarksByIds } = await import('../electron/ipc/bookmarks')
    const result = filterBookmarksByIds([{ id: 'a' }], [])
    expect(result).toEqual({ remaining: [{ id: 'a' }], deleted: 0, missing: [] })
  })
})

describe('merge-duplicates（主进程）', () => {
  let dataDir = ''

  const bookmarksFile = () => path.join(dataDir, 'bookmarks.json')

  const writeBookmarks = (list: unknown[]) => {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(bookmarksFile(), JSON.stringify(list, null, 2), 'utf-8')
  }

  const readBookmarks = (): Array<Record<string, unknown>> =>
    JSON.parse(fs.readFileSync(bookmarksFile(), 'utf-8'))

  /** 已注册的 handler 直接调用（不经过 ipcRenderer，也就没有序列化/包装） */
  const invokeMerge = async () => {
    const { electronStub } = await import('./helpers/electron-stub')
    const handler = electronStub.ipcMain.handlers.get('merge-duplicates')
    expect(typeof handler).toBe('function')
    return (handler as () => {
      groups: number
      removed: number
      bookmarks: Array<Record<string, unknown>>
    })()
  }

  beforeEach(async () => {
    dataDir = useTempUserData()
    fs.mkdirSync(dataDir, { recursive: true })
    const { registerBookmarkHandlers } = await import('../electron/ipc/bookmarks')
    registerBookmarkHandlers()
  })

  it('没有重复时不写盘', async () => {
    writeBookmarks([
      candidate({ id: 'a', url: 'https://example.com/a' }),
      candidate({ id: 'b', url: 'https://example.com/b' })
    ])

    const before = fs.readFileSync(bookmarksFile(), 'utf-8')
    const beforeMtime = fs.statSync(bookmarksFile()).mtimeMs
    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const result = await invokeMerge()

      expect(result.groups).toBe(0)
      expect(result.removed).toBe(0)
      expect(result.bookmarks.map(bookmark => bookmark.id)).toEqual(['a', 'b'])
      expect(renameSpy).not.toHaveBeenCalled()
      expect(fs.readFileSync(bookmarksFile(), 'utf-8')).toBe(before)
      expect(fs.statSync(bookmarksFile()).mtimeMs).toBe(beforeMtime)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('一次写入完成合并：keeper 位置不变、donors 进回收站、字段已合并', async () => {
    writeBookmarks([
      { ...candidate({ id: 'a1', url: 'https://Example.com/', title: '', visitCount: 3 }), tags: ['t1'] },
      candidate({ id: 'u1', url: 'https://unique.example.com/', title: 'U1' }),
      candidate({ id: 'a2', url: 'example.com', title: 'A2', visitCount: 2 }),
      candidate({ id: 'b1', url: 'https://b.example.com/x', title: 'B1' }),
      candidate({ id: 'b2', url: 'https://b.example.com/x/', title: 'B2' }),
      // 这一组的 keeper 不在组内首位：c2 置顶胜出，c1 成为 donor
      candidate({ id: 'c1', url: 'https://c.example.com/', title: 'C1' }),
      candidate({ id: 'c2', url: 'https://c.example.com', title: 'C2', pinned: true })
    ])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const result = await invokeMerge()

      // 唯一一次写盘（原子写 = 一次 rename，目标就是 bookmarks.json）
      expect(renameSpy).toHaveBeenCalledTimes(1)
      expect(String(renameSpy.mock.calls[0][1]).endsWith('bookmarks.json')).toBe(true)

      expect(result.groups).toBe(3)
      expect(result.removed).toBe(3)

      const saved = readBookmarks()
      // donors 是**软删除**（写 deletedAt），记录与顺序都不变：keeper 仍在原下标
      expect(saved.map(bookmark => bookmark.id)).toEqual(['a1', 'u1', 'a2', 'b1', 'b2', 'c1', 'c2'])

      const donorIds = ['a2', 'b2', 'c1']
      for (const id of donorIds) {
        const donor = saved.find(bookmark => bookmark.id === id)
        expect(donor).toBeDefined()
        expect(typeof donor?.deletedAt).toBe('string')
      }

      // 未被合并的记录不受影响
      const unique = saved.find(bookmark => bookmark.id === 'u1')
      expect(unique?.deletedAt).toBeNull()

      const keeper = saved[0]
      expect(keeper.id).toBe('a1')
      expect(keeper.deletedAt).toBeNull()
      expect(keeper.url).toBe('https://Example.com/') // url 取 keeper
      expect(keeper.title).toBe('A2') // keeper 标题为空 → 回填组内第一个非空
      expect(keeper.tags).toEqual(['t1'])
      expect(keeper.visitCount).toBe(5) // 3 + 2
      expect(typeof keeper.updatedAt).toBe('string')
      expect(keeper.updatedAt).not.toBe('2024-01-01T00:00:00.000Z')

      // keeper 不在首位时同样保留原下标（c2 仍在最后，不会被搬到组内首位）
      const pinnedKeeper = saved.find(bookmark => bookmark.id === 'c2')
      expect(pinnedKeeper?.pinned).toBe(true)
      expect(pinnedKeeper?.deletedAt).toBeNull()

      // 返回的列表只含**未删除**记录（与主列表 `get-bookmarks` 一致）
      expect(result.bookmarks.map(bookmark => bookmark.id)).toEqual(['a1', 'u1', 'b1', 'c2'])
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('donors 只是软删除：访问历史保留（可恢复），合并结果不受影响', async () => {
    const historyFile = path.join(dataDir, 'history.json')
    fs.writeFileSync(
      historyFile,
      JSON.stringify([
        { bookmarkId: 'a1', visitedAt: '2024-04-01T00:00:00.000Z' },
        { bookmarkId: 'a2', visitedAt: '2024-04-02T00:00:00.000Z' }
      ]),
      'utf-8'
    )
    writeBookmarks([
      candidate({ id: 'a1', url: 'https://example.com' }),
      candidate({ id: 'a2', url: 'https://example.com/' })
    ])

    const result = await invokeMerge()

    expect(result.removed).toBe(1)
    // 软删除可恢复 → 历史必须留着，否则恢复后趋势图会凭空少一段
    const history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'))
    expect(history).toEqual([
      { bookmarkId: 'a1', visitedAt: '2024-04-01T00:00:00.000Z' },
      { bookmarkId: 'a2', visitedAt: '2024-04-02T00:00:00.000Z' }
    ])
  })
})
