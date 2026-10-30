import { nativeImage } from 'electron'

/**
 * 系统托盘图标（base64 内嵌，运行时不再读文件）。
 *
 * 为什么内嵌而不是 `nativeImage.createFromPath(...)`：
 * dev 环境渲染层走 dev server、主进程从 `dist-electron/` 运行，打包后又是
 * `app.asar` 内的 `dist-electron/`，同一份素材的相对路径在两者之间并不一致；
 * 内嵌之后主进程产物是自包含的，任何加载方式下都不可能「找不到图标」。
 *
 * 素材来源：`public/icons/tray-32.png`（自绘图标的小尺寸简化版：纯书签绶带，
 * 不带大尺寸才有的标签孔——16px 下那个孔会糊成一个脏点）。
 * 下文 base64 是 32×32 PNG，编码后 1492 个字符。

 * ---- 如何重新生成这段 base64（换图标时照抄执行即可） ----
 *
 *   # 1) 确认素材（应为 "PNG 32x32"，带 alpha）
 *   identify public/icons/tray-32.png
 *
 *   # 2) 输出**单行** base64（-w0 去掉换行），整串替换下面常量里 `base64,` 之后的内容
 *   base64 -w0 public/icons/tray-32.png
 *
 * 图标设计说明：蓝色渐变圆角方块（#3B82F6 → #2563EB）+ 白色书签绶带。
 * 大尺寸版本（`public/icons/icon.png`、`icon.ico` 的 48px 以上帧）额外带一个
 * 标签孔，作为品牌细节；48px 以下与托盘用纯书签版本，保证小尺寸不产生噪点。
 * macOS 若要「模板图标」，应另做纯黑 + alpha 的 22×22 PNG 并
 * `image.setTemplateImage(true)`，不要在 Windows/Linux 上复用（会变成一团黑块）。
 *
 * 失败降级：base64 解码异常或解码出空图（例如将来替换时粘错/截断）时，
 * 退化为 `nativeImage.createEmpty()` 并 `console.error`——托盘图标缺失只会让
 * 托盘不可见，不应该让主进程启动整体崩掉（`new Tray(空图)` 的失败由调用方兜底）。
 */
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAEJElEQVR4nLWXz4scRRTHP6+qZmZnN5BssuBBE3ITPHjwIP76B4RAAnESwYOnXBQSiCDegkc9mB8HD+pBb5I1EjABTyJ6EtSgQUTUEJMcjIckupnsznZXfT1090zv7kzvrDEzzI96/fp96r1671W1AfTOyi8esvjsiVt7kp87ZrBPKe5VUgtkCATlF6gcqByvvb5BLrDMzF8VdsGWl09/d2bntV5PfnHRolXwp04sHfKhc8Z866GUZaSYA4lJ8Lq8AT68DxdwoUvKBzfjoH/0h1O7zvZ68gbwzJv9g74z+0lczUj5ICJzGBM93xq8lEuSlCzMeBdmSMt3Xrh0cv6cPXmi/4g3+9Gc35HyLIH59ZD7htfkUorOt12K8U7KVh93Hh33ne58ylYfOBwJw3zMBsm3t81bCMcd4kBazQTmGuEABlb7NSvkNka+AT4aYmYuZcuSOBAEuxVzw9Z7sDbb8wQ2DCNYKV+rryHFOSqTQ2MjXbMUc5B2B7DQlO0SOIOds7YuvEbN9oYluLsiYhoHr/QTBiE0hd2AQQ57FhwfvdLFuzKEjH+JIkpR8NKpPn/8Fem0II2xXTFDY8KVMXQG83OTsOMn4qzwerNkDk0KVlPMI9NFAGqhb4ZTRWCiglUXVGR6SW6KRVUNw7xogEsQJimsV6yX0rQvqRkOwk3bZKbPgFJ3eN9kOIINzacOH7q9RfdHyTeuV4xsC4oITPK8Lt/yEkgU78nwMgLj4bC2CrayBKNJGLZJFbhJ8JH8P/k/msMEeCUPzfCakTGGU1nvVd9fr9BUBdXANcGrDWf9EqRUjL0rPlabzBrPaa6Csg9MsZ8zujEKgis647ufrxATvPr8DO1Q7JjeRrasoQoq26ERXm3RKox3AgSDb37NeevTZb6/EgHx5eVV3jg4y9OPBgBiLG0ghE2Eo7ITblYFkugE+LsvTl1c4eOvB6QEu7YV7v58I/Ly6SVefK7D8f1ddszZcP3rZ4hx0Q4Twy5IVsCDMy5+m3Hys2V+/zOxfa44v+SxqPPZTgH88IsBX/2U8dr+Ls6NIE3HeHvi9X80Dj78K+EM7q0IZ0a3U4DHJVZwoj8QKRWTimm8Y3WHg6TcxuXCaNGIaeTlJDiILMJMq1jzaeASuQOu41pCxbmpDh+VY2EwaTK8GqcESWwCT8K1BLruJJ13oWuSkiqLY89wzfCmUtvouZL5roE776LL34mDu7ctdJyUYk3vQcGjuRmXBku3Y9I77vLbCzeI+REXuuZ82yelWMT6/4YnSSma63gLXQMd+e2DhRuu15O/dHL+XH7v1mHhb4b2Dm++bapOpFPANys1AFzbXHu7B3cz9m8f/uX9hXPDh9PqUfmxo7f2tFudY4J9ivlelFoq2/l9hF3CZVi4ClzI0tLpK+89fI2ePIsW/wWU4RGK3SwRKgAAAABJRU5ErkJggg=='

/**
 * 创建托盘图标。
 *
 * 返回值永远是一个 NativeImage（可能是空图）：调用方（`electron/tray.ts`）只需
 * 处理「`new Tray()` 是否抛错」，不必再判断 null。
 */
export function createTrayImage(): Electron.NativeImage {
  try {
    const image = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)

    if (!image || image.isEmpty()) {
      console.error(
        '[tray] Embedded tray icon decoded to an empty image; the tray icon will be blank. ' +
          'Re-generate the base64 with the commands in electron/tray-icon.ts.'
      )
      return nativeImage.createEmpty()
    }

    return image
  } catch (error) {
    console.error('[tray] Failed to decode the embedded tray icon:', error)
    return nativeImage.createEmpty()
  }
}
