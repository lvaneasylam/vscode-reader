/**
 * 书源 JS 的 java.* 扩展（JsExtensions 常用子集）。
 * 网络方法为 async（由 js-runtime 自动注入 await），其余纯同步。
 */
import { createHash } from 'node:crypto'
import { analyzeUrl } from '../analyze-url.js'
import { requestText, LEGADO_DEFAULT_HEADERS } from '../http.js'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Cookie 存取（登录 JS 的 java.setCookie/getCookie 与 cookie.put/get 走此接口） */
export interface CookieStore {
  set(url: string, cookie: string): void
  get(url: string): string | undefined
}

export interface JavaExtensions {
  ajax(url: string, headers?: Record<string, string>): Promise<string>
  /** 双参 = HTTP GET(url, headers)；单参 = CacheManager 缓存读（legado 重载语义） */
  get(url: string, headers?: Record<string, string>): Promise<string>
  post(url: string, body: string, headers?: Record<string, string>): Promise<string>
  /** CacheManager 写（书源 java.put('book_id',…) 跨规则传值） */
  put(key: string, value: string): string
  base64Encode(s: string): string
  base64Decode(s: string): string
  md5Encode(s: string): string
  md5Encode16(s: string): string
  encodeUri(s: string): string
  decodeUri(s: string): string
  hexDecodeToString(hex: string): string
  hexEncodeToString(utf8: string): string
  strToBase64(s: string): string
  base64ToStr(s: string): string
  setCookie(url: string, cookie: string): void
  getCookie(url: string): string
  /** 设备指纹（书源 java.androidId()；聚合服务用它注册游客设备，获取番茄等源的游客凭证） */
  androidId(): string
  toast(msg: string): void
  longToast(msg: string): void
  /** 打开浏览器页（移动端 WebView；桌面端经 openExternal 回调用系统浏览器） */
  startBrowserAwait(url: string, title?: string): Promise<string>
  /** 登录 UI 动态更新（移动端回调；桌面端无 UI 重建，安全空实现） */
  upLoginData(_data: unknown): void
  reLoginView(_deltaUp?: boolean): void
  upUiData(_data: unknown): void
  random(min: number, max: number): number
  timeFormat(t: number): string
  log(msg: unknown): void
}

