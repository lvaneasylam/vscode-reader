import * as vscode from 'vscode'
import {
  WebBook,
  ContentEmptyError,
  describeErrorChain,
  type BookSource,
  type ShelfBook,
  type BookChapter
} from 'book-source-engine'
import { createWebBook } from './webbook-factory.js'

export interface ReaderState {
  book: ShelfBook | null
  chapters: BookChapter[]
  chapterIndex: number
  /** 当前章节正文（已净化，段落以 \n 分隔） */
  content: string
  lines: string[]
  lineIndex: number
  /** 状态栏模式：当前行内的段偏移（长行按显示宽度切段后的段号；面板模式恒 0） */
  segIndex: number
  loading: boolean
  error: string | null
}

const EMPTY_STATE: ReaderState = {
  book: null,
  chapters: [],
  chapterIndex: -1,
  content: '',
  lines: [],
  lineIndex: 0,
  segIndex: 0,
  loading: false,
  error: null
}

/** 阅读核心状态机：书/章节/正文缓存 + 翻章翻行，UI（面板/状态栏）订阅刷新 */
export class ReaderController implements vscode.Disposable {
  private state: ReaderState = { ...EMPTY_STATE }
  private readonly emitter = new vscode.EventEmitter<void>()
  private readonly webbooks = new Map<string, WebBook>()
  /** 章节正文 LRU 缓存：chapterUrl → content */
  private readonly contentCache = new Map<string, string>()
  private static readonly CACHE_LIMIT = 20

  /** 章节缓存上限（novelReader.contentCacheSize，可配） */
  private cacheLimit(): number {
    return vscode.workspace.getConfiguration('novelReader').get<number>('contentCacheSize') ?? ReaderController.CACHE_LIMIT
  }

  /** 章末是否自动翻章（novelReader.autoNextChapter，可配） */
  private autoNextChapter(): boolean {
    return vscode.workspace.getConfiguration('novelReader').get<boolean>('autoNextChapter') ?? true
  }

  readonly onDidChange = this.emitter.event

  constructor(
    private readonly getSource: (origin: string) => BookSource | undefined,
    private readonly onProgress: (bookUrl: string, index: number, count: number) => void,
    /** 目录缓存（跨会话免重复请求目录） */
    private readonly tocStore?: {
      get(bookUrl: string): BookChapter[] | undefined
      save(bookUrl: string, chapters: BookChapter[]): void
    }
  ) {}

  getState(): ReaderState {
    return this.state
  }

  private webbookOf(source: BookSource): WebBook {
    let wb = this.webbooks.get(source.bookSourceUrl)
    if (!wb) {
      wb = createWebBook(source)
      this.webbooks.set(source.bookSourceUrl, wb)
    }
    return wb
  }

  /** 打开书架书籍：加载目录并跳到上次进度 */
  async openBook(book: ShelfBook): Promise<void> {
    const source = this.getSource(book.origin)
    if (!source) {
      this.state = { ...EMPTY_STATE, book, error: `书源不存在或已删除：${book.originName}` }
      this.emitter.fire()
      return
    }
    this.state = { ...EMPTY_STATE, book, loading: true }
    this.emitter.fire()
    try {
      // 目录优先取缓存（书架加入/上次打开时落盘），miss 才请求并回写
      let chapters = this.tocStore?.get(book.bookUrl) ?? []
      if (chapters.length === 0) {
        chapters = await this.webbookOf(source).getChapterList(book.tocUrl)
        if (chapters.length === 0) throw new Error('目录为空')
        void this.tocStore?.save(book.bookUrl, chapters)
      }
      const index = Math.min(Math.max(book.chapterIndex, 0), chapters.length - 1)
      this.state.chapters = chapters
      await this.loadChapter(index)
    } catch (e) {
      this.state.loading = false
      this.state.error = describeError(e)
      this.emitter.fire()
    }
  }

  /** 强制重拉当前书的目录（书架「刷新目录」按钮；章节数变化时进度索引自动收敛） */
  async refreshToc(): Promise<boolean> {
    const { book } = this.state
    if (!book) return false
    const source = this.getSource(book.origin)
    if (!source) return false
    try {
      const chapters = await this.webbookOf(source).getChapterList(book.tocUrl)
      if (chapters.length === 0) throw new Error('目录为空')
      this.state.chapters = chapters
      if (this.state.chapterIndex >= chapters.length) this.state.chapterIndex = chapters.length - 1
      void this.tocStore?.save(book.bookUrl, chapters)
      this.emitter.fire()
      return true
    } catch {
      return false
    }
  }

  async jumpTo(index: number): Promise<void> {
    if (index < 0 || index >= this.state.chapters.length) return
    await this.loadChapter(index)
  }

