/**
 * 规则统一入口。对齐 AnalyzeRule：
 * - {{...}} 内嵌 JS 替换（沙盒由外部注入，engine 保持平台无关）
 * - 前缀分发：@json: → JSONPath；@XPath: → 抛不支持；内容为 JSON → JSONPath；其余 → jsoup
 * - ##pattern##replacement 净化
 * - isUrl：相对地址基于 baseUrl 转绝对
 */
import type { CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { splitPurify, applyPurify, replaceInnerRule } from './rule-analyzer.js'
import {
  createJsoupContext,
  jsoupGetString,
  jsoupGetElements,
  type JsoupContext
} from './query-jsoup.js'
import {
  isJsonContent,
  parseJson,
  jsonGetString,
  jsonGetElements
} from './query-json.js'

export type JsEvalFn = (code: string, ctx: RuleEvalContext) => Promise<string | null>

export interface RuleEvalContext {
  baseUrl?: string
  book?: Record<string, unknown>
  chapter?: Record<string, unknown>
  key?: string
  page?: number
  result?: unknown
  [k: string]: unknown
}

export class UnsupportedRuleError extends Error {
  constructor(feature: string) {
    super(`不支持的书源特性: ${feature}`)
    this.name = 'UnsupportedRuleError'
  }
}

export class AnalyzeRule {
  private content: string | AnyNode[] | unknown = ''
  private baseUrl = ''
  private jsonCache: unknown
  private jsonParsed = false
  private jsoupCtx: JsoupContext | null = null
  private $: CheerioAPI | null = null

  constructor(
    private readonly evalJs: JsEvalFn,
    private readonly ruleCtx: RuleEvalContext = {}
  ) {}

  /** content：响应体字符串 / jsoup 元素列表（需传 $）/ JSON 数据（聚合源列表项） */
  setContent(content: string | AnyNode[] | unknown, baseUrl?: string, $?: CheerioAPI): this {
    this.content = content
    if (baseUrl) this.baseUrl = baseUrl
    this.jsonCache = undefined
    this.jsonParsed = false
    this.jsoupCtx = null
    this.$ = $ ?? null
    return this
  }

  async getString(rule: string, opts: { isUrl?: boolean } = {}): Promise<string | null> {
    if (!rule) return null
    if (rule.includes('{{')) {
      const t = rule.trim()
      // 整条规则由 {{}} 块（可多块拼接字面量）构成：逐块求值后直接作为值（对齐 legado 拼接语义）
      const isBlockRule = t.startsWith('{{') && t.endsWith('}}')
      const replaced = await this.replaceJs(rule)
      if (isBlockRule && !replaced.includes('{{')) {
        return opts.isUrl && this.baseUrl ? toAbsoluteUrl(replaced, this.baseUrl) : replaced
      }
      rule = replaced
    }
    // 多段规则链（<js>...</js>后续规则 / @js:链）：前段结果作为后段输入
    const segments = splitRuleSegments(rule)
    if (segments.length > 1 || (segments.length === 1 && segments[0].kind === 'js')) {
      return this.runSegments(segments, opts)
    }
    return this.evalRuleSegment(rule, opts)
  }

  /** 单规则段执行（净化 + 模式分发 + isUrl） */
  private async evalRuleSegment(rule: string, opts: { isUrl?: boolean } = {}): Promise<string | null> {
    const purify = splitPurify(rule)
    let result = this.getStringRaw(purify.rule)
    if (result === null) return null
    if (opts.isUrl && this.baseUrl) {
      result = toAbsoluteUrl(result, this.baseUrl)
    }
    return applyPurify(result, purify)
  }

  /**
   * 多段规则链式执行（对齐 AnalyzeRule.splitSourceRule 的段序语义）：
   * `<js>...</js>$.data` = 先执行 JS，其返回值作为后续规则段的内容。
   */
  private async runSegments(
    segments: Array<{ kind: 'js'; code: string } | { kind: 'rule'; rule: string }>,
    opts: { isUrl?: boolean } = {}
  ): Promise<string | null> {
    const originalContent = this.content
    const originalCtx = this.jsoupCtx
    try {
      let result: string | null = null
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const isLast = i === segments.length - 1
        if (seg.kind === 'js') {
          // result 保留原始类型：字符串内容传字符串（hex/HTML），JSON 元素传对象（result.field 可直接访问）
          result = await this.evalJs(seg.code, { ...this.ruleCtx, result: this.content ?? '' })
        } else {
          result = await this.evalRuleSegment(seg.rule, isLast ? opts : {})
        }
        if (isLast) return result
        this.setTransientContent(result ?? '')
      }
    } finally {
      this.content = originalContent
      this.jsoupCtx = originalCtx
      this.jsonCache = undefined
      this.jsonParsed = false
    }
    return null
  }

  /** 段间内容切换（链式中间态，不保留） */
  private setTransientContent(content: string): void {
    this.content = content
    this.jsoupCtx = null
    this.jsonCache = undefined
    this.jsonParsed = false
    if (typeof this.$ !== 'undefined') this.$ = null
  }

  async getStringList(rule: string): Promise<string[]> {
    const s = await this.getString(rule)
    if (s === null) return []
    return s.split('\n')
  }

  async getElements(rule: string): Promise<AnyNode[] | unknown[]> {
    if (!rule) return []
    rule = await this.replaceJs(rule)
    const segments = splitRuleSegments(rule)
    if (segments.length > 1 || (segments.length === 1 && segments[0].kind === 'js')) {
      return this.runElementSegments(segments)
    }
    return this.getElementsSingle(rule)
  }

  private async getElementsSingle(rule: string): Promise<AnyNode[] | unknown[]> {
    if (rule.startsWith('@XPath:') || rule.startsWith('@xpath:')) {
      throw new UnsupportedRuleError('@XPath: 规则')
    }
    if (isJsonRule(rule)) {
      return jsonGetElements(this.getJson(), stripPrefix(rule))
    }
    return jsoupGetElements(this.getJsoupCtx(), rule)
  }

  /** 多段规则链（getElements 场景）：前段结果作为后段内容，末段返回元素列表 */
  private async runElementSegments(
    segments: Array<{ kind: 'js'; code: string } | { kind: 'rule'; rule: string }>
  ): Promise<AnyNode[] | unknown[]> {
    const originalContent = this.content
    const originalCtx = this.jsoupCtx
    try {
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const isLast = i === segments.length - 1
        if (seg.kind === 'js') {
          const v = await this.evalJs(seg.code, { ...this.ruleCtx, result: this.content ?? '' })
          if (isLast) {
            if (v === null) return []
            try {
              const arr: unknown = JSON.parse(v)
              return Array.isArray(arr) ? arr : [arr]
            } catch {
              return [v]
            }
          }
          this.setTransientContent(v ?? '')
        } else {
          if (isLast) return this.getElementsSingle(seg.rule)
          const v = await this.evalRuleSegment(seg.rule)
          this.setTransientContent(v ?? '')
        }
      }
    } finally {
      this.content = originalContent
      this.jsoupCtx = originalCtx
      this.jsonCache = undefined
      this.jsonParsed = false
    }
    return []
  }

  /** 供列表项解析：jsoup 元素（单个或数组）/ JSON 对象 / 字符串均可作为新的内容根 */
  setContentItem(item: AnyNode | AnyNode[] | unknown): this {
    const nodes = isDomNode(item)
      ? [item]
      : Array.isArray(item) && item.length > 0 && item.every(isDomNode)
        ? item
        : null
    if (nodes) {
      if (!this.$ && typeof this.content === 'string') this.getJsoupCtx()
      if (!this.$) throw new Error('setContentItem 需要先以字符串内容初始化')
      this.jsoupCtx = { $: this.$, roots: nodes }
    } else {
      this.jsoupCtx = null
    }
    this.content = item
    this.jsonCache = undefined
    this.jsonParsed = false
    return this
  }

  private getStringRaw(rule: string): string | null {
    if (rule.startsWith('@XPath:') || rule.startsWith('@xpath:')) {
      throw new UnsupportedRuleError('@XPath: 规则')
    }
    if (isJsonRule(rule)) return jsonGetString(this.getJson(), stripPrefix(rule))
    if (this.isJsonValue()) return jsonGetString(this.getJson(), rule)
    return jsoupGetString(this.getJsoupCtx(), rule)
  }

  /** 内容是否为 JSON（字符串可解析 / 已是数据对象；DOM 元素不算） */
  private isJsonValue(): boolean {
    return (
      (typeof this.content === 'string' && isJsonContent(this.content)) ||
      (typeof this.content === 'object' &&
        this.content !== null &&
        !Array.isArray(this.content) &&
        !isDomNode(this.content))
    )
  }

  private contentAsString(): string {
    if (typeof this.content === 'string') return this.content
    if (this.content === null || this.content === undefined) return ''
    return JSON.stringify(this.content)
  }

  private async replaceJs(rule: string): Promise<string> {
    if (!rule.includes('{{')) return rule
    return replaceInnerRule(rule, async code => {
      // {{$.field}} 形态是「当前内容上的 JSONPath」（书源生态惯例），非 JS 表达式。
      // 即使路径未命中（对象缺该字段）也返回空串，不走 JS 执行（$ 未定义会炸整条链路）
      const t = code.trim()
      if (/^\$(\$|\.)/.test(t) && !/[;=(]|=>|\bfunction\b/.test(t) && this.isJsonValue()) {
        try {
          const v = jsonGetString(this.getJson(), t)
          if (v !== null) return v
        } catch {
          /* JSON 解析异常走空串 */
        }
        return ''
      }
      return this.evalJs(code, this.ruleCtx)
    })
  }

  private getJson(): unknown {
    if (!this.jsonParsed) {
      this.jsonCache =
        typeof this.content === 'string'
          ? parseJson(this.content)
          : this.content !== null && this.content !== undefined
            ? this.content
            : null
      this.jsonParsed = true
    }
    if (this.jsonCache === null) throw new Error('内容不是合法 JSON')
    return this.jsonCache
  }

  private getJsoupCtx(): JsoupContext {
    if (!this.jsoupCtx) {
      if (typeof this.content === 'string') {
        const ctx = createJsoupContext(this.content)
        this.$ = ctx.$
        this.jsoupCtx = ctx
      } else {
        // 此分支仅会在内容为元素数组时到达（JSON 走 isJsonValue 前置分支）
        this.jsoupCtx = createJsoupContext(this.content as AnyNode[], this.$!)
      }
    }
    return this.jsoupCtx
  }
}

