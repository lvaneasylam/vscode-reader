import { describe, it, expect } from 'vitest'
import { formatContent } from '../src/html-formatter.js'

describe('formatContent', () => {
  it('段落标签转换行', () => {
    expect(formatContent('<p>段1</p><p>段2</p>')).toBe('段1\n段2')
  })
  it('br 转换行', () => {
    expect(formatContent('第一行<br/>第二行')).toBe('第一行\n第二行')
  })
  it('HTML 实体解码', () => {
    expect(formatContent('<p>a&amp;b&lt;c</p>')).toBe('a&b<c')
  })
  it('NBSP 缩进保留', () => {
    expect(formatContent('<p>&nbsp;&nbsp;缩进</p>')).toBe('  缩进')
  })
  it('script/style 移除', () => {
    expect(formatContent('<p>正文</p><script>alert(1)</script><style>.x{}</style>')).toBe('正文')
  })
  it('img 保留为独立 URL 行', () => {
    expect(formatContent('<p>上文</p><img src="https://a.com/1.jpg"/><p>下文</p>')).toBe(
      '上文\nhttps://a.com/1.jpg\n下文'
    )
  })
  it('连续空行压缩为单换行', () => {
    expect(formatContent('<p>a</p><div></div><div></div><p>b</p>')).toBe('a\nb')
  })
  it('纯文本原样', () => {
    expect(formatContent('已经纯净的正文')).toBe('已经纯净的正文')
  })
})
