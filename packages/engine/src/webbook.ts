/**
 * 四步阅读流程。对齐 legado model/webBook：
 * searchBooks → getBookInfo → getChapterList → getContent
 * 含目录/正文分页（nextTocUrl/nextContentUrl）、bookUrlPattern 详情页分支、正文净化。
 */
import type { AnyNode } from 'domhandler'
import { analyzeUrl } from './analyze-url.js'
import { requestText, createDefaultFetch, type FetchLike } from './http.js'
import { AnalyzeRule } from './rule/analyze-rule.js'
import { evalJsAsync } from './js/js-runtime.js'
import { formatContent } from './html-formatter.js'
import { splitPurify, applyPurify } from './rule/rule-analyzer.js'
import type { BookSource, SearchBook, BookChapter } from './types.js'

export class ContentEmptyError extends Error {
  constructor() {
    super('章节内容为空')
    this.name = 'ContentEmptyError'
  }
}

export interface BookInfoResult {
  name?: string
  author?: string
  intro?: string
  tocUrl: string
}

export interface WebBookOptions {
  fetchFn?: FetchLike
  timeoutMs?: number
  /** 默认 true：信任所有证书并允许 TLSv1（对齐 legado unsafeTrustManager） */
  insecureTLS?: boolean
  /** 弹窗提示桥（java.toast/longToast → IDE 通知） */
  toast?: (msg: string, long?: boolean) => void
  /** 诊断日志桥（java.log / 引擎告警 → IDE 输出面板） */
  log?: (msg: string) => void
  /** 系统浏览器打开桥（java.startBrowserAwait） */
  openExternal?: (url: string) => void
  /** 共享 cookie jar（登录态跨实例/跨会话复用；缺省每实例私有） */
  cookieJar?: Map<string, string>
  /** 共享源变量（getVariable/setVariable；缺省每实例私有） */
  sourceVariables?: Map<string, string>
}

/** 分页防死循环上限 */
const MAX_PAGES = 50

/**
 * 解析书源 exploreUrl 为分类列表：
 * - JSON 对象字符串（legado 标准）：{"男生":"/all?...", "女生":"/all?..."}
 * - 行式「名称::URL」多段
 * - 单值退化为单一「发现」分类
 */
export function parseExploreEntries(exploreUrl: string | undefined): Array<{ name: string; url: string }> {
  if (!exploreUrl?.trim()) return []
  const t = exploreUrl.trim()
  try {
    const obj: unknown = JSON.parse(t)
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return Object.entries(obj as Record<string, unknown>)
        .filter(([, v]) => typeof v === 'string' && v.trim())
        .map(([name, url]) => ({ name, url: String(url).trim() }))
    }
  } catch {
    /* 非 JSON 继续尝试其他形态 */
  }
  if (t.includes('::')) {
    return t
      .split('\n')
      .map(line => line.split('::'))
      .filter(parts => parts.length >= 2 && parts[0].trim() && parts[1].trim())
      .map(parts => ({ name: parts[0].trim(), url: parts[1].trim() }))
  }
  return [{ name: '发现', url: t }]
}

/** 源变量中的登录表单数据键（getLoginInfoMap 读取） */
const LOGIN_INFO_KEY = '__loginInfo__'

export class WebBook {
  private readonly fetchFn: FetchLike
  private readonly timeoutMs?: number
  private readonly cookieJar: Map<string, string>
  /** 书源源变量（getVariable/setVariable；当前会话内存态） */
  private readonly sourceVariables: Map<string, string>

  constructor(
    private readonly source: BookSource,
    options: WebBookOptions = {}
  ) {
    // 未注入 fetchFn 时使用默认客户端（legado 默认头 + 宽松 TLS），供请求与 {{}} JS 的 java.ajax 共用
    this.fetchFn = options.fetchFn ?? createDefaultFetch({ insecureTLS: options.insecureTLS })
    this.timeoutMs = options.timeoutMs
    this.toastBridge = options.toast
    this.openExternalBridge = options.openExternal
    this.logBridge = options.log
    // 注入即共享（登录态/线路等跨实例保持），缺省实例私有
    this.cookieJar = options.cookieJar ?? new Map()
    this.sourceVariables = options.sourceVariables ?? new Map()
  }

