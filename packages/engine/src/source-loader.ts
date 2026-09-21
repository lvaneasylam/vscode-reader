import type { BookSource } from './types.js'

export type ParseSourceResult =
  | { ok: true; source: BookSource; warnings: string[] }
  | { ok: false; error: string }

/**
 * 解析单个书源 JSON 字符串。
 * 规则字段若为对象形式（legado 允许字符串化 JSON 规则），第一版不展开，给警告。
 */
export function parseBookSource(json: string): ParseSourceResult {
  let raw: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(json.replace(/^\uFEFF/, ""))
    if (Array.isArray(parsed)) return { ok: false, error: '传入的是书源数组，请使用 parseBookSources' }
    if (parsed === null || typeof parsed !== 'object') return { ok: false, error: '书源必须是 JSON 对象' }
    raw = parsed as Record<string, unknown>
  } catch (e) {
    return { ok: false, error: `JSON 解析失败: ${(e as Error).message}` }
  }

  const bookSourceUrl = typeof raw.bookSourceUrl === 'string' ? raw.bookSourceUrl.trim() : ''
  if (!bookSourceUrl) return { ok: false, error: '缺少必填字段 bookSourceUrl' }

  const source: BookSource = {
    ...raw,
    bookSourceUrl,
    bookSourceName: typeof raw.bookSourceName === 'string' ? raw.bookSourceName : bookSourceUrl,
    headerMap: normalizeHeader(raw.header)
  }

  return { ok: true, source, warnings: checkUnsupported(source) }
}

/** 解析书源合集（数组或单对象），跳过无效条目；容忍 BOM 头（中文 JSON 常见） */
export function parseBookSources(json: string): BookSource[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripBom(json))
  } catch {
    return []
  }
  const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
  const sources: BookSource[] = []
  for (const item of list) {
    const r = parseBookSource(JSON.stringify(item))
    if (r.ok) sources.push(r.source)
  }
  return sources
}

/** 去除 UTF-8 BOM 与首尾空白 */
function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim()
}

/** header 兼容 JSON 字符串与对象两种形式 */
function normalizeHeader(header: unknown): Record<string, string> {
  if (!header) return {}
  let obj: unknown = header
  if (typeof header === 'string') {
    try {
      obj = JSON.parse(header)
    } catch {
      return {}
    }
  }
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const map: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof v === 'string') map[k] = v
  }
  return map
}

/** 检测第一版不支持的特性，返回警告列表（不阻止导入） */
export function checkUnsupported(source: BookSource): string[] {
  const warnings: string[] = []
  if ((source.bookSourceType ?? 0) !== 0) {
    warnings.push(`不支持的书源类型 bookSourceType=${source.bookSourceType}（仅支持 0=文本）`)
  }

  const groups = [
    ['ruleSearch', source.ruleSearch],
    ['ruleBookInfo', source.ruleBookInfo],
    ['ruleToc', source.ruleToc],
    ['ruleContent', source.ruleContent],
    ['ruleExplore', source.ruleExplore]
  ] as const

  for (const [name, rule] of groups) {
    if (!rule || typeof rule !== 'object') continue
    for (const [field, value] of Object.entries(rule)) {
      if (value === null || value === undefined) continue
      if (typeof value !== 'string') {
        warnings.push(`${name}.${field} 为对象形式规则，第一版不支持`)
        continue
      }
      if (value.includes('@XPath:')) warnings.push(`${name}.${field} 使用 @XPath: 规则，第一版不支持`)
    }
  }
  return [...new Set(warnings)]
}
