import { readJsonFile, writeJsonFile } from './storage'

/**
 * 数据 schema 版本与迁移框架。
 *
 * 数据文件本体保持原有形状（`bookmarks.json` 仍是**数组**），版本号单独存放在
 * `meta.json`（形状 `{ schemaVersion: number }`）。这样做的好处：
 * 1. `import-export.ts` / `ipc/*` 继续按数组读取，无需改动数据契约；
 * 2. 版本文件损坏/丢失时最坏情况是「重跑一次迁移」，而不是丢掉全部书签
 *    （迁移步骤本身必须是幂等的，见 {@link runDataMigrations}）。
 *
 * 读写一律复用 `utils/storage.ts`：原子写（tmp + rename）、损坏文件备份、
 * BOM 容错都在那一层统一处理，这里不要再自己碰 `fs`。
 */

/** 当前代码期望的数据 schema 版本。新增字段/结构变更时自增，并在 MIGRATIONS 里追加一步。 */
export const DATA_SCHEMA_VERSION = 1

/** 存放版本号的元数据文件（与 bookmarks.json 等在同一 data 目录下）。 */
const META_FILE = 'meta.json'

/** 被迁移的数据文件名 */
const BOOKMARKS_FILE = 'bookmarks.json'

export interface SchemaMeta {
  schemaVersion: number
}

/** `runDataMigrations()` 的返回值，供主进程打日志 / 后续排查使用。 */
export interface MigrationResult {
  /** 迁移前的版本（非法值一律折算为 0） */
  from: number
  /** 迁移后的版本；数据来自更新版本时等于 `from`（不降级） */
  to: number
  /** 本次实际执行成功的迁移步骤名，按执行顺序 */
  applied: string[]
}

interface Migration {
  /** 这一步完成后应写入 meta 的目标版本 */
  version: number
  /** 稳定的机器可读名字，只用于日志与故障定位，不要随意改名 */
  name: string
  /** 实际迁移逻辑；抛错表示这一步整体失败（meta 不会被写成新版本） */
  run: () => void
}

/**
 * 文件不存在 / 内容损坏（storage 已备份并返回默认值）时，一律按「未知 / 未迁移」处理。
 */
const DEFAULT_META: SchemaMeta = { schemaVersion: 0 }

/**
 * 版本号归一化：只接受有限数字，向下取整；`undefined` / `null` / 字符串 / 负数 / `NaN`
 * 一律折算为 0 —— 也就是「当作没迁移过，重跑一遍」。迁移步骤幂等，重跑是安全的。
 */
function normalizeVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  const floored = Math.floor(value)
  return floored > 0 ? floored : 0
}

/** 读取当前数据版本；文件缺失或损坏都回落到 0。 */
function readCurrentVersion(): number {
  const meta = readJsonFile<SchemaMeta>(META_FILE, DEFAULT_META)
  return normalizeVersion(meta?.schemaVersion)
}

/** 写入版本号（原子写；失败会抛出，由调用方决定是否中断）。 */
function writeVersion(version: number): void {
  writeJsonFile<SchemaMeta>(META_FILE, { schemaVersion: version })
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * v0 → v1：为旧书签补 `pinned: false`。
 *
 * - 只在字段**缺失**或**非布尔**时补；已经是布尔的原样保留（`true` 不会被冲掉）；
 * - 脏值（`pinned: 'yes'` / `1` / `null`）统一收敛为布尔 `false`；
 * - 一条都不需要补时**不写盘**，避免每次启动都产生一次无意义的磁盘写入；
 * - `bookmarks.json` 读取抛错时让异常向上冒泡：这一步视为失败，
 *   上层不会写 meta，下次启动会重试（步骤本身幂等，重试无副作用）。
 */
function migrateAddPinnedToBookmarks(): void {
  const rawBookmarks = readJsonFile<unknown[]>(BOOKMARKS_FILE, [])
  let patchedCount = 0

  const migrated = rawBookmarks.map(record => {
    if (!isPlainObject(record)) {
      // 非对象条目（历史脏数据）无法安全地「补字段」：保持原样，
      // 读取侧的容错逻辑（toSafeString 等）会继续对付它。
      console.warn('[schema] Skipping non-object bookmark record while adding `pinned`')
      return record
    }

    if (typeof record.pinned === 'boolean') {
      return record
    }

    patchedCount += 1
    return { ...record, pinned: false }
  })

  if (patchedCount === 0) {
    return
  }

  writeJsonFile(BOOKMARKS_FILE, migrated)
}

/**
 * 迁移表：按 `version` 升序执行，`version` 是这一步完成后的目标版本。
 * 以后新增迁移只需 append 一行（例如 `{ version: 2, name: '...', run: ... }`），
 * 并把 {@link DATA_SCHEMA_VERSION} 自增。
 */
const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'add-pinned-to-bookmarks', run: migrateAddPinnedToBookmarks }
]

/**
 * 执行所有待办的数据迁移，在**注册 IPC 处理器之前**调用（见 `electron/main.ts`）。
 *
 * 幂等性
 * - 每一步都设计成「重复执行结果一致」：已经迁移过的数据再次进入时不会产生任何改动，
 *   因此 meta 丢失/被回滚、或某一步写盘失败后重试，都不会破坏数据。
 * - 版本已是 {@link DATA_SCHEMA_VERSION} 时直接返回，**不产生任何磁盘写入**。
 *
 * 失败语义
 * - 某一步抛错 → 立即向上抛出，**不写 meta**（meta 仍停留在上一个成功的版本），
 *   于是下次启动会重试；`main.ts` 只记录 `console.error`，不阻塞启动，
 *   保证用户仍能打开应用导出/抢救数据。
 * - 每步成功后立刻写一次 meta（不是最后统一写）：已完成的部分不会因为后续步骤失败而回退重跑。
 * - 读取到的版本高于 {@link DATA_SCHEMA_VERSION}（数据来自更新的应用版本）时，
 *   记录警告并**不降级、不写盘**，直接返回 —— 避免旧版本代码用旧规则改写新数据。
 *
 * @returns 迁移前后的版本号以及本次执行的步骤名
 * @throws 任何一步迁移或写 meta 失败时抛出（调用方需要 catch，不能让它阻塞启动）
 */
export function runDataMigrations(): MigrationResult {
  const from = readCurrentVersion()

  if (from > DATA_SCHEMA_VERSION) {
    console.warn(
      `[schema] Data schema v${from} is newer than this app supports (v${DATA_SCHEMA_VERSION}); ` +
        'skipping migrations without downgrading or writing.'
    )
    return { from, to: from, applied: [] }
  }

  const pending = MIGRATIONS.filter(migration => migration.version > from).sort(
    (a, b) => a.version - b.version
  )

  if (pending.length === 0) {
    return { from, to: from, applied: [] }
  }

  const applied: string[] = []
  let current = from

  for (const migration of pending) {
    migration.run()
    writeVersion(migration.version)
    current = migration.version
    applied.push(migration.name)
  }

  // 兜底：迁移表最后一步的目标版本理论上等于 DATA_SCHEMA_VERSION；
  // 若以后出现「只写了中间版本」的步骤，这里保证 meta 最终落在当前版本。
  if (current !== DATA_SCHEMA_VERSION) {
    writeVersion(DATA_SCHEMA_VERSION)
    current = DATA_SCHEMA_VERSION
  }

  return { from, to: current, applied }
}
