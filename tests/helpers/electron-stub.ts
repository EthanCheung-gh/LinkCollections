import os from 'os'
import path from 'path'
import fs from 'fs'

/**
 * 主进程测试用的最小 electron 桩。
 *
 * 注意：`electron/utils/storage.ts` 在**模块加载时**就执行了
 * `const DATA_DIR = path.join(app.getPath('userData'), 'data')`，
 * 之后再改 `app.getPath` 的返回值也不会生效。因此这里用**固定**的临时根目录，
 * 由 `useTempUserData()` 在每个用例开始时清空 `data` 子目录来保证隔离。
 */
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-test-'))
const DATA_DIR = path.join(ROOT, 'data')

export const electronStub = {
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') {
        throw new Error(`unexpected getPath(${name})`)
      }
      return ROOT
    },
    isPackaged: false,
    whenReady: () => Promise.resolve(),
    on: () => undefined
  },
  ipcMain: {
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    handle(channel: string, listener: (...args: unknown[]) => unknown) {
      electronStub.ipcMain.handlers.set(channel, listener)
    }
  },
  shell: { openExternal: async () => undefined },
  BrowserWindow: class {},
  session: { defaultSession: { webRequest: { onHeadersReceived: () => undefined } } },
  dialog: {},
  /**
   * 托盘图标桩（`electron/tray-icon.ts`）。
   *
   * 语义与真实 NativeImage 对齐到「调用方唯一关心的那一点」：`isEmpty()`。
   * 真实解码不做——单测断言的是「解码成功就用它、解码失败就降级」，不是 PNG 解码器。
   */
  nativeImage: {
    createFromDataURL: (_dataUrl: string) => ({ isEmpty: () => false }),
    createEmpty: () => ({ isEmpty: () => true })
  },
  /** 菜单桩（`electron/tray.ts`）：只回显模板，单测断言的是模板内容，不需要真实菜单对象 */
  Menu: {
    buildFromTemplate: (template: unknown) => ({ template })
  }
}

/** 清空当前用例的 data 目录，返回其路径 */
export function useTempUserData(): string {
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  return DATA_DIR
}

/** 当前 userData 根目录（含 data 子目录） */
export function currentUserData(): string {
  return ROOT
}
