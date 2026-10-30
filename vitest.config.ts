import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

/**
 * 最小测试基建。
 *
 * 只覆盖「纯逻辑」层：渲染进程的工具函数与 store、主进程的纯函数与迁移。
 * 不引入 jsdom / @vue/test-utils：组件渲染与 Electron 窗口行为仍靠手工 + CDP 验证。
 *
 * 主进程模块会在文件顶部 import 'electron'，因此相关测试用 `vi.mock('electron')`
 * 提供 `app.getPath('userData')` 的最小桩（见 tests/electron-stub.ts）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Electron 主进程模块依赖 `app.getPath` 指向临时目录，禁止并发跑同一目录
    fileParallelism: false,
    reporters: ['default']
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer')
    }
  }
})
