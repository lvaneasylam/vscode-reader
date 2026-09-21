/**
 * JSONPath 规则。对齐 AnalyzeByJSonPath：
 * - 规则以 $. 开头（@json: 前缀在入口剥掉）
 * - 支持 &&、|| 组合，结果列表以 \n 连接
 */
import { JSONPath } from 'jsonpath-plus'
import { splitTopLevel } from './rule-analyzer.js'

export function isJsonContent(content: string): boolean {
  const t = content.trimStart()
  if (!t.startsWith('{') && !t.startsWith('[')) return false
  try {
    JSON.parse(t)
    return true
  } catch {
    return false
  }
}

export function parseJson(content: string): unknown {
  return JSON.parse(content.trim())
}

export function jsonGetString(json: unknown, rule: string): string | null {
  const list = jsonGetStringList(json, rule)
  if (list.length === 0) return null
  return list.length === 1 ? list[0] : list.join('\n')
}

export function jsonGetStringList(json: unknown, rule: string): string[] {
  rule = rule.trim()
  if (!rule) return []
  const { list: rules, elementsType } = splitTopLevel(rule, ['&&', '||'])
  const results: string[][] = []
  for (const r of rules) {
    let values: unknown[] = []
    try {
      values = JSONPath({ path: r, json: json as object, wrap: true }) as unknown[]
    } catch {
      values = []
    }
    const strs = values.filter(v => v !== undefined && v !== null).map(toStr)
    if (strs.length > 0) {
      results.push(strs)
      if (elementsType === '||') break
    }
  }
  const out: string[] = []
  for (const r of results) out.push(...r)
  return out
}

export function jsonGetElements(json: unknown, rule: string): unknown[] {
  rule = rule.trim()
  if (!rule) return []
  const { list: rules, elementsType } = splitTopLevel(rule, ['&&', '||'])
  const out: unknown[] = []
  for (const r of rules) {
    let values: unknown[] = []
    try {
      values = JSONPath({ path: r, json: json as object, wrap: true }) as unknown[]
    } catch {
      values = []
    }
    // 展平：$.data 这类「路径值本身是数组」的列表规则，元素是数组的各项（对齐 legado 列表语义）
    for (const v of values) {
      if (v === undefined || v === null) continue
      if (Array.isArray(v)) out.push(...v)
      else out.push(v)
    }
    if (out.length > 0 && elementsType === '||') break
  }
  return out
}

function toStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