function isJsonRule(rule: string): boolean {
  return /^@json:/i.test(rule.trim()) || rule.trimStart().startsWith('$.')
}

function stripPrefix(rule: string): string {
  return rule.trim().replace(/^@json:/i, '').trim()
}

/** 提取 @js: / <js>...</js> 形式的整段 JS 规则 */
export function extractJsRule(rule: string): string | null {
  const t = rule.trim()
  if (t.startsWith('@js:')) return t.slice(4)
  if (t.startsWith('<js>')) {
    const end = t.lastIndexOf('</js>')
    return end === -1 ? t.slice(4) : t.slice(4, end)
  }
  return null
}

/**
 * 拆分多段规则（对齐 AnalyzeRule.splitSourceRule 的段序）：
 * `<js>...</js>$.data` → [JS 段, rule 段]；纯规则 → [rule 段]。
 */
export function splitRuleSegments(rule: string): Array<{ kind: 'js'; code: string } | { kind: 'rule'; rule: string }> {
  const t = rule.trim()
  if (t.startsWith('@js:')) {
    return [{ kind: 'js', code: t.slice(4) }]
  }
  const segments: Array<{ kind: 'js'; code: string } | { kind: 'rule'; rule: string }> = []
  const JS_TAG = /<js>([\s\S]*?)<\/js>/g
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = JS_TAG.exec(rule)) !== null) {
    if (m.index > pos) {
      const before = rule.slice(pos, m.index)
      // trim：书源惯用 "</js>\n规则"，前导空白会使 JSON 规则判定失效
      if (before.trim()) segments.push({ kind: 'rule', rule: before.trim() })
    }
    segments.push({ kind: 'js', code: m[1] })
    pos = m.index + m[0].length
  }
  if (pos < rule.length) {
    const tail = rule.slice(pos)
    if (tail.trim()) segments.push({ kind: 'rule', rule: tail.trim() })
  }
  return segments
}

/** domhandler 节点特征判别（type + parent 属性并存） */
function isDomNode(x: unknown): x is AnyNode {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in (x as object) &&
    'parent' in (x as object)
  )
}

/** 相对 URL → 绝对（非法输入原样返回，对齐 NetworkUtils.getAbsoluteURL） */
export function toAbsoluteUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}