  async nextChapter(): Promise<void> {
    await this.jumpTo(this.state.chapterIndex + 1)
  }

  async prevChapter(): Promise<void> {
    await this.jumpTo(this.state.chapterIndex - 1)
  }

  /** 关闭当前书（书架移除时清空阅读态） */
  closeBook(): void {
    if (!this.state.book) return
    this.state.book = null
    this.state.chapters = []
    this.state.content = ''
    this.state.lines = []
    this.state.error = null
    this.emitter.fire()
    void vscode.commands.executeCommand('setContext', 'novelReader.reading', false)
  }

  /** 章节正文是否已缓存（书架章节树以图标标记，避免重复请求） */
  hasContent(chapterUrl: string): boolean {
    return this.contentCache.has(chapterUrl)
  }

  /**
   * 段评图代理：webview 的 <img> 不带书源登录态（token），由扩展宿主用书源
   * 沙盒（自动携带 cookieJar）拉取 SVG/图片并转 data URI 供面板渲染。
   * 失败返回 null（面板回退 💬 占位）。
   */
  async fetchChapterImage(url: string): Promise<string | null> {
    const { book } = this.state
    if (!book) return null
    const source = this.getSource(book.origin)
    if (!source) return null
    try {
      const body = await this.webbookOf(source).runJs(`java.ajax(${JSON.stringify(url)})`)
      if (!body || body.length === 0) return null
      const looksSvg = body.trimStart().startsWith('<')
      return looksSvg
        ? `data:image/svg+xml;base64,${Buffer.from(body, 'utf-8').toString('base64')}`
        : null
    } catch {
      return null
    }
  }

  /** 状态栏模式下当前行的切段（其他模式整行渲染，不切段） */
  private currentSegments(): string[] {
    const line = this.state.lines[this.state.lineIndex] ?? ''
    if (!line) return []
    const maxW = vscode.workspace.getConfiguration('novelReader').get<number>('statusBarWidth') ?? 80
    const segs = wrapByDisplayWidth(line, maxW)
    return segs.length > 0 ? segs : [line]
  }

  /** 是否为状态栏阅读模式（切段导航仅在该模式生效） */
  private isStatusBarMode(): boolean {
    return (
      vscode.workspace.getConfiguration('novelReader').get<string>('readLocation') === 'statusBar'
    )
  }

  /** 翻行：状态栏模式下长行先走完行内各段（Alt+↓ 逐段读完右侧内容）再进下一行 */
  async nextLine(): Promise<void> {
    if (this.isStatusBarMode()) {
      const segs = this.currentSegments()
      if (this.state.segIndex < segs.length - 1) {
        this.state.segIndex++
        this.emitter.fire()
        return
      }
      this.state.segIndex = 0
    }
    if (this.state.lineIndex < this.state.lines.length - 1) {
      this.state.lineIndex++
      this.emitter.fire()
      return
    }
    if (this.autoNextChapter() && this.state.chapterIndex < this.state.chapters.length - 1) {
      await this.loadChapter(this.state.chapterIndex + 1, { resetLine: true })
    }
  }

  async prevLine(): Promise<void> {
    if (this.isStatusBarMode() && this.state.segIndex > 0) {
      this.state.segIndex--
      this.emitter.fire()
      return
    }
    if (this.state.lineIndex > 0) {
      this.state.lineIndex--
      // 状态栏模式回退到上一行的最后一段（段末有 … 时继续往回读）
      this.state.segIndex = this.isStatusBarMode() ? this.currentSegments().length - 1 : 0
      this.emitter.fire()
      return
    }
    this.state.segIndex = 0
    if (this.autoNextChapter() && this.state.chapterIndex > 0) {
      await this.loadChapter(this.state.chapterIndex - 1, { resetLine: 'end' })
    }
  }

  private async loadChapter(index: number, opts: { resetLine?: true | 'end' } = {}): Promise<void> {
    const { book, chapters } = this.state
    if (!book) return
    const chapter = chapters[index]
    const source = this.getSource(book.origin)
    if (!chapter || !source) return

    const cached = this.contentCache.get(chapter.url)
    this.state.loading = !cached
    this.state.error = null
    this.emitter.fire()

    let content = cached
    if (!content) {
      try {
        const nextUrl = chapters[index + 1]?.url
        content = await this.webbookOf(source).getContent(chapter.url, { nextChapterUrl: nextUrl })
        this.cacheContent(chapter.url, content)
      } catch (e) {
        this.state.loading = false
        this.state.error = describeError(e)
        this.emitter.fire()
        return
      }
    }

    this.state.chapterIndex = index
    this.state.content = content
    // lines 保持逻辑整行（面板/侧边栏整行渲染、复制无省略号）；状态栏的切段在显示层做
    this.state.lines = displayLines(content)
    this.state.lineIndex = opts.resetLine === 'end' ? Math.max(0, this.state.lines.length - 1) : 0
    // 状态栏模式落到章末时直接定位末行最后一段（与 prevLine 的回退语义一致）
    this.state.segIndex =
      opts.resetLine === 'end' && this.isStatusBarMode()
        ? Math.max(0, this.currentSegments().length - 1)
        : 0
    this.state.loading = false
    this.emitter.fire()
    this.onProgress(book.bookUrl, index, chapters.length)
    vscode.commands.executeCommand('setContext', 'novelReader.reading', true)
    // 后台预取后续章节（novelReader.preloadChapters；fire-and-forget 不阻塞渲染）
    void this.preloadAhead()
  }

