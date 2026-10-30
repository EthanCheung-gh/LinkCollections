import fs from 'fs'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTempUserData } from './helpers/electron-stub'

vi.mock('electron', async () => {
  const stub = await import('./helpers/electron-stub')
  return stub.electronStub
})

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'))
const writeJson = (file: string, data: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
}
const exists = (file: string) => fs.existsSync(file)

describe('数据 schema 迁移', () => {
  let dataDir = ''

  beforeEach(() => {
    dataDir = useTempUserData()
    fs.mkdirSync(dataDir, { recursive: true })
  })

  it('全新安装：跑完全部迁移并把 meta 写到当前版本', async () => {
    const { runDataMigrations, DATA_SCHEMA_VERSION } = await import('../electron/utils/schema')
    const result = runDataMigrations()
    expect(result.from).toBe(0)
    expect(result.to).toBe(DATA_SCHEMA_VERSION)
    expect(readJson(path.join(dataDir, 'meta.json'))).toEqual({ schemaVersion: DATA_SCHEMA_VERSION })
    expect(exists(path.join(dataDir, 'history.json'))).toBe(true)
    expect(readJson(path.join(dataDir, 'history.json'))).toEqual([])
  })

  it('v0 → v1 给已有书签补 pinned:false，且不覆盖已有布尔值', async () => {
    writeJson(path.join(dataDir, 'bookmarks.json'), [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', pinned: true },
      { id: 'c', title: 'C', pinned: 'yes' }
    ])
    const { runDataMigrations } = await import('../electron/utils/schema')
    runDataMigrations()
    const bookmarks = readJson(path.join(dataDir, 'bookmarks.json'))
    expect(bookmarks.map((b: { pinned?: unknown }) => b.pinned)).toEqual([false, true, false])
  })

  it('v1 → v2 已存在 history.json 时不覆盖内容', async () => {
    writeJson(path.join(dataDir, 'meta.json'), { schemaVersion: 1 })
    writeJson(path.join(dataDir, 'history.json'), [
      { bookmarkId: 'x', visitedAt: '2024-01-01T00:00:00.000Z' }
    ])
    const { runDataMigrations, DATA_SCHEMA_VERSION } = await import('../electron/utils/schema')
    runDataMigrations()
    expect(readJson(path.join(dataDir, 'history.json'))).toEqual([
      { bookmarkId: 'x', visitedAt: '2024-01-01T00:00:00.000Z' }
    ])
    // 迁移会继续往后跑（v2 → v3 补 deletedAt），因此 meta 落在当前版本
    expect(readJson(path.join(dataDir, 'meta.json'))).toEqual({ schemaVersion: DATA_SCHEMA_VERSION })
  })

  it('重复执行幂等：第二次不产生任何写入', async () => {
    const { runDataMigrations } = await import('../electron/utils/schema')
    runDataMigrations()
    const metaPath = path.join(dataDir, 'meta.json')
    const historyPath = path.join(dataDir, 'history.json')
    const metaBefore = fs.statSync(metaPath).mtimeMs
    const historyBefore = fs.statSync(historyPath).mtimeMs
    const second = runDataMigrations()
    expect(second.applied).toEqual([])
    expect(fs.statSync(metaPath).mtimeMs).toBe(metaBefore)
    expect(fs.statSync(historyPath).mtimeMs).toBe(historyBefore)
  })

  it('数据版本高于代码时不降级、不写盘', async () => {
    writeJson(path.join(dataDir, 'meta.json'), { schemaVersion: 99 })
    const metaPath = path.join(dataDir, 'meta.json')
    const before = fs.readFileSync(metaPath, 'utf-8')
    const { runDataMigrations } = await import('../electron/utils/schema')
    const result = runDataMigrations()
    expect(result.from).toBe(99)
    expect(result.applied).toEqual([])
    expect(fs.readFileSync(metaPath, 'utf-8')).toBe(before)
    expect(exists(path.join(dataDir, 'history.json'))).toBe(false)
  })

  it('meta 内容损坏时按 0 处理并完成迁移', async () => {
    fs.writeFileSync(path.join(dataDir, 'meta.json'), '{ not json', 'utf-8')
    const { runDataMigrations, DATA_SCHEMA_VERSION } = await import('../electron/utils/schema')
    const result = runDataMigrations()
    expect(result.from).toBe(0)
    expect(readJson(path.join(dataDir, 'meta.json'))).toEqual({ schemaVersion: DATA_SCHEMA_VERSION })
  })
})
