import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import 'uno.css'
import './assets/styles/main.css'
import App from './App.vue'
import QuickAdd from './QuickAdd.vue'
import { i18n } from './i18n'
import { isQuickAddView } from '../../shared/view-route'

/**
 * 单入口、双视图。
 *
 * 应用只有一张 `index.html`（主窗口与快速添加浮窗共用），靠查询串区分挂哪个根组件：
 * - `?view=quickadd` → `QuickAdd.vue`（460×190 无边框浮窗）；
 * - 其余（含空串）→ `App.vue`（主窗口）。
 *
 * 判定用 `shared/view-route.ts` 的 `isQuickAddView()` 而不是在这里手写 `includes('quickadd')`：
 * 主进程 `loadFile(..., { search })` / dev `loadURL(...)` 拼出的查询串必须与这里得出同一结论，
 * 实现只留一份并有直接单测（tests/shell-integration.test.ts）。
 *
 * Pinia / ElementPlus / i18n 对两个视图**完全一样**：浮窗也要用 store（加书签、读设置应用主题）、
 * Element Plus 的输入框/按钮、以及 i18n 文案，复制一套注册逻辑只会两边走样。
 */
const rootComponent = isQuickAddView(window.location.search) ? QuickAdd : App

const app = createApp(rootComponent)
const pinia = createPinia()

app.use(pinia)
app.use(ElementPlus)
app.use(i18n)

app.mount('#app')
