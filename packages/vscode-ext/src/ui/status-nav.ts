import * as vscode from 'vscode'
import type { ReaderController } from '../reader-controller.js'

/** 状态栏导航条：📖 书名 · 章节进度；点击弹出章节选择 */
export class StatusNav implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem

  constructor(private readonly controller: ReaderController) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101)
    this.item.name = '墨遥·阅山行（导航）'
    this.item.command = 'novelReader.selectChapter'
    controller.onDidChange(() => this.render())
    this.render()
  }

  private render(): void {
    const s = this.controller.getState()
    if (!s.book) {
      this.item.hide()
      return
    }
    const chapterTitle = s.chapters[s.chapterIndex]?.title ?? ''
    this.item.text = `$(book) ${s.book.name} · ${s.chapterIndex + 1}/${s.chapters.length}`
    this.item.tooltip = new vscode.MarkdownString(
      `${s.book.name} · ${chapterTitle}\n\n点击选择章节 · Alt+→/← 翻章`
    )
    this.item.show()
  }

  dispose(): void {
    this.item.dispose()
  }
}