  private readonly toastBridge?: (msg: string, long?: boolean) => void
  private readonly openExternalBridge?: (url: string) => void
  private readonly logBridge?: (msg: string) => void
  /** 书源 KV 缓存（java.put/get，实例级跨规则传值） */
  private readonly cacheStore = new Map<string, string>()
  /** 书本变量（book.getVariable/setVariable，实例级） */
  private readonly bookVariables = new Map<string, string>()
  /** 章节变量 + 当前章节（chapter.getVariable 等，ruleContent JS 常用 chapter.url/title） */
  private readonly chapterVariables = new Map<string, string>()
  private currentChapter: { url: string; title: string; index: number } = { url: '', title: '', index: 0 }

  /** 1. 搜索 */
  async searchBooks(key: string, page = 1): Promise<SearchBook[]> {
    const searchUrl = this.source.searchUrl
    if (!searchUrl) throw new Error(`书源 ${this.source.bookSourceName} 未配置 searchUrl`)
    try {
      return await this.searchBooksInner(key, page)
    } catch (e) {
      // 书源 JS 对空响应 JSON.parse 的典型报错（服务器不可用/线路全挂）
      if (e instanceof SyntaxError && /Unexpected (end of JSON|token)/.test(e.message)) {
        throw new Error(
          `书源返回空数据（服务器可能不可用，可在登录菜单切换线路后重试，或等待服务恢复）[原始错误: ${e.message.slice(0, 80)}]`
        )
      }
      throw e
    }
  }

  /**
   * 0. 发现页分类列表（exploreUrl 三形态统一入口）：
   * - `<js>...</js>` 动态生成：沙盒执行（含 jsLib prelude，可发网络请求拉取服务器分类）
   * - JSON 对象字符串：{"分类名": "URL"}
   * - 行式「名称::URL」/ 单值退化
   */
  async getExploreEntries(): Promise<Array<{ name: string; url: string }>> {
    const raw = this.source.exploreUrl?.trim()
    if (!raw) return []
    // <js> 形态：沙盒执行，返回 JSON 数组 [{name, url}] 或对象 {name: url}
    const jsMatch = /^<js>([\s\S]*?)<\/js>$/.exec(raw)
    if (jsMatch) {
      const out = await this.evalJs(jsMatch[1], {})
      if (!out) return []
      try {
        const parsed: unknown = JSON.parse(out)
        if (Array.isArray(parsed)) {
          // legado 标准：{title, url}（部分源用 name）；无 url 的条目是设置项，跳过
          return parsed
            .map((e): { name: string; url: string } | null => {
              if (typeof e !== 'object' || e === null) return null
              const rec = e as Record<string, unknown>
              const name = typeof rec.title === 'string' ? rec.title : typeof rec.name === 'string' ? rec.name : null
              const url = typeof rec.url === 'string' ? rec.url : null
              if (!name || !url || !url.trim()) return null
              return { name, url: url.trim() }
            })
            .filter((e): e is { name: string; url: string } => e !== null)
        }
        if (parsed && typeof parsed === 'object') {
          return Object.entries(parsed as Record<string, unknown>)
            .filter(([, v]) => typeof v === 'string' && v.trim())
            .map(([name, url]) => ({ name, url: String(url).trim() }))
        }
      } catch {
        /* JS 返回非法 JSON：按文本退化 */
      }
      return [{ name: '发现', url: out.trim() }]
    }
    return parseExploreEntries(raw)
  }

  private async searchBooksInner(key: string, page: number): Promise<SearchBook[]> {
    const res = await this.fetch(this.source.searchUrl!, { key, page })
    return this.listBooks(res.body, res.url, this.source.ruleSearch ?? {}, { key, page })
  }

