import { describe, it, expect } from 'vitest'
import { AnalyzeRule, toAbsoluteUrl } from '../../src/rule/analyze-rule.js'

const HTML = `<html><body><div class="content"><p>段一</p><p>段二</p></div><a href="/book/1">链接</a></body></html>`

/** 测试用 {{}} 求值器：{{key}} / {{page}} 占位与简单表达式 */
const evalJs = async (code: string, ctx: Record<string, unknown>) => {
  const c = code.trim()
  if (c === 'key') return String(ctx.key ?? '')
  if (c === 'page') return String(ctx.page ?? 1)
  if (/^\d+\+\d+$/.test(c)) return String(eval(c))
  return null
}

describe('AnalyzeRule', () => {
  it('jsoup 规则取文本', async () => {
    const r = new AnalyzeRule(evalJs).setContent(HTML, 'https://a.com/book')
    expect(await r.getString('class.content@tag.p@text')).toBe('段一\n段二')
  })

  it('isUrl 相对转绝对', async () => {
    const r = new AnalyzeRule(evalJs).setContent(HTML, 'https://a.com/book/123.html')
    expect(await r.getString('tag.a@href', { isUrl: true })).toBe('https://a.com/book/1')
  })

  it('{{}} 整条 JS 规则直接返回结果', async () => {
    const r = new AnalyzeRule(evalJs, { key: '我的', page: 3 }).setContent(HTML)
    expect(await r.getString('{{key}}')).toBe('我的')
  })

  it('JSON 内容自动走 JSONPath', async () => {
    const r = new AnalyzeRule(evalJs).setContent('{"data":{"name":"剑来"}}')
    expect(await r.getString('$.data.name')).toBe('剑来')
  })

  it('@json: 前缀强制 JSONPath', async () => {
    const r = new AnalyzeRule(evalJs).setContent('{"list":[{"n":"a"},{"n":"b"}]}')
    expect(await r.getString('@json:$.list[*].n')).toBe('a\nb')
  })

  it('##净化', async () => {
    const r = new AnalyzeRule(evalJs).setContent(HTML)
    expect(await r.getString('class.content@tag.p@text##段')).toBe('一\n二')
  })

  it('@XPath: 抛不支持', async () => {
    const r = new AnalyzeRule(evalJs).setContent(HTML)
    await expect(r.getString('@XPath://div/text()')).rejects.toThrow('不支持')
  })

  it('getElements → 逐项解析（列表项上下文）', async () => {
    const r = new AnalyzeRule(evalJs).setContent(HTML)
    const els = await r.getElements('class.content@tag.p')
    expect(els).toHaveLength(2)
    const texts: string[] = []
    for (const el of els) {
      r.setContentItem([el])
      texts.push((await r.getString('text'))!)
    }
    expect(texts).toEqual(['段一', '段二'])
  })
})

describe('toAbsoluteUrl', () => {
  it('拼接相对路径', () => {
    expect(toAbsoluteUrl('/x', 'https://a.com/p/q')).toBe('https://a.com/x')
  })
  it('已是绝对地址则原样', () => {
    expect(toAbsoluteUrl('https://b.com/x', 'https://a.com/')).toBe('https://b.com/x')
  })
})
