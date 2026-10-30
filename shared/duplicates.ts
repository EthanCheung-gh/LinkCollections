/**
 * 重复书签的**纯计划层**（不 import electron、不读写盘、不改入参）。
 *
 * 同一份逻辑被三方复用：
 *  - 主进程 `ipc/bookmarks.ts` 的 `merge-duplicates`（真正落盘的一方）；
 *  - 渲染层 `MergeDuplicatesDialog.vue` 之前的预览（`SettingsView.vue` 本地算）；
 *  - 单元测试（`tests/duplicates.test.ts`）。
 *
 * 因此这里只依赖 `normalizeUrlKey`（与导入去重共用的唯一 URL 归一化实现），
 * 其余全部是纯函数：给定同样的入参与 `now`，输出完全确定。
 */
import { normalizeUrlKey } from './url-key'

/**
 * 死链检查结果的最小结构（与 `types/bookmark.ts` 的 `LinkStatus` 结构一致，
 * 但**不跨端 import**：共享层不能依赖渲染层或主进程的类型文件）。
 */
export interface DuplicateLinkStatus {
  ok: boolean | null
  status: number | null
  checkedAt: string
  error?: string
}

/**
 * 参与重复检测的**宽松**记录形状：所有字段可选。
 *
 * 为什么宽松：主进程拿到的是落盘数据，渲染层拿到的是 store 里的对象，两者都可能有
 * 历史脏数据（字段缺失 / 类型不对 / `null`）。这里不做校验，而是在取值处统一兜底，
 * 保证「有脏数据也不会抛错，只是该字段按空值参与合并」。
 */
export interface DuplicateCandidate {
  id?: string
  url?: string
  title?: string
  description?: string
  favicon?: string
  color?: string
  folderId?: string
  tags?: string[]
  visitCount?: number
  lastVisited?: string | null
  createdAt?: string
  pinned?: boolean
  linkStatus?: DuplicateLinkStatus | null
  /**
   * 软删除标记（回收站）：`null` / 缺失 = 未删除，非空字符串 = 已删除。
   *
   * **已删除的记录不参与分组**（见 {@link isDeletedCandidate}）：它们既不会被选成
   * keeper，也不会被当成 donor 软删除，更不会「复活」到合并结果里。
   * 这个字段本身只用于过滤，不会出现在 {@link MergedBookmarkFields} 里。
   */
  deletedAt?: string | null
}

/** 合并后写回 keeper 的字段集合（`id` 单独放在 {@link MergedBookmark} 上）。 */
export interface MergedBookmarkFields {
  url: string
  title: string
  description: string
  favicon: string
  color: string
  folderId: string
  tags: string[]
  visitCount: number
  lastVisited: string | null
  pinned: boolean
  createdAt: string
  /** 组内所有成员都没有检查结果时**不写入该键**（等价于「从未检查过」） */
  linkStatus?: DuplicateLinkStatus
  /** 合并时刻（= 传入的 `now`） */
  updatedAt: string
}

/** {@link mergeGroup} 的返回：keeper 的 id + 合并后的完整字段。 */
export interface MergedBookmark extends MergedBookmarkFields {
  id: string
}

/** 供 UI 预览的单个重复组（只含 id，标题等展示字段由调用方按 id 自行查）。 */
export interface DuplicateGroupPreview {
  /** `normalizeUrlKey` 生成的组键 */
  key: string
  /** 被保留的那条记录的 id */
  keepId: string
  /** 组内全部成员 id（原始数组顺序，uniform: keeper 在其中） */
  memberIds: string[]
}

/** {@link planDuplicateMerges} 的返回：既是执行计划，也是预览数据源。 */
export interface DuplicateMergePlan {
  /** 成员数 ≥ 2 的组数 */
  duplicateGroups: number
  /** 将被删除的条数 = 各组成员数 - 1 之和 */
  redundantCount: number
  /** 每个 keeper 要写回的字段（与 `groupDuplicates` 的组顺序一致） */
  keepers: Array<{ id: string; fields: MergedBookmarkFields }>
  /** 将被丢弃的记录 id（去重后，不含任何 keeper） */
  donorIds: string[]
  /** UI 预览用：组键 + 保留者 + 全部成员 id */
  groups: DuplicateGroupPreview[]
}