  /**
   * 发现页（legado exploreUrl + ruleExplore）：按分类 URL 规则取书。
   * exploreUrlRule 来自 parseExploreEntries 解析结果。
   */
  async exploreBooks(exploreUrlRule: string, page = 1): Promise<SearchBook[]> {
    const res = await this.fetch(exploreUrlRule, { page })
    return this.listBooks(res.body, res.url, this.source.ruleExplore ?? {}, { page })
  }

  /** 列表页通用解析（搜索/发现共用；ruleDef 为 ruleSearch/ruleExplore 形态） */
  private async listBooks(
    body: string,
    url: string,
    ruleDef: NonNullable<BookSource['ruleSearch']>,
    vars: Record<string, unknown>
  ): Promise<SearchBook[]> {
    const rule = this.newRule(body, url, vars)

    // 详情页正则命中：结果按详情页解析（对齐 BookList.getInfoItem 分支）
    const pattern = this.source.bookUrlPattern
    if (pattern) {
      try {
        if (new RegExp(pattern).test(url)) {
          return this.searchAsInfoPage(rule, url)
        }
      } catch {
        /* 非法正则忽略 */
      }
    }

    let bookListRule = ruleDef.bookList ?? ''
    let reverse = false
    if (bookListRule.startsWith('-')) {
      reverse = true
      bookListRule = bookListRule.slice(1)
    }
    if (bookListRule.startsWith('+')) bookListRule = bookListRule.slice(1)

    const elements = (await rule.getElements(bookListRule)) as AnyNode[]
    if (elements.length === 0 && !pattern) {
      return this.searchAsInfoPage(rule, url)
    }

    const books: SearchBook[] = []
    const seen = new Set<string>()
    for (const el of elements) {
      rule.setContentItem(el)
      const name = clean(await rule.getString(ruleDef.name ?? ''))
      if (!name) continue
      let bookUrl = (await rule.getString(ruleDef.bookUrl ?? '', { isUrl: true })) ?? ''
      if (!bookUrl) bookUrl = url
      if (seen.has(bookUrl)) continue
      seen.add(bookUrl)
      books.push({
        name,
        author: clean(await rule.getString(ruleDef.author ?? '')) || '佚名',
        bookUrl,
        intro: clean(await rule.getString(ruleDef.intro ?? '')),
        kind: clean(await rule.getString(ruleDef.kind ?? '')),
        lastChapter: clean(await rule.getString(ruleDef.lastChapter ?? '')),
        coverUrl: (await rule.getString(ruleDef.coverUrl ?? '', { isUrl: true })) ?? '',
        origin: this.source.bookSourceUrl,
        originName: this.source.bookSourceName
      })
    }
    if (reverse) books.reverse()
    return books
  }

  /** 2. 详情：提取 tocUrl 等 */
  async getBookInfo(bookUrl: string, vars: Record<string, unknown> = {}): Promise<BookInfoResult> {
    const res = await this.fetch(bookUrl, { vars })
    const rule = this.newRule(res.body, res.url, vars)
    const r = this.source.ruleBookInfo ?? {}
    // init 规则（对齐 BookInfo.analyzeBookInfo）：返回值作为后续规则的数据源
    if (r.init?.trim()) {
      const initData = (await rule.getElements(r.init))[0]
      if (initData !== undefined) rule.setContentItem(initData)
    }
    const name = clean(await rule.getString(r.name ?? ''))
    if (!name && !r.tocUrl) {
      // 无详情规则：目录页即详情页
      return { tocUrl: res.url }
    }
    let tocUrl = (await rule.getString(r.tocUrl ?? '', { isUrl: true })) ?? ''
    if (!tocUrl) tocUrl = res.url
    return {
      name: name || undefined,
      author: clean(await rule.getString(r.author ?? '')) || undefined,
      intro: clean(await rule.getString(r.intro ?? '')) || undefined,
      tocUrl
    }
  }

