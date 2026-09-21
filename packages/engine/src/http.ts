/**
 * HTTP 请求层：fetch 封装（超时/重试/charset 解码/简易 Cookie Jar）。
 *
 * 网络兼容性对齐 legado（AppConfig/SSLHelper/Cronet 行为）：
 * - 默认请求头 = legado 默认 UA（Windows 桌面 Chrome）+ 浏览器 Accept 系列头，
 *   避免站点 WAF 的请求头过滤
 * - TLS 默认放宽（信任所有证书 + 允许 TLSv1），对齐 legado unsafeTrustManager，
 *   否则大量自签/老旧证书的小说站无法访问
 * - fetchFn 可注入，便于测试与宿主替换
 */
import { fetch as undiciFetch, Agent, type Dispatcher } from 'undici'
import type { BuiltUrl } from './analyze-url.js'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface HttpResponse {
  body: string
  url: string
  status: number
}

export interface HttpOptions {
  fetchFn?: FetchLike
  timeoutMs?: number
  /** 简易 cookie 存储（host -> cookie 串）；传入即启用读写 */
  cookieJar?: Map<string, string>
}

/** legado 默认 UA（AppConfig.getPrefUserAgent 的回退值，Chrome 主版本跟随大版本） */
export const LEGADO_DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 默认请求头（优先级最低，书源 header / 选项块 headers 覆盖之） */
export const LEGADO_DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': LEGADO_DEFAULT_UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
}

/**
 * 默认 HTTP 客户端：undici fetch + 共享连接池。
 * insecureTLS（默认 true）对齐 legado unsafeTrustManager：信任所有证书并允许 TLSv1。
 * 注意：不可用 "DEFAULT@SECLEVEL=0" 这类 Debian 专有 ciphers 语法——
 * VSCode 扩展宿主（Electron 内置 OpenSSL）不识别，握手期直接 INVALID_COMMAND 全挂。
 */
export function createDefaultFetch(opts: { insecureTLS?: boolean } = {}): FetchLike {
  const insecure = opts.insecureTLS !== false
  let agent: Agent
  try {
    agent = new Agent({
      connect: insecure ? { rejectUnauthorized: false, minVersion: 'TLSv1' } : undefined
    })
  } catch {
    // 极端环境（minVersion 也不支持）：退化为仅忽略证书校验
    agent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return ((url: string, init?: RequestInit) =>
    undiciFetch(url, { ...init, dispatcher: agent as Dispatcher } as never)) as FetchLike
}

export async function requestText(built: BuiltUrl, opts: HttpOptions = {}): Promise<HttpResponse> {
  // data: URL 直通（聚合搜索源参数载荷，无网络请求）
  if (built.dataBody !== undefined) {
    return { body: built.dataBody, url: built.url, status: 200 }
  }
  const doFetch = opts.fetchFn ?? createDefaultFetch()
  const timeoutMs = opts.timeoutMs ?? 15000
  const attempts = Math.max(1, built.retry + 1)

  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await doRequest(built, doFetch, timeoutMs, opts)
    } catch (e) {
      lastErr = e
      // 书源 jsLib 常把网络错误吞掉只留空串（难排查），此处留诊断痕迹
      console.warn(`[book-source-engine] 请求失败 ${built.url.slice(0, 120)}: ${describeErrorChain(e)}`)
    }
  }
  throw new Error(`请求失败 ${built.url}: ${describeErrorChain(lastErr)}`)
}

async function doRequest(
  built: BuiltUrl,
  doFetch: FetchLike,
  timeoutMs: number,
  opts: HttpOptions
): Promise<HttpResponse> {
  const headers: Record<string, string> = { ...LEGADO_DEFAULT_HEADERS, ...built.headers }
  const url = built.url
  if (!headers.Referer && !headers.referer) {
    try {
      headers.Referer = new URL(url).origin + '/'
    } catch {
      /* 非标准 URL 不加 Referer */
    }
  }
  if (opts.cookieJar) {
    const host = safeHost(url)
    const cookie = host ? opts.cookieJar.get(host) : undefined
    if (cookie && !headers.Cookie) headers.Cookie = cookie
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await doFetch(url, {
      method: built.method,
      headers,
      body: built.body,
      signal: controller.signal
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs}ms） ${url}`)
    }
    throw e
  }
  clearTimeout(timer)

  if (opts.cookieJar) {
    const host = safeHost(url)
    const setCookies =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? []
    if (host && setCookies.length > 0) {
      const prev = parseCookie(opts.cookieJar.get(host) ?? '')
      for (const sc of setCookies) {
        const [pair] = sc.split(';')
        const eq = pair.indexOf('=')
        if (eq > 0) prev.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
      }
      opts.cookieJar.set(host, serializeCookie(prev))
    }
  }

  const buf = await res.arrayBuffer()
  // 带 type 选项的 URL：响应体为原始字节 hex（对齐 legado AnalyzeUrl type 分支）
  if (built.hexBody) {
    return { body: Buffer.from(buf).toString('hex'), url: (res.url as string) || url, status: res.status }
  }
  let body: string
  try {
    body = new TextDecoder(built.charset ?? 'utf-8').decode(buf)
  } catch {
    body = new TextDecoder('utf-8').decode(buf)
  }
  return { body, url: (res.url as string) || url, status: res.status }
}

/** 展开错误 cause 链，暴露 fetch failed 背后的真实原因（证书/DNS/连接） */
export function describeErrorChain(e: unknown): string {
  const msgs: string[] = []
  let cur: unknown = e
  let depth = 0
  while (cur instanceof Error && depth < 5) {
    const code = (cur as Error & { code?: string }).code
    const part = code ? `${cur.message} [${code}]` : cur.message
    if (part && !msgs.includes(part)) msgs.push(part)
    cur = (cur as Error & { cause?: unknown }).cause
    depth++
  }
  return msgs.length > 0 ? msgs.join(' ← ') : String(e)
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function parseCookie(s: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const pair of s.split(';')) {
    const eq = pair.indexOf('=')
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }
  return map
}

function serializeCookie(map: Map<string, string>): string {
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
}