/** 非空字符串判定：`''` 与「仅空白」都视为空，用于字段回填。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** 只接受字符串，其余（`undefined` / `null` / 数字…）折叠为空串。 */
function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * 访问次数归一化：非有限数（`NaN` / `Infinity` / 缺失 / 字符串）一律按 0。
 * 与主进程 `increment-visit-count`、导入侧 `sanitizeVisitCount` 的口径一致。
 */
function toVisitCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * 时间归一化：只有可被 `Date` 解析的字符串才返回时间戳，其余返回 `NaN`。
 * 返回 `NaN` 而不是 0，是为了让调用方能区分「1970 年的合法时间」与「字段不合法」。
 */
function toTime(value: unknown): number {
  if (typeof value !== 'string' || value.trim() === '') return Number.NaN
  return new Date(value).getTime()
}

/** `linkStatus` 只接受对象，其余（`null` / 缺失 / 脏值）视为没有检查结果。 */
function toLinkStatus(value: unknown): DuplicateLinkStatus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as DuplicateLinkStatus
}

/**
 * 候选记录是否在回收站里（与主进程 `ipc/bookmarks.ts` 的 `isDeleted` 同一口径）。
 *
 * 只有**非空字符串**才算已删除：`null` / 缺失 / `''` / 脏值都视为未删除，
 * 避免一条脏数据把书签从合并计划里「藏掉」。
 */
export function isDeletedCandidate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const { deletedAt } = value as { deletedAt?: unknown }
  return typeof deletedAt === 'string' && deletedAt !== ''
}

/** `ok` 是否已有结论（`true` / `false`；`null` 或缺失 = unknown，不参与回填） */
function hasLinkConclusion(status: DuplicateLinkStatus): boolean {
  return status.ok === true || status.ok === false
}

/**
 * keeper 优先级的唯一实现（约定 2）：
 *  1. `pinned === true` 优先；
 *  2. `visitCount` 大者优先（非有限数按 0）；
 *  3. `createdAt` 早者优先（**不可解析的时间排在最后**：合法时间总是优先于脏时间）；
 *  4. `id` 字典序升序 —— 兜底项，保证完全并列时结果仍然确定。
 *
 * 返回值 < 0 表示 `a` 应当胜出（与 `Array.prototype.sort` 的比较器方向一致）。
 */
function compareKeeperPriority(a: DuplicateCandidate, b: DuplicateCandidate): number {
  const aPinned = a.pinned === true
  const bPinned = b.pinned === true
  if (aPinned !== bPinned) return aPinned ? -1 : 1

  const visitDiff = toVisitCount(b.visitCount) - toVisitCount(a.visitCount)
  if (visitDiff !== 0) return visitDiff

  const aTime = toTime(a.createdAt)
  const bTime = toTime(b.createdAt)
  const aInvalid = Number.isNaN(aTime)
  const bInvalid = Number.isNaN(bTime)
  if (aInvalid !== bInvalid) return aInvalid ? 1 : -1
  if (!aInvalid && aTime !== bTime) return aTime - bTime

  const aId = toStringValue(a.id)
  const bId = toStringValue(b.id)
  if (aId === bId) return 0
  return aId < bId ? -1 : 1
}

/**
 * 按 `normalizeUrlKey(url)` 分组（约定 1）。
 *
 * - **键为空（URL 为空 / 不可解析）不参与分组**：否则所有脏 URL 会被合成一组，
 *   合并后只剩一条，等于静默删除用户数据；
 * - **没有 id 的记录不参与分组**：合并按 id 定位/删除记录，缺 id 无法安全处理；
 * - **已删除（回收站里）的记录不参与分组**：它们既不会被选成 keeper，也不会被
 *   当成 donor 再次软删除，更不会「复活」到合并结果里（见 {@link isDeletedCandidate}）；
 * - **只返回成员数 ≥ 2 的组**（单条不构成重复）；
 * - Map 的迭代顺序 = 组键首次出现的顺序，组内成员顺序 = 入参数组顺序（供 keeper 回填
 *   「组内第一个非空值」时使用）。
 */
