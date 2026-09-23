import * as vscode from 'vscode'
import type { ReaderController } from '../reader-controller.js'
import { renderReaderHtml, type PanelAppearance } from './reader-html.js'

/** 从显示行里提取段评图标记 [[img:URL]] */
export function extractImgMarks(lines: string[]): string[] {
  const urls: string[] = []
  for (const l of lines) {
    const m = /^\[\[img:(https?:\/\/[^\]]+)\]\]$/.exec(l)
    if (m) urls.push(m[1])
  }
  return urls
}

/** 阅读面板（WebviewView 渲染正文；同一渲染可注册到多个位置：底部面板 / 侧边栏） */
export class ReaderPanel implements vscode.WebviewViewProvider {
  static readonly VIEW_ID = 'novelReader.panel'
  static readonly SIDEBAR_VIEW_ID = 'novelReader.sidebar'
  private view: vscode.WebviewView | null = null
  /** 上次整页渲染的结构指纹（书/章/加载态/错误/内容长度/外观），仅行号变化不重绘 */
  private structuralKey = ''

  /** viewId：底部面板（novelReader.panel）或侧边栏（novelReader.sidebar） */
  constructor(
    private readonly controller: ReaderController,
    private readonly viewId: string = ReaderPanel.VIEW_ID
  ) {
    controller.onDidChange(() => this.render())
    // 外观配置变化（字体/字号/行高/宽度）→ 整页重渲染生效
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('novelReader')) {
        this.structuralKey = ''
        this.render()
      }
    })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true, localResourceRoots: this.fontResourceRoots() }
    view.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'prev') void this.controller.prevChapter()
      if (msg?.type === 'next') void this.controller.nextChapter()
      if (msg?.type === 'jumpLine' && Number.isInteger(msg.i)) {
        // 点击行定位：仅切高亮，不滚动页面（Alt+↓ 翻行仍保留滚动跟随）
        this.noScrollOnce = msg.noScroll === true
        this.controller.jumpLine(msg.i)
      }
    })
    this.render()
  }

  /** 面板可见性由 readLocation 决定：statusBar 模式下提示切换 */
  reveal(): void {
    this.view?.show?.(true)
  }

  private readAppearance(): PanelAppearance {
    const cfg = vscode.workspace.getConfiguration('novelReader')
    const fontFile = cfg.get<string>('fontFile') ?? ''
    // 本地字体文件须经 asWebviewUri 才能进 webview；非法路径静默忽略
    let fontFileUri: string | undefined
    if (fontFile.trim()) {
      try {
        fontFileUri = this.view?.webview.asWebviewUri(vscode.Uri.file(fontFile)).toString()
      } catch {
        fontFileUri = undefined
      }
    }
    return {
      fontSize: cfg.get<number>('fontSize') ?? 15,
      lineHeight: cfg.get<number>('lineHeight') ?? 1.9,
      contentWidth: cfg.get<number>('contentWidth') ?? 0,
      fontFamily: cfg.get<string>('fontFamily') ?? '',
      fontFileUri,
      background: cfg.get<string>('backgroundColor') ?? '',
      foreground: cfg.get<string>('foregroundColor') ?? ''
    }
  }

  private fontResourceRoots(): vscode.Uri[] | undefined {
    const fontFile = vscode.workspace.getConfiguration('novelReader').get<string>('fontFile') ?? ''
    if (!fontFile.trim()) return undefined
    try {
      return [vscode.Uri.joinPath(vscode.Uri.file(fontFile), '..')]
    } catch {
      return undefined
    }
  }

  private renderSeq = 0
  private lastLineIndex = 0
  /** 下一次 setCur 只移动高亮不滚动（点击行定位触发） */
  private noScrollOnce = false
  private render(): void {
    if (!this.view) return
    const s = this.controller.getState()
    const look = this.readAppearance()
    const key = `${s.book?.bookUrl}|${s.chapterIndex}|${s.loading}|${s.error}|${s.content?.length}|${JSON.stringify(look)}`
    if (key !== this.structuralKey) {
      // 章节/加载态/错误/外观变化：整页重绘（含段评图代理拉取；竞态以序号守卫）
      this.structuralKey = key
      const seq = ++this.renderSeq
      this.lastLineIndex = s.lineIndex
      void this.renderFull(s, look, seq)
      return
    }
    // 仅翻行：轻量消息移动高亮并滚动跟随（避免整页刷新丢滚动位置）
    const dir = s.lineIndex >= this.lastLineIndex ? 'down' : 'up'
    this.lastLineIndex = s.lineIndex
    const noScroll = this.noScrollOnce
    this.noScrollOnce = false
    void this.view.webview.postMessage({ type: 'setCur', i: s.lineIndex, dir, noScroll })
  }

  private async renderFull(
    s: ReturnType<ReaderController['getState']>,
    look: PanelAppearance,
    seq: number
  ): Promise<void> {
    if (!this.view) return
    // 首屏立即渲染：缓存命中的段评图直接显示，未命中的渲染 💬 占位
    const imgUrls = extractImgMarks(s.lines)
    const cached: Record<string, string> = {}
    const pending: string[] = []
    for (const u of imgUrls) {
      const hit = this.controller.peekImage(u)
      if (hit) cached[u] = hit
      else pending.push(u)
    }
    this.view.webview.html = renderReaderHtml(s, look, cached)
    // 段评图代理拉取（webview <img> 无登录态，由扩展宿主拉取转 data URI）完成后，
    // 用 imgReady 消息局部替换占位——不整页重设 HTML，用户滚动位置不受影响
    if (pending.length === 0) return
    const results = await Promise.all(
      pending.map(async u => [u, await this.controller.fetchChapterImage(u)] as const)
    )
    if (seq !== this.renderSeq || !this.view) return // 已有更新一轮渲染，丢弃过期结果
    for (const [u, dataUri] of results) {
      if (dataUri) void this.view.webview.postMessage({ type: 'imgReady', url: u, src: dataUri })
    }
  }
}