  /** 3. 目录（含 nextTocUrl 分页） */
  async getChapterList(tocUrl: string, vars: Record<string, unknown> = {}): Promise<BookChapter[]> {
    const r = this.source.ruleToc ?? {}
    if (!r.chapterList) throw new Error(`书源 ${this.source.bookSourceName} 未配置 ruleToc.chapterList`)
    const chapters: BookChapter[] = []
    const visited = new Set<string>()
    let url: string = tocUrl
    let index = 0

    while (url && !visited.has(url) && visited.size < MAX_PAGES) {
      visited.add(url)
      const res = await this.fetch(url, { vars })
      const rule = this.newRule(res.body, res.url, vars)
      const elements = (await rule.getElements(r.chapterList)) as AnyNode[]
      for (const el of elements) {
        rule.setContentItem(el)
        const title = clean(await rule.getString(r.chapterName ?? ''))
        let chapterUrl = (await rule.getString(r.chapterUrl ?? '', { isUrl: true })) ?? ''
        if (!chapterUrl) chapterUrl = res.url
        if (!title && !chapterUrl) continue
        const isVolume = truthy(await rule.getString(r.isVolume ?? ''))
        chapters.push({
          title: title || `第${index + 1}节`,
          url: chapterUrl,
          index: index++,
          isVolume,
          isVip: truthy(await rule.getString(r.isVip ?? ''))
        })
      }
      // 分页 URL 必须在原始 body 上提取（rule 已被逐项解析覆盖）
      const pageRule = this.newRule(res.body, res.url, vars)
      const next = (await pageRule.getString(r.nextTocUrl ?? '', { isUrl: true })) ?? ''
      url = next && next !== res.url ? next : ''
    }
    return chapters
  }

  /** 4. 正文（含 nextContentUrl 分页与净化） */
  async getContent(
    chapterUrl: string,
    opts: { nextChapterUrl?: string; vars?: Record<string, unknown> } = {}
  ): Promise<string> {
    const r = this.source.ruleContent ?? {}
    if (!r.content) throw new Error(`书源 ${this.source.bookSourceName} 未配置 ruleContent.content`)
    const parts: string[] = []
    const visited = new Set<string>()

    let url = chapterUrl
    this.currentChapter = { url: chapterUrl, title: '', index: 0 }
    while (url && !visited.has(url) && visited.size < MAX_PAGES) {
      visited.add(url)
      const res = await this.fetch(url, { vars: opts.vars })
      const rule = this.newRule(res.body, res.url, opts.vars ?? {})
      const raw = await rule.getString(r.content)
      if (raw) parts.push(formatContent(raw))
      if (opts.nextChapterUrl) {
        const absNext = toAbs(opts.nextChapterUrl, res.url)
        const absCur = toAbs(url, res.url)
        if (absNext && absCur && absNext === absCur) break
      }
      let next = (await rule.getStringList(r.nextContentUrl ?? ''))[0] ?? ''
      if (next) next = toAbs(next, res.url)
      url = next
    }

    let content = parts.join('\n')
    if (r.replaceRegex) {
      content = applyPurify(content, splitPurify(`##${r.replaceRegex.replace(/^##/, '')}`))
    }
    if (!content.trim()) throw new ContentEmptyError()
    return content
  }

  // ---------- 内部 ----------

  private async searchAsInfoPage(rule: AnalyzeRule, pageUrl: string): Promise<SearchBook[]> {
    const info = await this.getBookInfo(pageUrl)
    return [
      {
        name: info.name ?? this.source.bookSourceName,
        author: info.author ?? '佚名',
        bookUrl: pageUrl,
        intro: info.intro,
        origin: this.source.bookSourceUrl,
        originName: this.source.bookSourceName
      }
    ]
  }

