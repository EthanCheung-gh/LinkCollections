import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const DATA_DIR = path.join(app.getPath('userData'), 'data')

// 原子写使用的临时文件后缀（与目标文件同目录，保证 rename 不跨设备）
const TEMP_SUFFIX = '.tmp'

export function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function getDataPath(filename: string): string {
  return path.join(DATA_DIR, filename)
}

/**
 * 损坏文件的备份路径：`<name>.corrupt-<timestamp>.json`
 *
 * 例：`bookmarks.json` → `bookmarks.corrupt-20251029T004112345Z.json`
 *
 * 时间戳取 ISO 字符串并把 `:` / `.` 替换成 `-`，避免 Windows 非法文件名字符；
 * 这样同一份数据反复损坏也不会互相覆盖（秒级精度以内需要去重时再加序号）。
 */
function getCorruptBackupPath(filename: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const ext = path.extname(filename) || '.json'
  const base = path.basename(filename, ext)
  return getDataPath(`${base}.corrupt-${timestamp}${ext}`)
}

/**
 * 把已损坏的文件改名保留（而不是直接覆盖），让用户/开发者还能手工抢救数据。
 * 备份失败只记录日志：不能让「备份」这件事把读取流程整体打断。
 */
function backupCorruptFile(filename: string, filePath: string): void {
  const backupPath = getCorruptBackupPath(filename)
  try {
    fs.renameSync(filePath, backupPath)
    console.error(`[storage] Corrupt file preserved at: ${backupPath}`)
  } catch (error) {
    console.error(`[storage] Failed to back up corrupt file ${filename}:`, error)
  }
}

/**
 * 用默认值的形状推断「期望的顶层结构」，避免 `{...}` 覆盖掉本应是数组的文件。
 * 默认值是数组 → 期望数组；默认值是普通对象 → 期望普通对象；其它类型不做校验。
 */
function matchesDefaultShape(value: unknown, defaultValue: unknown): boolean {
  if (Array.isArray(defaultValue)) {
    return Array.isArray(value)
  }
  if (defaultValue !== null && typeof defaultValue === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  return true
}

export function readJsonFile<T>(filename: string, defaultValue: T): T {
  ensureDataDir()
  const filePath = getDataPath(filename)

  // 文件不存在是正常状态（首次运行 / 清空后），直接返回默认值，不产生任何日志与备份
  if (!fs.existsSync(filePath)) {
    return defaultValue
  }

  let content: string
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch (error) {
    console.error(`[storage] Failed to read ${filename}:`, error)
    return defaultValue
  }

  // 去掉 UTF-8 BOM（Windows 记事本手工编辑后常见），否则 JSON.parse 必然失败
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    console.error(`[storage] ${filename} is not valid JSON; a backup will be kept:`, error)
    backupCorruptFile(filename, filePath)
    return defaultValue
  }

  if (!matchesDefaultShape(parsed, defaultValue)) {
    console.error(
      `[storage] ${filename} has an unexpected top-level structure (expected ` +
        `${Array.isArray(defaultValue) ? 'array' : typeof defaultValue}); a backup will be kept`
    )
    backupCorruptFile(filename, filePath)
    return defaultValue
  }

  return parsed as T
}

/**
 * 原子写入：先写 `<file>.tmp` 并 fsync，再用 `fs.rename` 替换目标文件。
 * 进程中途退出/磁盘满只会留下（或丢掉）临时文件，目标文件保持上一个完整版本。
 *
 * 返回 `true` 表示写入成功；失败时**抛出**错误（不再返回 `false` 让调用方静默忽略），
 * 调用方原有的 `if (!save(...)) throw` 写法无需改动即可继续工作。
 */
export function writeJsonFile<T>(filename: string, data: T): boolean {
  ensureDataDir()
  const filePath = getDataPath(filename)
  const tempPath = `${filePath}${TEMP_SUFFIX}`
  const payload = JSON.stringify(data, null, 2)

  let fd: number | undefined
  try {
    fd = fs.openSync(tempPath, 'w')
    fs.writeFileSync(fd, payload, 'utf-8')
    try {
      fs.fsyncSync(fd)
    } catch (syncError) {
      // fsync 在部分文件系统上不受支持，这里降级为「尽力而为」，不影响写入结果
      console.warn(`[storage] fsync failed for ${filename}:`, syncError)
    }
    fs.closeSync(fd)
    fd = undefined

    // 同目录 rename 在 POSIX 与 Windows(Node 的 uv_fs_rename) 上都是原子替换
    fs.renameSync(tempPath, filePath)
    return true
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // 忽略关闭失败：下面会尝试清理临时文件
      }
    }
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath)
      }
    } catch {
      // 忽略清理失败
    }
    console.error(`[storage] Failed to write ${filename}:`, error)
    throw error instanceof Error ? error : new Error(String(error))
  }
}
