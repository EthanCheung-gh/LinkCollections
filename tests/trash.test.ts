import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempUserData } from './helpers/electron-stub'
import { groupDuplicates, planDuplicateMerges, type DuplicateCandidate } from '../shared/duplicates'

/**
 * 回收站（软删除 / 恢复 / 永久删除 / 过期清理）。
 *
 * 覆盖四层：
 *  1. schema v3 迁移（`add-bookmark-deletedAt`）；
 *  2. 主进程 handler 的软删除 / 恢复 / 永久删除 / 启动清理（真实读写临时数据目录）；
 *  3. 计划层（`shared/duplicates.ts`）跳过已删除记录；
 *  4. 写路径（update / visit）对已删除记录视为「未找到」。
 *
 * 所有 handler 都通过 `electronStub.ipcMain.handlers` 直接调用（不经 ipcRenderer，
 * 也就没有序列化包装），并用 `fs.renameSync` 打点验证「一次写盘 / 不写盘」。
 */

vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

const DAY_MS = 86_400_000
const NOW = new Date('2024-05-01T00:00:00.000Z')

let dataDir = ''

const file = (name: string) => path.join(dataDir, name)

const writeJson = (name: string, data: unknown) => {
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(file(name), JSON.stringify(data, null, 2), 'utf-8')
}

const readJson = <T>(name: string): T => JSON.parse(fs.readFileSync(file(name), 'utf-8')) as T

/** 构造一条完整书签（默认**未删除**，字段与落盘对象一致） */
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

const ids = (list: unknown[]): unknown[] =>
  (list as Array<{ id: string }>).map(record => record.id)

beforeEach(() => {
  dataDir = useTempUserData()
  fs.mkdirSync(dataDir, { recursive: true })
})

/* ------------------------------------------------------------------ *
 * 1. schema v3 迁移
 * ------------------------------------------------------------------ */