  private newRule(body: string, baseUrl: string, vars: Record<string, unknown> = {}): AnalyzeRule {
    return new AnalyzeRule(this.evalJs, { baseUrl, ...vars }).setContent(body, baseUrl)
  }

  private evalJs = (code: string, ctx: Record<string, unknown>) =>
    evalJsAsync(
      code,
      {
        baseUrl: this.source.bookSourceUrl,
        // legado 注入的书源对象（书源 JS 常用 source.getVariable/source.loginUi 等）
        source: this.sourceBinding(),
        // 书本绑定（规则 JS 读 book.durChapterIndex 断点续读；桌面端无 Book 对象，给最小形态）。
        // Proxy 兜底：legado Book 的方法长尾（setUseReplaceRule 等 setter 类）no-op，避免炸链路
        book: new Proxy(
          {
            durChapterIndex: 0,
            durChapterTitle: '',
            durChapterPos: 0,
            getVariable: (key?: string) =>
              key === undefined || key === ''
                ? JSON.stringify(Object.fromEntries([...this.bookVariables.entries()]))
                : parseVariableValue(this.bookVariables.get(key)),
            setVariable: (key: string, value: unknown) =>
              void this.bookVariables.set(key, typeof value === 'string' ? value : JSON.stringify(value))
          },
          {
            get(target, prop) {
              if (typeof prop === 'symbol') return undefined
              if (prop in target) return (target as Record<string | symbol, unknown>)[prop]
              return () => undefined
            }
          }
        ),
        // CacheManager 绑定（规则 JS 的 cache.putMemory/getMemory）
        cache: {
          putMemory: (key: string, value: string) => void this.cacheStore.set(key, value),
          getMemory: (key: string) => this.cacheStore.get(key) ?? ''
        },
        // 章节绑定（ruleContent JS 常用 chapter.url/title；方法长尾同 book 一样 no-op 兜底）
        chapter: new Proxy(
          {
            ...this.currentChapter,
            getVariable: (key?: string) =>
              key === undefined || key === ''
                ? JSON.stringify(Object.fromEntries([...this.chapterVariables.entries()]))
                : parseVariableValue(this.chapterVariables.get(key)),
            setVariable: (key: string, value: unknown) =>
              void this.chapterVariables.set(key, typeof value === 'string' ? value : JSON.stringify(value))
          },
          {
            get(target, prop) {
              if (typeof prop === 'symbol') return undefined
              if (prop in target) return (target as Record<string | symbol, unknown>)[prop]
              return () => undefined
            }
          }
        ),
        ...ctx
      },
      {
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        toast: this.toastBridge,
        log: (msg: string) => this.logBridge?.(msg),
        openExternal: this.openExternalBridge,
        cache: {
          put: (k, v) => void this.cacheStore.set(k, v),
          get: k => this.cacheStore.get(k)
        },
        prelude: this.source.jsLib ?? undefined,
        variables: {
          get: key => this.sourceVariables.get(key),
          set: (key, value) => void this.sourceVariables.set(key, value),
          keys: () => [...this.sourceVariables.keys()]
        },
        cookies: {
          set: (url, cookie) => void this.cookieJar.set(hostOf(url), cookie),
          get: url => this.cookieJar.get(hostOf(url))
        }
      }
    )

  /** 执行书源 JS（登录 UI 动态生成等场景），带 jsLib/源变量/cookie 上下文 */
  runJs(code: string, ctx: Record<string, unknown> = {}): Promise<string | null> {
    return this.evalJs(code, ctx)
  }

