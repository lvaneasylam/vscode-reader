/**
 * legado 默认 jsoup 规则语法。对齐 AnalyzeByJSoup.kt：
 * - 规则形如 `class.content@tag.p.0@text`，@ 分层，末段为终止符/属性
 * - 选择器前缀：class./tag./id./children/text./其他(回退 CSS)
 * - 索引：`tag.div.1`、`tag.div.-1:10:2`、`tag.div!0`、`tag.div[-1, 3:-2, 2]`
 * - 终止符：text/textNodes/ownText/html/all/其他=属性名
 * - @CSS: 前缀走 CSS 模式（选择器 + @终止符）
 */
import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { splitTopLevel } from './rule-analyzer.js'

export interface JsoupContext {
  $: CheerioAPI
  /** 当前作用元素（setContent 的根，或 getElements 的列表项） */
  roots: AnyNode[]
}

export function createJsoupContext(content: string | AnyNode[], $?: CheerioAPI): JsoupContext {
  if (typeof content === 'string') {
    const api = $ ?? load(content)
    return { $: api, roots: [api.root()[0]] as AnyNode[] }
  }
  if (!$) throw new Error('元素列表必须提供 CheerioAPI')
  return { $, roots: content }
}

/** 获取字符串（列表以 \n 连接），失败返回 null（对齐 getString） */
export function jsoupGetString(ctx: JsoupContext, ruleStr: string): string | null {
  const list = jsoupGetStringList(ctx, ruleStr)
  if (list.length === 0) return null
  return list.length === 1 ? list[0] : list.join('\n')
}

export function jsoupGetStringList(ctx: JsoupContext, ruleStr: string): string[] {
  ruleStr = ruleStr.trim()
  if (!ruleStr) return []
  const { list: rules, elementsType } = splitTopLevel(ruleStr, ['&&', '||', '%%'])
  const results: string[][] = []
  for (const r of rules) {
    const temp = isCssRule(r)
      ? getStringByCss(ctx, r.replace(/^@CSS:/i, '').trim())
      : getStringByDefault(ctx, r)
    if (temp.length > 0) {
      results.push(temp)
      if (elementsType === '||') break
    }
  }
  return combine(results, elementsType)
}

/** 获取元素列表（bookList/chapterList 场景） */
export function jsoupGetElements(ctx: JsoupContext, rule: string): AnyNode[] {
  rule = rule.trim()
  if (!rule) return []
  const { list: rules, elementsType } = splitTopLevel(rule, ['&&', '||', '%%'])
  const results: AnyNode[][] = []
  for (const r of rules) {
    const el = isCssRule(r)
      ? selectSelf(ctx, ctx.roots, r.replace(/^@CSS:/i, '').trim())
      : chainElements(ctx, ctx.roots, splitTopLevel(r, ['@']).list)
    results.push(el)
    if (el.length > 0 && elementsType === '||') break
  }
  return combine(results, elementsType)
}

function isCssRule(rule: string): boolean {
  return /^@CSS:/i.test(rule.trim())
}

/** 组合结果：|| 取已收集，%% 交错，其余顺序拼接 */
function combine<T>(results: T[][], elementsType: string): T[] {
  const out: T[] = []
  if (results.length === 0) return out
  if (elementsType === '%%') {
    const max = Math.max(...results.map(r => r.length))
    for (let i = 0; i < max; i++) {
      for (const r of results) if (i < r.length) out.push(r[i])
    }
  } else {
    for (const r of results) out.push(...r)
  }
  return out
}

/** 默认语法取字符串：@ 分层，末段终止符 */
function getStringByDefault(ctx: JsoupContext, rule: string): string[] {
  const parts = splitTopLevel(rule, ['@']).list
  if (parts.length === 1) {
    return getResultLast(ctx, ctx.roots, parts[0].trim())
  }
  let elements = ctx.roots
  for (const part of parts.slice(0, -1)) {
    elements = chainSingle(ctx, elements, part)
    if (elements.length === 0) return []
  }
  return getResultLast(ctx, elements, parts[parts.length - 1].trim())
}

