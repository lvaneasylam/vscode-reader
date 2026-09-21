import { describe, it, expect } from 'vitest'
import { parseBookSource, parseBookSources } from '../src/source-loader.js'

const validSource = {
  bookSourceUrl: 'https://www.example.com',
  bookSourceName: '示例源',
  bookSourceType: 0,
  searchUrl: 'https://www.example.com/search?q={{key}}&p={{page}}',
  ruleSearch: {
    bookList: 'class.result-list@tag.div',
    name: 'tag.h3@text',
    author: 'class.author@text',
    bookUrl: 'tag.a@href'
  },
  ruleBookInfo: { tocUrl: 'class.catalog@tag.a@href' },
  ruleToc: { chapterList: 'class.chapters@tag.a', chapterName: 'text', chapterUrl: 'href' },
  ruleContent: { content: 'class.read-content@tag.p@text', nextContentUrl: 'class.next@href' }
}

describe('parseBookSource', () => {
  it('解析合法书源的核心字段', () => {
    const r = parseBookSource(JSON.stringify(validSource))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.source.bookSourceUrl).toBe('https://www.example.com')
      expect(r.source.ruleSearch?.bookList).toBe('class.result-list@tag.div')
      expect(r.source.ruleContent?.content).toBe('class.read-content@tag.p@text')
      expect(r.warnings).toEqual([])
    }
  })

  it('缺少 bookSourceUrl 时返回错误', () => {
    const r = parseBookSource(JSON.stringify({ bookSourceName: '无名源' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('bookSourceUrl')
  })

  it('非法 JSON 返回错误', () => {
    const r = parseBookSource('{bad json')
    expect(r.ok).toBe(false)
  })

  it('音频源（bookSourceType=1）给出警告', () => {
    const r = parseBookSource(JSON.stringify({ ...validSource, bookSourceType: 1 }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some(w => w.includes('不支持的书源类型'))).toBe(true)
  })

  it('XPath 规则给出警告', () => {
    const r = parseBookSource(
      JSON.stringify({
        ...validSource,
        ruleContent: { content: '@XPath://div[@class="content"]/p/text()' }
      })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some(w => w.includes('XPath'))).toBe(true)
  })

  it('<js> 脚本书源不再警告（已支持）', () => {
    const r = parseBookSource(
      JSON.stringify({ ...validSource, ruleToc: { chapterList: '<js>result=1</js>' } })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some(w => w.includes('<js>'))).toBe(false)
  })

  it('header 字符串规范化为对象', () => {
    const r = parseBookSource(
      JSON.stringify({ ...validSource, header: '{"User-Agent":"test-ua"}' })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.source.headerMap).toEqual({ 'User-Agent': 'test-ua' })
  })

  it('规则字段为对象形式（字符串化 JSON 规则）给出警告', () => {
    const r = parseBookSource(
      JSON.stringify({ ...validSource, ruleSearch: { bookList: { rule: 'x' } } as any })
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.warnings.some(w => w.includes('对象形式'))).toBe(true)
  })
})

describe('parseBookSources', () => {
  it('接受数组与单对象', () => {
    const arr = parseBookSources(JSON.stringify([validSource, validSource]))
    expect(arr).toHaveLength(2)
    const single = parseBookSources(JSON.stringify(validSource))
    expect(single).toHaveLength(1)
  })

  it('容忍 UTF-8 BOM 头（中文 JSON 常见）', () => {
    const arr = parseBookSources('﻿' + JSON.stringify([validSource]))
    expect(arr).toHaveLength(1)
  })

  it('跳过无效条目并保留其错误信息', () => {
    const arr = parseBookSources(JSON.stringify([validSource, { bookSourceName: '坏源' }]))
    expect(arr).toHaveLength(1)
  })
})