export function createJavaExtensions(opts: {
  fetchFn?: FetchLike
  log?: (msg: string) => void
  cookies?: CookieStore
  /** 书源 KV 缓存（java.put/get 单参形态，跨规则传值如 book_id） */
  cache?: { put(key: string, value: string): void; get(key: string): string | undefined }
  /** 源变量（java.androidId 持久化设备指纹用） */
  variables?: { get(key: string): string | undefined; set(key: string, value: string): void }
  /** URL 内 {{...}} 求值通道（js-runtime 注入，携带外层 ctx 变量） */
  evalJs?: (code: string) => Promise<string | null>
  /** 弹窗提示桥（桌面端接 IDE 通知） */
  toast?: (msg: string, long?: boolean) => void
  /** 系统浏览器打开桥 */
  openExternal?: (url: string) => void
} = {}): JavaExtensions {
  const doFetch = opts.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i))

  /**
   * legado 的 java.ajax/get/post 支持"url,{...option}"复合参数与对象参数
   * （method/headers/body/charset），统一走 AnalyzeUrl 管线（POST/选项块/超时/重试）。
   */
  async function requestUrl(
    urlOrOption: unknown,
    overrides: { method?: string; body?: string; headers?: Record<string, string> } = {}
  ): Promise<string> {
    let u: string
    if (typeof urlOrOption === 'object' && urlOrOption !== null) {
      // 对象参数：拆出 url，其余字段作为选项块
      const { url, ...rest } = urlOrOption as Record<string, unknown>
      u = `${String(url)},${JSON.stringify(rest)}`
    } else {
      u = String(urlOrOption)
    }
    const evalJs = opts.evalJs ?? (async () => null)
    const built = await analyzeUrl(u, {}, async code => evalJs(code))
    if (overrides.method) built.method = overrides.method.toUpperCase() as typeof built.method
    if (overrides.body !== undefined) built.body = overrides.body
    if (overrides.headers) built.headers = { ...built.headers, ...overrides.headers }
    try {
      const res = await requestText(built, { fetchFn: doFetch })
      return res.body
    } catch (e) {
      // 书源 jsLib 常吞掉网络错误只留空串（排障困难），经 log 桥留痕
      opts.log?.(`[ajax失败] ${String(u).slice(0, 120)}: ${(e as Error).message.slice(0, 160)}`)
      throw e
    }
  }

  async function getString(url: string, headers?: Record<string, string>): Promise<string> {
    return requestUrl(url, { headers })
  }

  return {
    async ajax(url, headers) {
      return getString(url, headers)
    },
    async get(url, headers) {
      // 单参且非 URL 形态 = CacheManager 读（legado 重载语义；URL 形态与双参仍走 HTTP）
      if (headers === undefined && !/^(https?|data):/i.test(url.trim())) {
        return opts.cache?.get(url) ?? ''
      }
      return getString(url, headers)
    },
    put(key, value) {
      opts.cache?.put(key, value)
      return value
    },
    async post(url, body, headers = {}) {
      const isJson = body.trimStart().startsWith('{') || body.trimStart().startsWith('[')
      return requestUrl(url, {
        method: 'POST',
        body,
        headers: {
          'Content-Type': isJson ? 'application/json' : 'application/x-www-form-urlencoded',
          ...headers
        }
      })
    },
    base64Encode(s) {
      return Buffer.from(s, 'utf-8').toString('base64')
    },
    base64Decode(s) {
      return Buffer.from(s, 'base64').toString('utf-8')
    },
    md5Encode(s) {
      return createHash('md5').update(s, 'utf-8').digest('hex')
    },
    md5Encode16(s) {
      return createHash('md5').update(s, 'utf-8').digest('hex').slice(8, 24)
    },
    encodeUri(s) {
      return encodeURIComponent(s)
    },
    decodeUri(s) {
      return decodeURIComponent(s)
    },
    hexDecodeToString(hex) {
      return Buffer.from(hex, 'hex').toString('utf-8')
    },
    hexEncodeToString(utf8) {
      return Buffer.from(utf8, 'utf-8').toString('hex')
    },
    setCookie(url, cookie) {
      opts.cookies?.set(url, cookie)
    },
    getCookie(url) {
      return opts.cookies?.get(url) ?? ''
    },
    androidId() {
      // 稳定设备指纹：书源 request() 用它拼 cookie deviceId=...，
      // 聚合服务器据此注册游客设备（获取番茄等下游源的游客凭证）
      const cached = opts.variables?.get('__androidId__')
      if (cached) return cached
      const id = Array.from({ length: 18 }, () =>
        'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]
      ).join('')
      opts.variables?.set('__androidId__', id)
      return id
    },
    toast(msg) {
      ;(opts.toast ?? ((m: string) => console.log(m)))(String(msg), false)
    },
    longToast(msg) {
      ;(opts.toast ?? ((m: string) => console.log(m)))(String(msg), true)
    },
    async startBrowserAwait(url, _title) {
      if (opts.openExternal) opts.openExternal(url)
      return ''
    },
    upLoginData() {},
    reLoginView() {},
    upUiData() {},
    strToBase64(s) {
      return Buffer.from(s, 'utf-8').toString('base64')
    },
    base64ToStr(s) {
      return Buffer.from(s, 'base64').toString('utf-8')
    },
    random(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min
    },
    timeFormat(t) {
      const d = new Date(t)
      const p = (n: number) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    },
    log(msg) {
      ;(opts.log ?? console.log)(typeof msg === 'string' ? msg : JSON.stringify(msg))
    }
  }
}
