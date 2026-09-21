/**
 * 搜索/章节 URL 构造。对齐 legado AnalyzeUrl 的核心子集：
 * - `@js:` 前缀：整段 JS 生成 URL
 * - `{{key}}`/`{{page}}`/`{{...js}}` 占位替换
 * - 尾部 `,{...}` 选项块：method/headers/body/charset/retry/js
 * - useWebView → 抛不支持
 * - 相对地址基于 baseUrl 绝对化；headers 与书源 header 合并
 */
import type { BookSource } from './types.js'
import type { JsEvalFn } from './rule/analyze-rule.js'
import { replaceInnerRule } from './rule/rule-analyzer.js'
import { toAbsoluteUrl } from './rule/analyze-rule.js'

export interface UrlOption {
  method?: string
  headers?: Record<string, string>
  body?: string
  charset?: string
  retry?: number
  type?: string
  useWebView?: boolean
  webView?: boolean
  js?: string
  webJs?: string
  bodyJs?: string
  [k: string]: unknown
}

export interface BuiltUrl {
  url: string
  method: 'GET' | 'POST' | 'HEAD'
  headers: Record<string, string>
  body?: string
  charset?: string
  retry: number
  /** URL 带 type 选项（对齐 legado）：响应体为原始字节的 hex 编码 */
  hexBody?: boolean
  /** data: URL 直通载荷（已是 hex 编码，不发网络请求） */
  dataBody?: string
}

export interface AnalyzeUrlCtx {
  key?: string
  page?: number
  baseUrl?: string
  source?: BookSource
  /** 额外变量（book/chapter 等） */
  vars?: Record<string, unknown>
}

const OPTION_SPLIT_RE = /,\s*(?=\{)/

export async function analyzeUrl(mUrl: string, ctx: AnalyzeUrlCtx, evalJs: JsEvalFn): Promise<BuiltUrl> {
  let ruleUrl = mUrl.trim()

  // @js: 前缀 / <js>...</js> 包裹：整段 JS 生成 URL（聚合搜索源的常见形态）
  if (ruleUrl.startsWith('@js:')) {
    const v = await evalJs(ruleUrl.slice(4), { ...varsOf(ctx), result: ruleUrl.slice(4) })
    if (v) ruleUrl = v.trim()
  } else if (ruleUrl.startsWith('<js>')) {
    const end = ruleUrl.lastIndexOf('</js>')
    const code = end === -1 ? ruleUrl.slice(4) : ruleUrl.slice(4, end)
    const v = await evalJs(code, { ...varsOf(ctx) })
    if (v) ruleUrl = v.trim()
  }

  // {{...}} 占位替换（key/page/JS）
  if (ruleUrl.includes('{{')) {
    const replaced = await replaceInnerRule(ruleUrl, code =>
      evalJs(code, { ...varsOf(ctx), result: code })
    )
    if (replaced) ruleUrl = replaced
  }

  // 切分尾部选项块 `,{...}`
  let urlPart = ruleUrl
  let option: UrlOption = {}
  const m = OPTION_SPLIT_RE.exec(ruleUrl)
  if (m) {
    const maybeOption = ruleUrl.slice(m.index + 1)
    try {
      const parsed: unknown = JSON.parse(maybeOption)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        option = parsed as UrlOption
        urlPart = ruleUrl.slice(0, m.index)
      }
    } catch {
      /* 形似选项块但非合法 JSON，按普通 URL 处理 */
    }
  }

  if (option.useWebView || option.webView) {
    throw new Error('不支持的书源特性: WebView 渲染请求')
  }

  const baseUrl = ctx.source?.bookSourceUrl ?? ctx.baseUrl ?? ''
  let url = baseUrl ? toAbsoluteUrl(urlPart.trim(), baseUrl) : urlPart.trim()

  // 选项块 js 重写 URL
  if (option.js) {
    const v = await evalJs(String(option.js), { ...varsOf(ctx), result: url })
    if (v) url = v
  }

  const method = String(option.method ?? 'GET').toUpperCase() as BuiltUrl['method']
  const headers: Record<string, string> = { ...(ctx.source?.headerMap ?? {}) }
  if (option.headers && typeof option.headers === 'object') {
    for (const [k, v] of Object.entries(option.headers)) headers[k] = String(v)
  }
  let body: string | undefined
  if (method === 'POST') {
    body = option.body !== undefined ? String(option.body) : undefined
    const isJson = body?.trimStart().startsWith('{') || body?.trimStart().startsWith('[')
    if (body && !isJson && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    } else if (isJson && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json'
    }
  }

  return {
    url,
    method,
    headers,
    body,
    charset: option.charset ? String(option.charset) : undefined,
    retry: Number(option.retry ?? 0),
    ...buildTypePayload(option.type, url)
  }
}

/**
 * URL 带 type 选项（对齐 legado getStrResponseAwait 的 type 分支）：
 * 响应体 = 原始字节的 hex 编码。data: URL（聚合搜索参数载体）直接本地解码。
 */
function buildTypePayload(type: unknown, url: string): { hexBody?: boolean; dataBody?: string } {
  if (type === undefined || type === null || type === '') return {}
  const dataMatch = /^data:;?base64,(.*)$/i.exec(url)
  if (dataMatch) {
    const payload = Buffer.from(dataMatch[1], 'base64').toString('utf-8')
    return { dataBody: Buffer.from(payload, 'utf-8').toString('hex') }
  }
  return { hexBody: true }
}

function varsOf(ctx: AnalyzeUrlCtx): Record<string, unknown> {
  return {
    key: ctx.key,
    page: ctx.page,
    baseUrl: ctx.baseUrl ?? ctx.source?.bookSourceUrl ?? '',
    ...(ctx.vars ?? {})
  }
}
