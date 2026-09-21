import * as vscode from 'vscode'
import type { ReaderController } from '../reader-controller.js'
import { wrapByDisplayWidth } from '../reader-controller.js'

/** 状态栏单行模式：一行正文（长行按宽度切段逐段读，段尾 … 表示未完） */
export class StatusReader implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor(private readonly controller: ReaderController) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    this.item.name = '墨遥·阅山行（正文行）'
    this.item.command = 'novelReader.selectChapter'
    controller.onDidChange(() => this.render())
    this.render()
  }

  show(): void {
    this.item.show()
  }

  hide(): void {
    this.item.hide()
  }

  private render(): void {
    const s = this.controller.getState()
    if (!s.book) {
      this.hide()
      return
    }
    const line = s.lines[s.lineIndex] ?? ''
    const chapterTitle = s.chapters[s.chapterIndex]?.title ?? ''
    // 段评图标记行（面板渲染图片）在状态栏显示为占位
    if (/^\[\[img:/.test(line)) {
      this.item.text = '💬 段评'
      this.item.tooltip = new vscode.MarkdownString(
        `**${s.book.name}** · ${chapterTitle}（第 ${s.chapterIndex + 1}/${s.chapters.length} 章）\n\n本段有段评图（状态栏模式显示占位，面板/侧边栏模式可查看图片）`
      )
      this.item.show()
      return
    }
    // 显示层切段（状态栏专属；面板/侧边栏整行渲染不受影响）
    const maxW = vscode.workspace.getConfiguration('novelReader').get<number>('statusBarWidth') ?? 80
    const segs = wrapByDisplayWidth(line, maxW)
    const text = segs[Math.min(s.segIndex, segs.length - 1)] ?? ''
    const segHint = segs.length > 1 ? `，本行 ${s.segIndex + 1}/${segs.length} 段` : ''
    this.item.text = text
    this.item.tooltip = new vscode.MarkdownString(
      `**${s.book.name}** · ${chapterTitle}（第 ${s.chapterIndex + 1}/${s.chapters.length} 章，第 ${s.lineIndex + 1} 行${segHint}）\n\n快捷键：Alt+↓ 下一行/下一段 · Alt+↑ 上一行/上一段\n点击选择章节`
    )
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }
}