export function groupDuplicates(
  items: readonly DuplicateCandidate[]
): Map<string, DuplicateCandidate[]> {
  const groups = new Map<string, DuplicateCandidate[]>()
  if (!Array.isArray(items)) return groups

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    // 缺 id：无法在合并时定位具体记录，直接跳过（不参与分组，也不会被删除）
    if (toStringValue(item.id) === '') continue
    // 回收站里的记录：不参与分组（已删除的不该被合并，也不该被「复活」）
    if (isDeletedCandidate(item)) continue

    const key = normalizeUrlKey(item.url)
    if (!key) continue

    const members = groups.get(key)
    if (members) {
      members.push(item)
    } else {
      groups.set(key, [item])
    }
  }

  // 单条不成组：一次遍历即可完成（`[...groups]` 避免边迭代边删除）
  for (const [key, members] of [...groups]) {
    if (members.length < 2) groups.delete(key)
  }

  return groups
}

/** 按约定 2 选出 keeper；组为空时抛错（空组是调用方的编程错误，不该静默返回）。 */
export function pickKeeper(group: readonly DuplicateCandidate[]): DuplicateCandidate {
  if (!Array.isArray(group) || group.length === 0) {
    throw new Error('pickKeeper requires a non-empty group')
  }

  let keeper = group[0]
  for (let index = 1; index < group.length; index += 1) {
    if (compareKeeperPriority(group[index], keeper) < 0) {
      keeper = group[index]
    }
  }
  return keeper
}

/**
 * 合并一组重复书签（约定 3），返回 keeper 的 `id` 与合并后的字段。
 *
 * | 字段 | 取值规则 |
 * | --- | --- |
 * | `url` | keeper 的 |
 * | `title` / `description` / `favicon` / `color` / `folderId` | keeper 非空则用 keeper，否则组内第一个非空（原始顺序） |
 * | `tags` | keeper 在前、按组内顺序并集去重 |
 * | `visitCount` | 全组求和（非有限数按 0） |
 * | `lastVisited` | 全组可解析时间中的最大值（保留原始字符串） |
 * | `pinned` | 任一为 `true` 即 `true` |
 * | `createdAt` | 全组最早的合法时间；都非法则保留 keeper 原值 |
 * | `linkStatus` | keeper 有则用 keeper，否则组内第一个 `ok !== null`，都没有则留空 |
 * | `updatedAt` | `now` |
 */
