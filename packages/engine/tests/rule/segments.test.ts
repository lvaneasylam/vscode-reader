import { describe, it, expect } from 'vitest'
import { AnalyzeRule } from '../../src/rule/analyze-rule.js'
import { splitRuleSegments } from '../../src/rule/analyze-rule.js'
import { evalJsAsync } from '../../src/js/js-runtime.js'

const evalJs = (code: string, ctx: Record<string, unknown>) => evalJsAsync(code, ctx)

describe('多段规则链（<js>...</js>后续规则）', () => {
  it('splitRuleSegments 切分 JS 段与规则段', () => {
    const segs = splitRuleSegments('<js>return 1</js>$.data')
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual({ kind: 'js', code: 'return 1' })
    expect(segs[1]).toEqual({ kind: 'rule', rule: '$.data' })
  })

  it('纯规则不受影响', () => {
    expect(splitRuleSegments('class.a@text')).toEqual([{ kind: 'rule', rule: 'class.a@text' }])
  })

  it('链式执行：JS 结果交给后续规则段（聚合 bookList 形态）', async () => {
    const rule = new AnalyzeRule(evalJs, { key: '剑来', page: 1 })
    rule.setContent('{"data":{"books":[{"name":"剑来"}]}}')
    // JS 段返回 data 节点 JSON，$.books[*].name 在其上提取
    const v = await rule.getString(
      `<js>JSON.stringify(JSON.parse(result).data)</js>$.books[*].name`
    )
    expect(v).toBe('剑来')
  })

  it('getElements 链式：JS 段产出 + 规则段取列表', async () => {
    const rule = new AnalyzeRule(evalJs, { key: 'k', page: 1 })
    rule.setContent('anything')
    const els = await rule.getElements(`<js>JSON.stringify([{a:1},{a:2}])</js>`)
    expect(els).toHaveLength(2)
  })

  // 回归：真实书源 bookList 形如 "</js>\n$.data"（尾段带换行），未 trim 会绕过 JSON 规则判定走 jsoup 兜底
  it('段切分 trim：尾段带换行仍是 JSON 规则（回归：搜索 0 本）', async () => {
    const segs = splitRuleSegments('<js>JSON.stringify({data:[{n:1},{n:2}]})</js>\n$.data')
    expect(segs[1]).toEqual({ kind: 'rule', rule: '$.data' })

    const rule = new AnalyzeRule(evalJs, { key: 'k', page: 1 })
    rule.setContent('anything')
    const els = await rule.getElements(`<js>JSON.stringify({data:[{n:1},{n:2}]})</js>\n$.data`)
    expect(els).toHaveLength(2)
  })

  // 回归：{{$.field}} 内嵌 JSONPath（聚合 kind/lastChapter 形态），此前被当 JS 执行抛 ReferenceError
  it('{{}} 内嵌 JSONPath 在当前内容上提取（回归：kind 字段炸搜索）', async () => {
    const rule = new AnalyzeRule(evalJs, {})
    rule.setContentItem({ status: '连载', score: 8.5, tags: ['玄幻', '仙侠'], source: '番茄', last_chapter_title: '第100章' })
    expect(await rule.getString('{{$.status}},{{$.score}}')).toBe('连载,8.5')
    expect(await rule.getString('{{$.source}} {{$.last_chapter_title}}')).toBe('番茄 第100章')
  })
})