  /** 书源对象在沙盒中的可见形态（属性 + 变量/登录信息存取） */
  private sourceBinding(): Record<string, unknown> {
    return {
      bookSourceUrl: this.source.bookSourceUrl,
      bookSourceName: this.source.bookSourceName,
      bookSourceGroup: this.source.bookSourceGroup ?? '',
      bookSourceType: this.source.bookSourceType ?? 0,
      enabled: this.source.enabled !== false,
      loginUrl: this.source.loginUrl ?? '',
      loginUi: this.source.loginUi ?? '',
      jsLib: this.source.jsLib ?? '',
      getKey: () => this.source.bookSourceUrl,
      getTag: () => this.source.bookSourceName,
      getVariable: (key?: string) =>
        key === undefined || key === ''
          ? JSON.stringify(Object.fromEntries([...this.sourceVariables.entries()]))
          : parseVariableValue(this.sourceVariables.get(key)),
      setVariable: (key: string, value: unknown) =>
        void this.sourceVariables.set(key, typeof value === 'string' ? value : JSON.stringify(value)),
      getLoginInfo: () => this.sourceVariables.get(LOGIN_INFO_KEY) ?? '',
      getLoginInfoMap: () => {
        try {
          return JSON.parse(this.sourceVariables.get(LOGIN_INFO_KEY) ?? '{}') as Record<string, string>
        } catch {
          return {}
        }
      },
      putLoginInfo: (info: string) => void this.sourceVariables.set(LOGIN_INFO_KEY, info),
      putLoginInfoMap: (map: Record<string, string>) =>
        void this.sourceVariables.set(LOGIN_INFO_KEY, JSON.stringify(map)),
      removeLoginInfo: () => void this.sourceVariables.delete(LOGIN_INFO_KEY),
      setLoginInfo: (json: string) => void this.sourceVariables.set(LOGIN_INFO_KEY, json)
    }
  }

  /**
   * loginUi 按钮动作（对齐 SourceLoginDialog.handleButtonClick）：
   * 执行 loginUrl 代码库 + 按钮 action JS，表单数据经 result 传入。
   */
  async runButtonAction(action: string, data: Record<string, string>): Promise<string | null> {
    const loginJs = this.source.loginUrl
    if (!loginJs) throw new Error(`书源 ${this.source.bookSourceName} 未配置 loginUrl`)
    return this.evalJs(`${loginJs}\n;${action}`, { result: data })
  }

  /**
   * loginUi 表单登录（对齐 legado SourceLoginDialog.login）：
   * 执行 loginUrl 定义的 login() 函数，表单数据经 result 变量传入，
   * JS 内 java.setCookie 写入的登录态直接进入本源请求的 cookieJar。
   * 返回 login() 的返回值（书源常用返回值/异常表达成败；自行 catch 时返回空）。
   */
  async runLogin(data: Record<string, string>): Promise<string | null> {
    const loginJs = this.source.loginUrl
    if (!loginJs) throw new Error(`书源 ${this.source.bookSourceName} 未配置 loginUrl`)
    void this.sourceVariables.set(LOGIN_INFO_KEY, JSON.stringify(data))
    const invoke = `if (typeof login=='function'){ return login.apply(this); } else { throw('Function login not implements!!!') }`
    return this.evalJs(`${loginJs}\n;${invoke}`, { result: data })
  }

  private async fetch(
    urlRule: string,
    ctx: { key?: string; page?: number; vars?: Record<string, unknown> }
  ): Promise<{ body: string; url: string }> {
    const built = await analyzeUrl(
      urlRule,
      {
        key: ctx.key,
        page: ctx.page,
        source: this.source,
        vars: { ...(ctx.vars ?? {}), key: ctx.key, page: ctx.page }
      },
      this.evalJs
    )
    return requestText(built, {
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      cookieJar: this.source.enabledCookieJar === false ? undefined : this.cookieJar
    })
  }
}

function clean(s: string | null): string {
  return (s ?? '').trim()
}

function truthy(s: string | null): boolean {
  const v = (s ?? '').trim().toLowerCase()
  return v !== '' && v !== '0' && v !== 'false'
}

function toAbs(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** JSON 字符串自动解析（与 js-runtime 的 getVariable 宽松语义一致） */
function parseVariableValue(v: string | undefined): string | unknown {
  if (v === undefined || v === '') return ''
  const t = v.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      return v
    }
  }
  return v
}
