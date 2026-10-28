import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { resolve } from 'path'
import type { Plugin } from 'vite'

/**
 * 生产环境 CSP（C18）。内容必须与 `electron/main.ts` 的 `PROD_CSP` 完全一致。
 *
 * 为什么还要写进 HTML：生产环境的渲染进程用 `file://` 加载（`mainWindow.loadFile`），
 * `webRequest.onHeadersReceived` 对 file:// 的拦截行为不可靠，<meta> 才是 file:// 下
 * 一定能生效的载体。开发环境（apply: 'build'）不注入，避免影响 Vite HMR 与 DevTools。
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'"
].join('; ')

function injectCspMeta(): Plugin {
  return {
    name: 'link-collection:inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html: string): string {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`
      return html.replace('<head>', `<head>\n    ${meta}`)
    }
  }
}

export default defineConfig({
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      lib: {
        entry: 'electron/preload.ts',
        formats: ['cjs']
      }
    }
  },
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      lib: {
        entry: 'electron/main.ts',
        formats: ['cjs'],
        fileName: () => 'main.js'
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      outDir: 'dist'
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    },
    server: {
      port: 5173,
      strictPort: true,
      host: 'localhost'
    },
    plugins: [vue(), UnoCSS(), injectCspMeta()],
    /**
     * vue-i18n 9.x 默认用 `new Function` 把消息编译成函数（compileToFunction），
     * 会被生产 CSP 的 `script-src 'self'` 拒绝 —— 实测会导致整个渲染进程白屏。
     *
     * 打开 JIT 编译后，编译器改为产出 AST（解释执行，不用 eval），
     * 这样既保留严格 CSP，又不需要在运行时编译函数字符串。
     * 参考 core-base 的分支：`__INTLIFY_JIT_COMPILATION__ ? compile : compileToFunction`。
     */
    define: {
      __INTLIFY_JIT_COMPILATION__: 'true',
      __INTLIFY_DROP_MESSAGE_COMPILER__: 'false'
    }
  }
})