/** CSS 模式取字符串：lastIndexOf('@') 前为选择器，后为终止符 */
function getStringByCss(ctx: JsoupContext, rule: string): string[] {
  const last = rule.lastIndexOf('@')
  if (last <= 0) {
    const selected = selectSelf(ctx, ctx.roots, rule)
    return selected.map(el => normText(ctx.$(el).text())).filter(t => t.length > 0)
  }
  const selected = selectSelf(ctx, ctx.roots, rule.slice(0, last))
  return getResultLast(ctx, selected, rule.slice(last + 1).trim())
}

/** 对一组元素逐层执行选择器段 */
function chainElements(ctx: JsoupContext, roots: AnyNode[], parts: string[]): AnyNode[] {
  let elements = roots
  for (const part of parts) {
    elements = chainSingle(ctx, elements, part)
    if (elements.length === 0) return []
  }
  return elements
}

function chainSingle(ctx: JsoupContext, elements: AnyNode[], part: string): AnyNode[] {
  const next: AnyNode[] = []
  for (const el of elements) next.push(...getElementsSingle(ctx, el, part.trim()))
  return next
}

/** 含自身的选择器查找（对齐 jsoup getElementsByXxx 语义） */
function selectSelf(ctx: JsoupContext, roots: AnyNode[], selector: string): AnyNode[] {
  const out: AnyNode[] = []
  for (const root of roots) {
    const $el = ctx.$(root)
    if ($el.is(selector)) out.push(...$el.toArray())
    out.push(...$el.find(selector).toArray())
  }
  return out
}

/** 单段选择器执行：解析尾部索引 + 前缀选择 + 索引筛选 */
function getElementsSingle(ctx: JsoupContext, el: AnyNode, rule: string): AnyNode[] {
  const spec = parseIndexSpec(rule)
  const elements = selectByBeforeRule(ctx, el, spec.beforeRule)
  const len = elements.length
  const picked = applyIndexes(len, spec)
  const out: AnyNode[] = []
  if (spec.split === '!') {
    const excluded = new Set(picked)
    for (let i = 0; i < len; i++) if (!excluded.has(i)) out.push(elements[i])
  } else {
    for (const i of picked) if (i >= 0 && i < len) out.push(elements[i])
  }
  return out
}

function selectByBeforeRule(ctx: JsoupContext, el: AnyNode, beforeRule: string): AnyNode[] {
  const $el = ctx.$(el)
  if (!beforeRule) return $el.children().toArray()
  const dot = beforeRule.indexOf('.')
  const kind = dot === -1 ? beforeRule : beforeRule.slice(0, dot)
  const arg = dot === -1 ? '' : beforeRule.slice(dot + 1)
  switch (kind) {
    case 'children':
      return $el.children().toArray()
    case 'class':
      return selectSelf(ctx, [el], `.${escapeIdent(arg)}`)
    case 'tag':
      return selectSelf(ctx, [el], arg)
    case 'id':
      return selectSelf(ctx, [el], `#${escapeIdent(arg)}`)
    case 'text':
      // getElementsContainingOwnText：自身直接文本包含关键字的元素
      return $el
        .find('*')
        .filter((_, n) => ownText(ctx, n).includes(arg))
        .toArray()
    default:
      return selectSelf(ctx, [el], beforeRule)
  }
}

/** 终止符处理（对齐 getResultLast） */
function getResultLast(ctx: JsoupContext, elements: AnyNode[], lastRule: string): string[] {
  const textS: string[] = []
  switch (lastRule) {
    case 'text':
      for (const el of elements) {
        const text = normText(ctx.$(el).text())
        if (text) textS.push(text)
      }
      break
    case 'textNodes':
      for (const el of elements) {
        const tn = directTexts(ctx, el)
        if (tn.length > 0) textS.push(tn.join('\n'))
      }
      break
    case 'ownText':
      for (const el of elements) {
        const text = ownText(ctx, el)
        if (text) textS.push(text)
      }
      break
    case 'html': {
      const cloned = ctx.$(elements as never).clone()
      cloned.find('script').remove()
      cloned.find('style').remove()
      for (const el of cloned.toArray()) textS.push(ctx.$.html(el))
      break
    }
    case 'all':
      for (const el of elements) textS.push(ctx.$.html(el))
      break
    default:
      for (const el of elements) {
        const url = ctx.$(el).attr(lastRule) ?? ''
        if (!url || textS.includes(url)) continue
        textS.push(url)
      }
  }
  return textS
}