describe('schema v3：add-bookmark-deletedAt', () => {
  it('缺字段的记录补 deletedAt:null，meta 从 2 推进到 3', async () => {
    writeJson('meta.json', { schemaVersion: 2 })
    writeJson('bookmarks.json', [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' }
    ])

    const { runDataMigrations, DATA_SCHEMA_VERSION } = await import('../electron/utils/schema')
    const result = runDataMigrations()

    expect(DATA_SCHEMA_VERSION).toBe(3)
    expect(result.from).toBe(2)
    expect(result.to).toBe(3)
    expect(result.applied).toEqual(['add-bookmark-deletedAt'])
    expect(readJson('bookmarks.json')).toEqual([
      { id: 'a', title: 'A', deletedAt: null },
      { id: 'b', title: 'B', deletedAt: null }
    ])
    expect(readJson('meta.json')).toEqual({ schemaVersion: 3 })
  })

  it('已有 null / 已有 ISO 字符串不被改写，脏值收敛为 null', async () => {
    const deletedAt = '2024-05-01T00:00:00.000Z'
    writeJson('meta.json', { schemaVersion: 2 })
    writeJson('bookmarks.json', [
      { id: 'null', deletedAt: null },
      { id: 'deleted', deletedAt },
      { id: 'number', deletedAt: 123 },
      { id: 'object', deletedAt: { at: deletedAt } }
    ])

    const { runDataMigrations } = await import('../electron/utils/schema')
    runDataMigrations()

    const saved = readJson<Array<{ id: string; deletedAt: unknown }>>('bookmarks.json')
    expect(saved).toEqual([
      { id: 'null', deletedAt: null },
      { id: 'deleted', deletedAt },
      { id: 'number', deletedAt: null },
      { id: 'object', deletedAt: null }
    ])
  })

  it('没有记录需要改时不写 bookmarks.json', async () => {
    writeJson('meta.json', { schemaVersion: 2 })
    writeJson('bookmarks.json', [
      { id: 'a', deletedAt: null },
      { id: 'b', deletedAt: '2024-05-01T00:00:00.000Z' }
    ])

    const before = fs.readFileSync(file('bookmarks.json'), 'utf-8')
    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const { runDataMigrations } = await import('../electron/utils/schema')
      runDataMigrations()

      const touchedBookmarks = renameSpy.mock.calls.some(call =>
        String(call[1]).endsWith('bookmarks.json')
      )
      expect(touchedBookmarks).toBe(false)
      expect(fs.readFileSync(file('bookmarks.json'), 'utf-8')).toBe(before)
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('重复执行幂等：第二次不产生任何迁移步骤', async () => {
    writeJson('meta.json', { schemaVersion: 2 })
    writeJson('bookmarks.json', [{ id: 'a' }])

    const { runDataMigrations } = await import('../electron/utils/schema')
    runDataMigrations()

    const snapshot = fs.readFileSync(file('bookmarks.json'), 'utf-8')
    const second = runDataMigrations()

    expect(second.from).toBe(3)
    expect(second.to).toBe(3)
    expect(second.applied).toEqual([])
    expect(fs.readFileSync(file('bookmarks.json'), 'utf-8')).toBe(snapshot)
  })
})

/* ------------------------------------------------------------------ *
 * 2. 软删除 / 批量软删除 / 恢复 / 永久删除 / 过期清理
 * ------------------------------------------------------------------ */

describe('回收站 handler', () => {
  beforeEach(async () => {
    const { registerBookmarkHandlers } = await import('../electron/ipc/bookmarks')
    registerBookmarkHandlers()
  })

  it('delete-bookmark 只写 deletedAt：主列表不含它、回收站含它、历史保留', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'a' }), bookmark({ id: 'b' })])
    writeJson('history.json', [visit('a', '2024-04-01T00:00:00.000Z')])

    await invoke('delete-bookmark', 'a')

    const active = (await invoke('get-bookmarks')) as Array<Record<string, unknown>>
    expect(ids(active)).toEqual(['b'])

    const trashed = (await invoke('get-deleted-bookmarks')) as Array<Record<string, unknown>>
    expect(ids(trashed)).toEqual(['a'])
    expect(typeof trashed[0].deletedAt).toBe('string')
    expect(Number.isFinite(Date.parse(String(trashed[0].deletedAt)))).toBe(true)

    // 软删除：记录仍在文件里，字段不变
    const saved = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    expect(ids(saved)).toEqual(['a', 'b'])
    expect(saved[0].title).toBe('A')

    // 可恢复 → 历史**不**清理
    expect(readJson('history.json')).toEqual([visit('a', '2024-04-01T00:00:00.000Z')])
  })

  it('delete-bookmark 对已在回收站里的 id 报 not found（不刷新 deletedAt）', async () => {
    const deletedAt = '2024-04-01T00:00:00.000Z'
    writeJson('bookmarks.json', [bookmark({ id: 'a', deletedAt })])

    await expect(invoke('delete-bookmark', 'a')).rejects.toThrow('Bookmark not found')
    expect(readJson<Array<Record<string, unknown>>>('bookmarks.json')[0].deletedAt).toBe(deletedAt)
  })

  it('get-deleted-bookmarks 按 deletedAt 倒序', async () => {
    writeJson('bookmarks.json', [
      bookmark({ id: 'old', deletedAt: '2024-03-01T00:00:00.000Z' }),
      bookmark({ id: 'new', deletedAt: '2024-04-01T00:00:00.000Z' }),
      bookmark({ id: 'active' })
    ])

    const trashed = (await invoke('get-deleted-bookmarks')) as Array<Record<string, unknown>>
    expect(ids(trashed)).toEqual(['new', 'old'])
  })

  it('bulk-delete-bookmarks 批量软删除：一次写盘、deleted/missing 正确、历史保留', async () => {
    writeJson('bookmarks.json', [
      bookmark({ id: 'a' }),
      bookmark({ id: 'b' }),
      bookmark({ id: 'c' })
    ])
    writeJson('history.json', [
      visit('a', '2024-04-01T00:00:00.000Z'),
      visit('c', '2024-04-02T00:00:00.000Z')
    ])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const result = (await invoke('bulk-delete-bookmarks', ['a', 'c', 'zz', 'a'])) as {
        deleted: number
        missing: string[]
      }

      expect(result.deleted).toBe(2)
      expect(result.missing).toEqual(['zz'])

      // 唯一一次写盘，且只写 bookmarks.json（历史不清理）
      expect(renameSpy).toHaveBeenCalledTimes(1)
      expect(String(renameSpy.mock.calls[0][1]).endsWith('bookmarks.json')).toBe(true)
    } finally {
      renameSpy.mockRestore()
    }

    expect(ids((await invoke('get-bookmarks')) as unknown[])).toEqual(['b'])
    expect(ids((await invoke('get-deleted-bookmarks')) as unknown[])).toEqual(['a', 'c'])
    expect(readJson('history.json')).toHaveLength(2)
  })

  it('bulk-delete-bookmarks 空 ids / 全部已删除时不写盘', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'a', deletedAt: '2024-04-01T00:00:00.000Z' })])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      expect(await invoke('bulk-delete-bookmarks', [])).toEqual({ deleted: 0, missing: [] })
      expect(await invoke('bulk-delete-bookmarks', ['a'])).toEqual({ deleted: 0, missing: ['a'] })
      expect(renameSpy).not.toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('restore-bookmarks 恢复记录且字段不丢；不存在/未删除的 id 计入 missing', async () => {
    const linkStatus = { ok: false, status: 404, checkedAt: '2024-04-20T00:00:00.000Z' }
    writeJson('bookmarks.json', [
      bookmark({
        id: 'a',
        visitCount: 7,
        tags: ['t1', 't2'],
        linkStatus,
        deletedAt: '2024-04-25T00:00:00.000Z'
      }),
      bookmark({ id: 'b' })
    ])

    const result = (await invoke('restore-bookmarks', ['a', 'b', 'zz'])) as {
      restored: number
      missing: string[]
      bookmarks: Array<Record<string, unknown>>
    }

    expect(result.restored).toBe(1)
    expect(result.missing).toEqual(['b', 'zz'])
    expect(ids(result.bookmarks)).toEqual(['a', 'b'])

    const restored = result.bookmarks[0]
    expect(restored.deletedAt).toBeNull()
    expect(restored.visitCount).toBe(7)
    expect(restored.tags).toEqual(['t1', 't2'])
    expect(restored.linkStatus).toEqual(linkStatus)

    // 回收站已空，主列表已包含它
    expect(await invoke('get-deleted-bookmarks')).toEqual([])
    expect(ids((await invoke('get-bookmarks')) as unknown[])).toEqual(['a', 'b'])
  })

  it('restore-bookmarks 空 ids 时不写盘', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'a', deletedAt: '2024-04-25T00:00:00.000Z' })])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const result = (await invoke('restore-bookmarks', [])) as {
        restored: number
        missing: string[]
        bookmarks: unknown[]
      }
      expect(result.restored).toBe(0)
      expect(result.missing).toEqual([])
      expect(ids(result.bookmarks)).toEqual([])
      expect(renameSpy).not.toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('purge-bookmarks 从文件里彻底消失并清理对应历史', async () => {
    writeJson('bookmarks.json', [
      bookmark({ id: 'a' }),
      bookmark({ id: 'b', deletedAt: '2024-04-25T00:00:00.000Z' })
    ])
    writeJson('history.json', [
      visit('a', '2024-04-01T00:00:00.000Z'),
      visit('b', '2024-04-02T00:00:00.000Z')
    ])

    const result = (await invoke('purge-bookmarks', ['b', 'zz'])) as {
      purged: number
      bookmarks: Array<Record<string, unknown>>
      trashed: Array<Record<string, unknown>>
    }

    expect(result.purged).toBe(1)
    expect(ids(result.bookmarks)).toEqual(['a'])
    expect(result.trashed).toEqual([])

    expect(ids(readJson<Array<Record<string, unknown>>>('bookmarks.json'))).toEqual(['a'])
    expect(readJson('history.json')).toEqual([visit('a', '2024-04-01T00:00:00.000Z')])
  })

  it('empty-trash 永久删除全部已删除记录并清理其历史', async () => {
    writeJson('bookmarks.json', [
      bookmark({ id: 'a' }),
      bookmark({ id: 'b', deletedAt: '2024-04-25T00:00:00.000Z' }),
      bookmark({ id: 'c', deletedAt: '2024-04-26T00:00:00.000Z' })
    ])
    writeJson('history.json', [
      visit('a', '2024-04-01T00:00:00.000Z'),
      visit('b', '2024-04-02T00:00:00.000Z'),
      visit('c', '2024-04-03T00:00:00.000Z')
    ])

    const result = (await invoke('empty-trash')) as {
      purged: number
      bookmarks: Array<Record<string, unknown>>
    }

    expect(result.purged).toBe(2)
    expect(ids(result.bookmarks)).toEqual(['a'])
    expect(ids(readJson<Array<Record<string, unknown>>>('bookmarks.json'))).toEqual(['a'])
    expect(readJson('history.json')).toEqual([visit('a', '2024-04-01T00:00:00.000Z')])
  })

  it('empty-trash 回收站为空时不写盘', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'a' })])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const result = (await invoke('empty-trash')) as { purged: number }
      expect(result.purged).toBe(0)
      expect(renameSpy).not.toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
    }
  })

  it('purgeExpiredTrash 只清理超过 30 天的记录，边界值保留', async () => {
    const now = Date.parse('2024-06-01T00:00:00.000Z')
    const at = (msAgo: number) => new Date(now - msAgo).toISOString()

    writeJson('bookmarks.json', [
      bookmark({ id: 'expired', deletedAt: at(31 * DAY_MS) }),
      // 正好 30 天：不算过期（用 `<` 而不是 `<=`）
      bookmark({ id: 'boundary', deletedAt: at(30 * DAY_MS) }),
      bookmark({ id: 'fresh', deletedAt: at(DAY_MS) }),
      bookmark({ id: 'active' }),
      // 时间不可解析：无法判定年龄，保留
      bookmark({ id: 'dirty', deletedAt: 'not-a-date' })
    ])
    writeJson('history.json', [
      visit('expired', '2024-04-01T00:00:00.000Z'),
      visit('boundary', '2024-04-02T00:00:00.000Z')
    ])

    const { purgeExpiredTrash, TRASH_RETENTION_DAYS } = await import('../electron/ipc/bookmarks')
    expect(TRASH_RETENTION_DAYS).toBe(30)

    const result = purgeExpiredTrash(now)

    expect(result.purged).toBe(1)
    expect(ids(readJson<Array<Record<string, unknown>>>('bookmarks.json'))).toEqual([
      'boundary',
      'fresh',
      'active',
      'dirty'
    ])
    // 只清理过期记录的历史
    expect(readJson('history.json')).toEqual([visit('boundary', '2024-04-02T00:00:00.000Z')])
  })

  it('purgeExpiredTrash 没有过期记录时不写盘', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'a' }), bookmark({ id: 'b' })])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      const { purgeExpiredTrash } = await import('../electron/ipc/bookmarks')
      expect(purgeExpiredTrash().purged).toBe(0)
      expect(renameSpy).not.toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
    }
  })
})

