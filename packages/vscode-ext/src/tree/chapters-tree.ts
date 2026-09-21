import * as vscode from 'vscode'
import type { ShelfBook } from 'book-source-engine'
import type { ReaderController } from '../reader-controller.js'

type TreeElement =
  | { kind: 'book'; book: ShelfBook }
  | { kind: 'chapter'; book: ShelfBook; index: number }

/** 书架 → 章节 两层树；点击章节跳转阅读 */
export class ChaptersTree implements vscode.TreeDataProvider<TreeElement> {
  private readonly emitter = new vscode.EventEmitter<void>()
  readonly onDidChangeTreeData = this.emitter.event

  constructor(
    private readonly store: {
      getShelf(): ShelfBook[]
      getToc?(bookUrl: string): import('book-source-engine').BookChapter[] | undefined
    },
    private readonly controller: ReaderController
  ) {
    controller.onDidChange(() => this.refresh())
  }

  /** 某本书当前可见的章节列表（在读书用 controller 内存态，其他书用目录缓存） */
  private visibleChapters(bookUrl: string): { title: string; url: string }[] {
    const state = this.controller.getState()
    if (state.book?.bookUrl === bookUrl) return state.chapters
    return this.store.getToc?.(bookUrl) ?? []
  }

  refresh(): void {
    this.emitter.fire()
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element.kind === 'book') {
      const state = this.controller.getState()
      const isCurrent = state.book?.bookUrl === element.book.bookUrl
      const progress = element.book.chapterCount
        ? `${element.book.chapterIndex + 1}/${element.book.chapterCount}`
        : `${element.book.chapterIndex + 1}`
      const item = new vscode.TreeItem(
        element.book.name,
        isCurrent
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed
      )
      item.description = `${element.book.author} · ${progress}`
      item.tooltip = `${element.book.name}\n作者：${element.book.author}\n书源：${element.book.originName}\n进度：${progress}`
      item.contextValue = 'book'
      item.command = {
        command: 'novelReader.openShelfBook',
        title: '打开书籍',
        arguments: [element.book.bookUrl]
      }
      return item
    }
    const state = this.controller.getState()
    const chapters = this.visibleChapters(element.book.bookUrl)
    const isCurrentChapter =
      state.book?.bookUrl === element.book.bookUrl && state.chapterIndex === element.index
    const item = new vscode.TreeItem(chapters[element.index]?.title ?? `第${element.index + 1}章`)
    item.description = isCurrentChapter ? '🔖' : ''
    // 已缓存章节以数据库图标标记（免重复请求，断网也能读）
    if (this.controller.hasContent(chapters[element.index]?.url ?? '')) {
      item.iconPath = new vscode.ThemeIcon('database')
      item.tooltip = '已缓存正文'
    }
    item.command = {
      command: 'novelReader.openChapter',
      title: '阅读本章',
      arguments: [element.book.bookUrl, element.index]
    }
    return item
  }

  getChildren(element?: TreeElement): TreeElement[] {
    const shelf = this.store.getShelf()
    if (!element) return shelf.map(book => ({ kind: 'book', book }) as TreeElement)
    if (element.kind === 'book') {
      // 在读书用实时目录，其他书用目录缓存（加入/打开过即有，离线可浏览）
      const chapters = this.visibleChapters(element.book.bookUrl)
      return chapters.map((_, i) => ({ kind: 'chapter', book: element.book, index: i }) as TreeElement)
    }
    return []
  }
}