/** 元素直接子文本节点列表（trim 后非空） */
function directTexts(ctx: JsoupContext, el: AnyNode): string[] {
  const out: string[] = []
  for (const node of ctx.$(el).contents().toArray()) {
    if (node.type === 'text') {
      const t = ctx.$(node).text().replace(/[ \t]+/g, ' ').trim()
      if (t) out.push(t)
    }
  }
  return out
}

function ownText(ctx: JsoupContext, el: AnyNode): string {
  return directTexts(ctx, el).join(' ')
}

/** jsoup text() 会折叠连续空白 */
function normText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function escapeIdent(ident: string): string {
  return ident.replace(/[^\w-]/g, c => `\\${c}`)
}

// ---------- 索引语法 ----------

interface RangeSpec {
  start: number | null
  end: number | null
  step: number
}

interface IndexSpec {
  split: '.' | '!' | ' '
  beforeRule: string
  /** 阅读式（. 和 : 分隔）的多索引，书写顺序 */
  indexDefault: number[]
  /** [] 式索引：单索引或区间 */
  indexes: Array<number | RangeSpec>
}

const ARRAY_INDEX_RE = /^(.*)\[([!]?)([^[\]]*)\]$/
const DOT_INDEX_RE = /^(.+?)([.!])(-?\d+(?::-?\d+)*)$/

/** 解析规则尾部的索引段（对齐 ElementsSingle.findIndexSet 的可观测行为） */
export function parseIndexSpec(rule: string): IndexSpec {
  const base: IndexSpec = { split: ' ', beforeRule: rule, indexDefault: [], indexes: [] }
  const trimmed = rule.trim()
  const arr = ARRAY_INDEX_RE.exec(trimmed)
  if (arr) {
    const spec: IndexSpec = { ...base, beforeRule: arr[1].trim(), split: arr[2] ? '!' : '.' }
    for (const item of arr[3].split(',')) {
      const part = item.trim()
      if (!part) continue
      if (part.includes(':')) {
        const [s, e, st] = part.split(':')
        spec.indexes.push({
          start: s === '' || s === undefined ? null : parseInt(s, 10),
          end: e === '' || e === undefined ? null : parseInt(e, 10),
          step: st === '' || st === undefined ? 1 : parseInt(st, 10)
        })
      } else {
        spec.indexes.push(parseInt(part, 10))
      }
    }
    if (spec.indexes.length > 0) return spec
    return base
  }
  const dot = DOT_INDEX_RE.exec(trimmed)
  if (dot) {
    const spec: IndexSpec = {
      ...base,
      split: dot[2] === '!' ? '!' : '.',
      beforeRule: dot[1],
      indexDefault: dot[3].split(':').map(Number)
    }
    return spec.indexDefault.every(Number.isFinite) ? spec : base
  }
  return base
}

/** 应用索引筛选，返回选中的索引（保序去重；'!' 排除时返回剩余全部） */
function applyIndexes(len: number, spec: IndexSpec): number[] {
  const picked: number[] = []
  const seen = new Set<number>()
  const push = (i: number) => {
    if (i >= 0 && i < len && !seen.has(i)) {
      seen.add(i)
      picked.push(i)
    }
  }
  if (spec.indexes.length === 0) {
    for (const it of spec.indexDefault) {
      if (it >= 0 && it < len) push(it)
      else if (it < 0 && len >= -it) push(it + len)
    }
    if (spec.indexDefault.length === 0 && spec.split === ' ') {
      for (let i = 0; i < len; i++) push(i)
    }
    return picked
  }
  for (const item of spec.indexes) {
    if (typeof item === 'number') {
      if (item >= 0 && item < len) push(item)
      else if (item < 0 && len >= -item) push(item + len)
      continue
    }
    let start = item.start ?? 0
    let end = item.end ?? len - 1
    if (start < 0) start += len
    if (end < 0) end += len
    if ((start < 0 && end < 0) || (start >= len && end >= len)) continue
    if (start >= len) start = len - 1
    else if (start < 0) start = 0
    if (end >= len) end = len - 1
    else if (end < 0) end = 0
    if (start === end || Math.abs(item.step) >= len) {
      push(start)
      continue
    }
    const step = item.step > 0 ? item.step : -item.step < len ? item.step + len : 1
    if (end > start) {
      for (let i = start; i <= end; i += step) push(i)
    } else {
      for (let i = start; i >= end; i += step) push(i)
    }
  }
  return picked
}
