import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { resolve } from 'path'

/**
 * 纯 Web 预览/构建用的配置（`npm run dev:web` / `npm run build:web`）。
 *
 * 与 `electron.vite.config.ts` 的 renderer 段保持一致：
 * - `root` 指向 `src/renderer`（index.html 在那里，之前缺失导致脚本直接失败）；
 * - 别名统一为 `src/renderer`，避免两个配置指向不同目录；
 * - 不再注入不存在的 `@/assets/styles/variables.scss`（项目未安装 sass）。
 */
export default defineConfig({
  root: 'src/renderer',
  plugins: [vue(), UnoCSS()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer')
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist-web'),
    emptyOutDir: true
  }
})