/* ------------------------------------------------------------------ *
 * 3. 合并计划层跳过已删除记录
 * ------------------------------------------------------------------ */

describe('重复合并跳过已删除记录（计划层）', () => {
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
    deletedAt: null,
    ...over
  })

  it('groupDuplicates 忽略已删除记录：只剩一条活跃记录时不成组', () => {
    const groups = groupDuplicates([
      candidate({ id: 'a', url: 'https://example.com' }),
      candidate({ id: 'b', url: 'https://example.com/', deletedAt: '2024-04-01T00:00:00.000Z' })
    ])

    expect(groups.size).toBe(0)
  })

  it('planDuplicateMerges 不会把已删除记录当成 keeper 或 donor', () => {
    const plan = planDuplicateMerges(
      [
        candidate({ id: 'a1', url: 'https://example.com' }),
        // 若参与计划，它会因为 pinned + visitCount 胜出成为 keeper
        candidate({
          id: 'a2',
          url: 'https://example.com/',
          pinned: true,
          visitCount: 99,
          deletedAt: '2024-04-01T00:00:00.000Z'
        }),
        candidate({ id: 'a3', url: 'example.com' })
      ],
      NOW
    )

    expect(plan.duplicateGroups).toBe(1)
    expect(plan.groups[0].memberIds).toEqual(['a1', 'a3'])
    expect(plan.groups[0].keepId).toBe('a1')
    expect(plan.donorIds).toEqual(['a3'])
    expect(plan.redundantCount).toBe(1)

    // deletedAt 只是过滤依据，不会被合并进 keeper 的字段
    expect('deletedAt' in plan.keepers[0].fields).toBe(false)
  })

  it('全部成员都已删除时计划为空', () => {
    const plan = planDuplicateMerges(
      [
        candidate({ id: 'a', deletedAt: '2024-04-01T00:00:00.000Z' }),
        candidate({ id: 'b', deletedAt: '2024-04-02T00:00:00.000Z' })
      ],
      NOW
    )

    expect(plan).toEqual({
      duplicateGroups: 0,
      redundantCount: 0,
      keepers: [],
      donorIds: [],
      groups: []
    })
  })
})

