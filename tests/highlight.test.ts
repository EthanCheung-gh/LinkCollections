import { describe, expect, it } from 'vitest'
import { escapeHtml, highlightText } from '../src/renderer/utils/highlight'

/**
 * 高亮函数的输出会被 7 处 `v-html` 直接渲染，任何未转义的原文都是 XSS。
 * 这些用例锁住「输出里只能出现 mark 标签」这条不变量。
 */
const stripMarks = (html: string) => html.replace(/<\/?mark>/g, '')

describe('escapeHtml', () => {
  it('转义五个结构相关字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('非字符串输入返回空串（render 期不能抛错）', () => {
    expect(escapeHtml(null as unknown as string)).toBe('')
    expect(escapeHtml(undefined as unknown as string)).toBe('')
    expect(escapeHtml(42 as unknown as string)).toBe('')
  })
})

describe('highlightText', () => {
  it('命中片段包裹 mark，其余部分保持原文语义', () => {
    expect(highlightText('Hello World', 'world')).toBe('Hello <mark>World</mark>')
  })

  it('空关键词也转义原文（否则 v-html 会执行标签）', () => {
    const out = highlightText('<img src=x onerror=alert(1)>', '')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('含标签的关键词不会破坏结构', () => {
    const out = highlightText('x <script> y', '<script>')
    expect(out).toBe('x <mark>&lt;script&gt;</mark> y')
  })

  it('正则元字符按字面匹配，不抛错', () => {
    for (const query of ['a(b', '.*', '[', '\\', '$&', '$1', '|']) {
      expect(() => highlightText('a(b .* [ \\ $& $1 |', query)).not.toThrow()
    }
  })

  it('大小写不敏感', () => {
    expect(highlightText('Hello World', 'hello')).toBe('<mark>Hello</mark> World')
  })

  it('多字节文本位置正确', () => {
    expect(highlightText('中文<b>测试', '测试')).toBe('中文&lt;b&gt;<mark>测试</mark>')
  })

  it('输出中除 mark 外不残留任何尖括号', () => {
    const payload = '<img src=x onerror=alert(1)><b>粗体</b>'
    const out = highlightText(payload, 'src')
    expect(stripMarks(out)).not.toMatch(/[<>]/)
  })

  it('超长关键词不破坏输出', () => {
    const out = highlightText('abc', 'x'.repeat(5000))
    expect(out).toBe('abc')
  })
})
