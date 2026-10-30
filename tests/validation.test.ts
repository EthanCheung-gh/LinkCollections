import { describe, expect, it } from 'vitest'
import {
  isTrustworthyHostname,
  isValidColor,
  isValidUrl,
  normalizeUrl,
  validateBookmarkData
} from '../src/renderer/utils/validation'

describe('normalizeUrl', () => {
  it('无协议时补 https', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com')
    expect(normalizeUrl('  example.com/path?q=1  ')).toBe('https://example.com/path?q=1')
  })

  it('已是 http/https 时原样保留', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com')
    expect(normalizeUrl('http://example.com/a?b=1#c')).toBe('http://example.com/a?b=1#c')
  })

  it('host:port 形式补协议而不是当成 scheme', () => {
    expect(normalizeUrl('example.com:8080/x')).toBe('https://example.com:8080/x')
  })

  it('危险协议原样返回，交给校验拒绝', () => {
    for (const raw of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x', 'data:text/html,1']) {
      expect(normalizeUrl(raw)).toBe(raw)
      expect(isValidUrl(normalizeUrl(raw))).toBe(false)
    }
  })

  it('空值与不可解析输入返回空串或原样', () => {
    expect(normalizeUrl('')).toBe('')
    expect(normalizeUrl('   ')).toBe('')
    expect(normalizeUrl('exa mple.com')).toBe('exa mple.com')
  })
})

describe('isValidUrl', () => {
  it('归一化后的裸域名通过', () => {
    expect(isValidUrl('https://example.com')).toBe(true)
    expect(isValidUrl(normalizeUrl('example.com'))).toBe(true)
  })

  it('非 http(s) 一律拒绝', () => {
    expect(isValidUrl('javascript:void(0)')).toBe(false)
    expect(isValidUrl('mailto:a@b.c')).toBe(false)
  })

  // Chromium 的 URL 解析器会把主机名里的空格百分号编码后「成功」返回，
  // 只靠 new URL() 会放行 `not a url` —— 这里锁住主机名校验。
  it('主机名含空格的假 URL 被拒绝', () => {
    expect(isValidUrl('not a url')).toBe(false)
    expect(isValidUrl(normalizeUrl('not a url'))).toBe(false)
    expect(isValidUrl('https://exa mple.com')).toBe(false)
    expect(isValidUrl('exa mple.com')).toBe(false)
  })

  it('国际化域名与 IP 仍然合法', () => {
    expect(isValidUrl('https://例子.测试')).toBe(true)
    expect(isValidUrl('https://127.0.0.1:8080/x')).toBe(true)
    expect(isValidUrl('https://[::1]/x')).toBe(true)
  })

  it('路径里的空格不影响判定（主机名合法即可）', () => {
    expect(isValidUrl('https://example.com/a b')).toBe(true)
  })
})

describe('isValidColor', () => {
  it('接受 3 位与 6 位 hex', () => {
    expect(isValidColor('#fff')).toBe(true)
    expect(isValidColor('#3B82F6')).toBe(true)
  })

  it('拒绝非法值', () => {
    expect(isValidColor('')).toBe(false)
    expect(isValidColor('red')).toBe(false)
    expect(isValidColor('#12345')).toBe(false)
  })
})

describe('validateBookmarkData', () => {
  const base = { url: 'https://example.com', title: '标题', color: '#3B82F6' }

  it('合法数据通过', () => {
    expect(validateBookmarkData(base).valid).toBe(true)
  })

  it('folderId 允许为空（未分类）', () => {
    expect(validateBookmarkData({ ...base, folderId: '' }).valid).toBe(true)
  })

  it('缺少 URL / 标题时给出错误', () => {
    const result = validateBookmarkData({ ...base, url: '', title: '  ' })
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('非法颜色被拒绝', () => {
    expect(validateBookmarkData({ ...base, color: 'blue' }).valid).toBe(false)
  })
})

// Chromium 会把主机名里的空格百分号编码后「成功」返回，而 Node 直接抛错，
// 因此这条守卫必须单独测（上面的 isValidUrl 用例在 Node 下走的是抛错分支）。
describe('isTrustworthyHostname', () => {
  it('拒绝空主机名与百分号编码/空白', () => {
    expect(isTrustworthyHostname('')).toBe(false)
    expect(isTrustworthyHostname('not%20a%20url')).toBe(false)
    expect(isTrustworthyHostname('exa mple.com')).toBe(false)
    expect(isTrustworthyHostname('exa\tmple.com')).toBe(false)
  })

  it('放行正常主机名、punycode 与 IPv6', () => {
    expect(isTrustworthyHostname('example.com')).toBe(true)
    expect(isTrustworthyHostname('xn--fsqu00a.xn--0zwm56d')).toBe(true)
    expect(isTrustworthyHostname('[::1]')).toBe(true)
    expect(isTrustworthyHostname('127.0.0.1')).toBe(true)
  })
})
