/**
 * 规则切分器。对齐 legado RuleAnalyzer 的顶层切分语义：
 * - 组合符 &&、||、%% 只在「引号外、[]/() 平衡组外」生效
 * - {{...}} 内嵌 JS 块整体视为普通文本
 * - ##pattern##replacement 尾部净化
 */

export interface SplitResult {
  /** 切分后的子规则列表（组合符决定合并语义） */
  list: string[]
  /** 首个顶层分隔符（组合类型：'&&' | '||' | '%%'），无分隔符时为 '' */
  elementsType: string
}

/** 按顶层组合符切分规则（跳过引号与 []、() 平衡组） */
export function splitTopLevel(rule: string, separators: string[]): SplitResult {
  const seps: Array<{ start: number; end: number }> = []
  let elementsType = ''
  const stack: string[] = []
  let inSingle = false
  let inDouble = false
  let i = 0
  while (i < rule.length) {
    const c = rule[i]
    if (inSingle || inDouble) {
      if (c === "'" && !inDouble) inSingle = false
      else if (c === '"' && !inSingle) inDouble = false
      i++
      continue
    }
    if (c === "'") { inSingle = true; i++; continue }
    if (c === '"') { inDouble = true; i++; continue }
    if (c === '\\') { i += 2; continue }
    if (c === '[' || c === '(') { stack.push(c); i++; continue }
    if (c === ']' || c === ')') { stack.pop(); i++; continue }
    if (stack.length === 0) {
      const sep = separators.find(s => rule.startsWith(s, i) && s.length > 0)
      if (sep) {
        if (!elementsType) elementsType = sep
        if (sep === elementsType) seps.push({ start: i, end: i + sep.length })
        i += sep.length
        continue
      }
    }
    i++
  }

  if (seps.length === 0) return { list: [rule], elementsType: '' }

  const list: string[] = []
  let pos = 0
  for (const s of seps) {
    list.push(rule.slice(pos, s.start))
    pos = s.end
  }
  list.push(rule.slice(pos))
  return { list, elementsType }
}

export interface PurifyParts {
  /** 净化前的实际规则 */
  rule: string
  /** 净化正则（空串表示无净化） */
  pattern: string
  /** 替换值 */
  replacement: string
  /** true 表示「###」模式：取首个匹配段并段内替换 */
  replaceFirst: boolean
}

/** 提取规则尾部的 ##pattern##replacement 净化段 */
export function splitPurify(rule: string): PurifyParts {
  const first = rule.indexOf('##')
  if (first === -1) return { rule, pattern: '', replacement: '', replaceFirst: false }
  const rest = rule.slice(first + 2)
  const second = rest.indexOf('##')
  if (second === -1) {
    // 形如 rule##pattern：仅保留规则，净化为删除匹配
    return { rule: rule.slice(0, first), pattern: rest, replacement: '', replaceFirst: false }
  }
  let pattern = rest.slice(0, second)
  let replacement = rest.slice(second + 2)
  let replaceFirst = false
  if (replacement.endsWith('###')) {
    replaceFirst = true
    replacement = replacement.slice(0, -3)
  }
  if (pattern.startsWith('/')) pattern = pattern.slice(1)
  return { rule: rule.slice(0, first), pattern, replacement, replaceFirst }
}

/** 应用净化（对齐 AnalyzeRule.replaceRegex） */
export function applyPurify(text: string, parts: PurifyParts): string {
  if (!parts.pattern) return text
  let regex: RegExp | null = null
  try {
    regex = new RegExp(parts.pattern, 'g')
  } catch {
    return text.split(parts.pattern).join(parts.replacement)
  }
  if (parts.replaceFirst) {
    const m = text.match(regex)
    return m ? m[0].replace(new RegExp(parts.pattern), parts.replacement) : ''
  }
  return text.replace(regex, parts.replacement)
}

/**
 * 替换内嵌 {{...}} 块（chompCodeBalanced：考虑引号与 [] 嵌套的大括号平衡）。
 * evalFn 返回 null/空时保留原文继续找下一个块。
 */
export async function replaceInnerRule(
  rule: string,
  evalFn: (code: string) => Promise<string | null>
): Promise<string> {
  const out: string[] = []
  let i = 0
  let last = 0
  while (i < rule.length) {
    if (rule.startsWith('{{', i)) {
      const end = findBalancedBraces(rule, i + 2)
      if (end !== -1) {
        const code = rule.slice(i + 2, end)
        const value = await evalFn(code)
        if (value) {
          out.push(rule.slice(last, i), value)
          last = end + 2
        }
        i = end + 2
        continue
      }
      i += 2
      continue
    }
    i++
  }
  if (last === 0) return rule
  out.push(rule.slice(last))
  return out.join('')
}

/** 从 start（{{ 之后）找平衡的 } 位置，考虑引号与 [] 深度 */
function findBalancedBraces(s: string, start: number): number {
  let depth = 1 // 已消耗一个 {
  let inSingle = false
  let inDouble = false
  let bracket = 0
  let i = start
  while (i < s.length) {
    const c = s[i]
    if (inSingle || inDouble) {
      if (c === "'" && !inDouble) inSingle = false
      else if (c === '"' && !inSingle) inDouble = false
      i++
      continue
    }
    if (c === "'") { inSingle = true; i++; continue }
    if (c === '"') { inDouble = true; i++; continue }
    if (c === '\\') { i += 2; continue }
    if (c === '[' || c === '(') bracket++
    else if (c === ']' || c === ')') bracket--
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}
