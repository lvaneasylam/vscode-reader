import { describe, it, expect } from 'vitest'
import {
  createJsoupContext,
  jsoupGetString,
  jsoupGetElements
} from '../../src/rule/query-jsoup.js'
import { splitTopLevel, splitPurify, applyPurify } from '../../src/rule/rule-analyzer.js'

const HTML = `
<html><body>
<div class="content">
  <p>甲</p>
  <p>乙</p>
  <img src="a.jpg"/>
  <span class="note">注释</span>
</div>
<div class="mixed">直接<b>粗体</b>尾部</div>
<ul class="list"><li>一</li><li>二</li><li>三</li><li>四</li></ul>
</body></html>`

describe('splitTopLevel', () => {
  it('按 || 切分', () => {
    expect(splitTopLevel('a@text||b@text', ['||']).list).toEqual(['a@text', 'b@text'])
  })
  it('按 && 切分并记录类型', () => {
    const r = splitTopLevel('a@text&&b@text', ['&&', '||', '%%'])
    expect(r.list).toEqual(['a@text', 'b@text'])
    expect(r.elementsType).toBe('&&')
  })
  it('引号内的分隔符不切分', () => {
    const r = splitTopLevel(`a@"x&&y"@text`, ['&&'])
    expect(r.list).toEqual([`a@"x&&y"@text`])
  })
  it('{{}} JS 内的分隔符不切分', () => {
    const r = splitTopLevel('{{java.ajax("x||y")}}||b', ['||'])
    expect(r.list).toEqual(['{{java.ajax("x||y")}}', 'b'])
  })
  it('[] 平衡组内的分隔符不切分', () => {
    const r = splitTopLevel('tag.div[a&&b]@text&&c@text', ['&&'])
    expect(r.list).toEqual(['tag.div[a&&b]@text', 'c@text'])
  })
})

describe('splitPurify', () => {
  it('无净化段', () => {
    expect(splitPurify('content@text').pattern).toBe('')
  })
  it('仅正则（删除匹配）', () => {
    const p = splitPurify('content@text##广告')
    expect(p.rule).toBe('content@text')
    expect(p.pattern).toBe('广告')
    expect(p.replacement).toBe('')
  })
  it('正则+替换', () => {
    const p = splitPurify('content@text##\\d+##[NUM]')
    expect(p.rule).toBe('content@text')
    expect(p.pattern).toBe('\\d+')
    expect(p.replacement).toBe('[NUM]')
  })
  it('### 模式标记 replaceFirst', () => {
    const p = splitPurify('content@text##第\\S+章.*?##替换###')
    expect(p.replaceFirst).toBe(true)
    expect(p.replacement).toBe('替换')
  })
})

describe('applyPurify', () => {
  it('全局替换', () => {
    expect(applyPurify('a1b2c', { rule: '', pattern: '\\d', replacement: '', replaceFirst: false })).toBe('abc')
  })
  it('非法正则不匹配时原样返回（对齐 legado 字面量替换语义）', () => {
    expect(
      applyPurify('axb', { rule: '', pattern: '[', replacement: '-', replaceFirst: false })
    ).toBe('axb')
  })
})

describe('jsoupGetString 默认语法', () => {
  const ctx = createJsoupContext(HTML)

  it('class + tag + text（列表 \\n 连接）', () => {
    expect(jsoupGetString(ctx, 'class.content@tag.p@text')).toBe('甲\n乙')
  })
  it('正数索引', () => {
    expect(jsoupGetString(ctx, 'class.content@tag.p.0@text')).toBe('甲')
  })
  it('负数索引', () => {
    expect(jsoupGetString(ctx, 'class.content@tag.p.-1@text')).toBe('乙')
  })
  it('属性终止符', () => {
    expect(jsoupGetString(ctx, 'tag.img@src')).toBe('a.jpg')
  })
  it('children 索引', () => {
    expect(jsoupGetString(ctx, 'class.content@children.2@src')).toBe('a.jpg')
  })
  it('textNodes 取直接文本节点', () => {
    expect(jsoupGetString(ctx, 'class.mixed@textNodes')).toBe('直接\n尾部')
  })
  it('ownText 合并直接文本', () => {
    expect(jsoupGetString(ctx, 'class.mixed@ownText')).toBe('直接 尾部')
  })
  it('id 前缀', () => {
    const c2 = createJsoupContext('<div id="main">hi</div>')
    expect(jsoupGetString(c2, 'id.main@text')).toBe('hi')
  })
  it('单段 text 终止符作用于根', () => {
    expect(jsoupGetString(createJsoupContext('<p>hello</p>'), 'text')).toBe('hello')
  })
})

describe('组合符', () => {
  const ctx = createJsoupContext(HTML)
  it('|| 取第一个非空', () => {
    expect(jsoupGetString(ctx, 'class.none@text||class.mixed@ownText')).toBe('直接 尾部')
  })
  it('&& 结果拼接', () => {
    expect(jsoupGetString(ctx, 'class.content@tag.p.0@text&&class.content@tag.p.1@text')).toBe('甲\n乙')
  })
  it('%% 列表交错', () => {
    const els = jsoupGetElements(ctx, 'class.content@tag.p%%class.content@tag.p')
    expect(els).toHaveLength(4)
  })
})

describe('@CSS: 模式', () => {
  const ctx = createJsoupContext(HTML)
  it('CSS 选择器 + 终止符', () => {
    expect(jsoupGetString(ctx, '@CSS:.content p@text')).toBe('甲\n乙')
  })
  it('CSS 属性选择器', () => {
    expect(jsoupGetString(ctx, '@CSS:img[src]@src')).toBe('a.jpg')
  })
})

describe('jsoupGetElements', () => {
  const ctx = createJsoupContext(HTML)
  it('返回元素列表供逐项解析', () => {
    const els = jsoupGetElements(ctx, 'class.content@tag.p')
    expect(els).toHaveLength(2)
    const item = createJsoupContext([els[0]], (ctx as any).$)
    expect(jsoupGetString(item, 'text')).toBe('甲')
  })
  it('[] 数组式索引', () => {
    const els = jsoupGetElements(ctx, 'class.list@tag.li[1,3]')
    const item = createJsoupContext(els, (ctx as any).$)
    expect(jsoupGetString(item, 'text')).toBe('二\n四')
  })
  it('区间索引 0:2', () => {
    const els = jsoupGetElements(ctx, 'class.list@tag.li[0:2]')
    expect(els).toHaveLength(3)
  })
  it('! 排除索引', () => {
    const els = jsoupGetElements(ctx, 'class.list@tag.li!0')
    expect(els).toHaveLength(3)
  })
})