  /** 预加载令牌：章节切换后旧预取任务作废 */
  private preloadToken = 0

  /** 向后预加载 X 章（受 cacheLimit 约束；正在读的章节 LRU 保护，不因预取被挤掉） */
  private async preloadAhead(): Promise<void> {
    const n = vscode.workspace.getConfiguration('novelReader').get<number>('preloadChapters') ?? 0
    if (n <= 0) return
    const { book, chapters, chapterIndex } = this.state
    if (!book) return
    const source = this.getSource(book.origin)
    if (!source) return
    const token = ++this.preloadToken
    for (let k = 1; k <= n; k++) {
      if (token !== this.preloadToken) return // 已切章/切书，放弃过期任务
      const ch = chapters[chapterIndex + k]
      if (!ch || this.contentCache.has(ch.url)) continue
      try {
        const nextUrl = chapters[chapterIndex + k + 1]?.url
        const content = await this.webbookOf(source).getContent(ch.url, { nextChapterUrl: nextUrl })
        if (token !== this.preloadToken) return
        this.cacheContent(ch.url, content)
        // LRU 保护：预取后重新激活当前章，避免 cacheLimit 过小时把在读章节淘汰
        const cur = chapters[chapterIndex]
        const curContent = cur ? this.contentCache.get(cur.url) : undefined
        if (cur && curContent !== undefined) this.cacheContent(cur.url, curContent)
      } catch {
        /* 预取失败静默（翻章时会重试并报错） */
      }
    }
    // 章节树缓存图标更新
    this.emitter.fire()
  }

  private cacheContent(url: string, content: string): void {
    this.contentCache.delete(url)
    this.contentCache.set(url, content)
    while (this.contentCache.size > this.cacheLimit()) {
      const oldest = this.contentCache.keys().next().value
      if (oldest === undefined) break
      this.contentCache.delete(oldest)
    }
  }

  dispose(): void {
    this.emitter.dispose()
  }
}

function describeError(e: unknown): string {
  if (e instanceof ContentEmptyError) return '本章内容为空（规则可能失效）'
  if (e instanceof Error) return describeErrorChain(e)
  return String(e)
}

/**
 * 显示行切分（面板/状态栏共用，保证行号与高亮对齐）：
 * - data:image URI（如书源段评 SVG）收敛为 💬 占位
 * - 行首为长 base64 载荷的行（书源章末的评论跳转地址等机器数据）整行隐藏
 * - 「URL + ,{"type":…} 复合选项块」（段评图请求地址）转为 [[img:URL]] 标记，
 *   面板代理拉图渲染为段评图，状态栏显示 💬
 * 不影响引擎原始内容与图片型书源。
 */
export function displayLines(content: string): string[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .map(l => l.replace(/data:image\/[^\s"']+/gi, '💬'))
    .filter(l => !/^[A-Za-z0-9+/=]{40,}/.test(l))
    .map(l => {
      const m = /^(https?:\/\/[^,{\s]+),\s*\{[\s\S]*$/.exec(l)
      return m ? `[[img:${m[1]}]]` : l
    })
}

/**
 * 状态栏超长行按显示宽度分段（中文算 2、半角算 1），段尾以 … 提示未完，
 * Alt+↓ 逐段读完 —— 状态栏文本无法横向滚动，分段是唯一完整阅读方式。
 */
export function wrapByDisplayWidth(line: string, maxWidth: number): string[] {
  const segs: string[] = []
  let cur = ''
  let w = 0
  for (const ch of line) {
    const cw = ch.codePointAt(0)! > 0xff ? 2 : 1
    if (w + cw > maxWidth - 1 && cur) {
      segs.push(cur + '…')
      cur = ''
      w = 0
    }
    cur += ch
    w += cw
  }
  if (cur) segs.push(cur)
  return segs.length > 0 ? segs : [line]
}
