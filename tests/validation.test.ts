import { describe, expect, it } from 'vitest'
import {
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