/* ------------------------------------------------------------------ *
 * 4. 写路径对已删除记录视为「未找到」
 * ------------------------------------------------------------------ */

describe('写路径不碰回收站里的记录', () => {
  beforeEach(async () => {
    const { registerBookmarkHandlers } = await import('../electron/ipc/bookmarks')
    registerBookmarkHandlers()
  })

  it('update-bookmark / increment-visit-count 抛 Bookmark not found，且不复活', async () => {
    const deletedAt = '2024-04-01T00:00:00.000Z'
    writeJson('bookmarks.json', [bookmark({ id: 'a', deletedAt })])

    await expect(invoke('update-bookmark', 'a', { title: 'X' })).rejects.toThrow(
      'Bookmark not found'
    )
    await expect(invoke('increment-visit-count', 'a')).rejects.toThrow('Bookmark not found')

    const saved = readJson<Array<Record<string, unknown>>>('bookmarks.json')
    expect(saved).toHaveLength(1)
    expect(saved[0].deletedAt).toBe(deletedAt)
    expect(saved[0].title).toBe('A')
    expect(saved[0].visitCount).toBe(0)
  })

  it('bulk-update-bookmarks 把已删除记录计入 missing 且不写盘', async () => {
    writeJson('bookmarks.json', [bookmark({ id: 'a', deletedAt: '2024-04-01T00:00:00.000Z' })])

    const renameSpy = vi.spyOn(fs, 'renameSync')

    try {
      expect(await invoke('bulk-update-bookmarks', ['a'], { pinned: true })).toEqual({
        updated: [],
        missing: ['a']
      })
      expect(renameSpy).not.toHaveBeenCalled()
    } finally {
      renameSpy.mockRestore()
    }
  })
})