export function mergeGroup(
  group: readonly DuplicateCandidate[],
  now: Date = new Date()
): MergedBookmark {
  if (!Array.isArray(group) || group.length === 0) {
    throw new Error('mergeGroup requires a non-empty group')
  }

  const keeper = pickKeeper(group)

  /** keeper 非空则 keeper，否则组内第一个非空（保持原始数组顺序） */
  const pickString = (read: (candidate: DuplicateCandidate) => unknown): string => {
    const keeperValue = read(keeper)
    if (isNonEmptyString(keeperValue)) return keeperValue

    for (const member of group) {
      const value = read(member)
      if (isNonEmptyString(value)) return value
    }
    // 全组都空：保留 keeper 的原值（可能不是字符串，折叠成 '' 以免写出非法类型）
    return toStringValue(keeperValue)
  }

  // tags：keeper 的标签排在最前，再按组内原始顺序并入其余成员（并集去重）
  const tags: string[] = []
  const seenTags = new Set<string>()
  const pushTags = (value: unknown): void => {
    if (!Array.isArray(value)) return
    for (const tag of value) {
      if (typeof tag !== 'string') continue
      if (seenTags.has(tag)) continue
      seenTags.add(tag)
      tags.push(tag)
    }
  }
  // 先 keeper，再整组（keeper 自身的标签已在 seenTags 里，重复扫描不会重复入列）
  pushTags(keeper.tags)
  for (const member of group) pushTags(member.tags)

  let visitCount = 0
  let pinned = false
  let latest: { raw: string; time: number } | undefined
  let earliest: { raw: string; time: number } | undefined

  for (const member of group) {
    visitCount += toVisitCount(member.visitCount)
    if (member.pinned === true) pinned = true

    const visitedTime = toTime(member.lastVisited)
    if (!Number.isNaN(visitedTime) && (!latest || visitedTime > latest.time)) {
      latest = { raw: member.lastVisited as string, time: visitedTime }
    }

    const createdTime = toTime(member.createdAt)
    if (!Number.isNaN(createdTime) && (!earliest || createdTime < earliest.time)) {
      earliest = { raw: member.createdAt as string, time: createdTime }
    }
  }

  // linkStatus：keeper 有就认 keeper（哪怕 ok === null），否则取组内第一个有结论的
  const keeperStatus = toLinkStatus(keeper.linkStatus)
  const conclusiveStatus = group
    .map(member => toLinkStatus(member.linkStatus))
    .find((status): status is DuplicateLinkStatus => !!status && hasLinkConclusion(status))
  const linkStatus = keeperStatus ?? conclusiveStatus

  const merged: MergedBookmark = {
    id: toStringValue(keeper.id),
    url: toStringValue(keeper.url),
    title: pickString(candidate => candidate.title),
    description: pickString(candidate => candidate.description),
    favicon: pickString(candidate => candidate.favicon),
    color: pickString(candidate => candidate.color),
    folderId: pickString(candidate => candidate.folderId),
    tags,
    visitCount,
    lastVisited: latest ? latest.raw : null,
    pinned,
    // 都非法时保留 keeper 原值（而不是伪造一个时间）
    createdAt: earliest ? earliest.raw : toStringValue(keeper.createdAt),
    updatedAt: now.toISOString()
  }

  if (linkStatus) merged.linkStatus = linkStatus

  return merged
}

/**
 * 生成合并计划（约定 4/5 的数据来源）：**只计算，不写盘**。
 *
 * - `duplicateGroups`：成员数 ≥ 2 的组数；
 * - `redundantCount`：将被删除的条数 = 各组成员数 - 1 之和；
 * - `keepers`：每个 keeper 的 id 与要写回的字段；
 * - `donorIds`：将被丢弃的记录 id（去重后，不含 keeper）；
 * - `groups`：UI 预览数据（组键 + keeper id + 全部成员 id）。
 *
 * **已删除（回收站里）的记录不参与计划**：分组交给 {@link groupDuplicates}，它在那里
 * 就已经跳过了它们，因此既不会出现「keeper 是回收站记录」，也不会把已删除记录算成 donor。
 *
 * 不修改入参：分组只持有引用，合并结果全部新建对象；`now` 可注入，便于离线测试。
 */
export function planDuplicateMerges(
  items: readonly DuplicateCandidate[],
  now: Date = new Date()
): DuplicateMergePlan {
  const grouped = groupDuplicates(items)
  const keepers: Array<{ id: string; fields: MergedBookmarkFields }> = []
  const donorIds: string[] = []
  const seenDonors = new Set<string>()
  const groups: DuplicateGroupPreview[] = []
  let redundantCount = 0

  for (const [key, members] of grouped) {
    const merged = mergeGroup(members, now)
    const memberIds = members.map(member => toStringValue(member.id))

    // redundantCount 按「成员数 - 1」计数（约定 4 的定义）
    redundantCount += members.length - 1

    for (const memberId of memberIds) {
      if (memberId === merged.id) continue
      if (seenDonors.has(memberId)) continue
      seenDonors.add(memberId)
      donorIds.push(memberId)
    }

    // id 与 fields 拆开：写回时 keeper 的 id 不能变（`update` 语义不允许改主键）
    const { id, ...fields } = merged
    keepers.push({ id, fields })
    groups.push({ key, keepId: merged.id, memberIds })
  }

  return {
    duplicateGroups: grouped.size,
    redundantCount,
    keepers,
    donorIds,
    groups
  }
}
