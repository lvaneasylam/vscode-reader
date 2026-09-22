import * as vscode from 'vscode'
import type { BookSource, SearchBook } from 'book-source-engine'
import { createWebBook } from '../webbook-factory.js'

type ExploreElement =
  | { kind: 'source'; source: BookSource }
  | { kind: 'category'; source: BookSource; name: string; url: string }
  | { kind: 'book'; source: BookSource; book: SearchBook }
  | { kind: 'loading'; source: BookSource; url: string }

/** 瀑布流自动翻页上限（每页 ~10-20 本，5 页约 50-100 本） */
const MAX_AUTO_PAGES = 5

/**
 * 发现页：书源 → 分类 → 书。瀑布流加载——首页出完后后台自动翻页，
 * 书列表逐步增多，无「下一页」按钮。
 */
export class ExploreTree implements vscode.TreeDataProvider<ExploreElement> {
  static readonly VIEW_ID = 'novelReader.explore'
  private readonly emitter = new vscode.EventEmitter<ExploreElement | undefined>()
  readonly onDidChangeTreeData = this.emitter.event

  private readonly pages = new Map<string, SearchBook[]>()
  private readonly nextPage = new Map<string, number>()
  private readonly loading = new Set<string>()
  private readonly entriesCache = new Map<string, Array<{ name: string; url: string }>>()

  constructor(private readonly getSources: () => BookSource[]) {}

  refresh(): void {
    this.pages.clear()
    this.nextPage.clear()
    this.entriesCache.clear()
    this.loading.clear()
    this.emitter.fire(undefined)
  }

  getTreeItem(element: ExploreElement): vscode.TreeItem {
    if (element.kind === 'source') {
      const item = new vscode.TreeItem(element.source.bookSourceName, vscode.TreeItemCollapsibleState.Collapsed)
      item.description = '发现'
      return item
    }
    if (element.kind === 'category') {
      return new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed)
    }
    if (element.kind === 'loading') {
      const item = new vscode.TreeItem('加载中…', vscode.TreeItemCollapsibleState.None)
      item.iconPath = new vscode.ThemeIcon('sync~spin')
      return item
    }
    const item = new vscode.TreeItem(element.book.name, vscode.TreeItemCollapsibleState.None)
    item.description = element.book.author
    item.tooltip = [element.book.name, `作者：${element.book.author}`, element.book.kind, element.book.lastChapter]
      .filter(Boolean)
      .join('\n')
    item.command = {
      command: 'novelReader.openExploreBook',
      title: '阅读此书',
      arguments: [element.source.bookSourceUrl, element.book]
    }
    return item
  }

  async getChildren(element?: ExploreElement): Promise<ExploreElement[]> {
    if (!element) {
      return this.getSources()
        .filter(s => s.enabled !== false && s.exploreUrl?.trim())
        .map(source => ({ kind: 'source', source }) as ExploreElement)
    }
    if (element.kind === 'source') {
      const entries = await this.entriesOf(element.source)
      return entries.map(
        e => ({ kind: 'category', source: element.source, name: e.name, url: e.url }) as ExploreElement
      )
    }
    if (element.kind === 'category') {
      const key = `${element.source.bookSourceUrl}|${element.url}`
      if (!this.pages.has(key)) {
        // 首次展开：加载第一页 + 后台瀑布翻页
        this.loadPage(element.source, element.url, 1)
        await new Promise(r => setTimeout(r, 100)) // 给首页一点时间
      }
      const books = this.pages.get(key) ?? []
      const out: ExploreElement[] = books.map(
        b => ({ kind: 'book', source: element.source, book: b }) as ExploreElement
      )
      // 瀑布加载中显示指示器
      if (this.loading.has(key)) {
        out.push({ kind: 'loading', source: element.source, url: element.url })
      }
      return out
    }
    return []
  }

  private async entriesOf(source: BookSource): Promise<Array<{ name: string; url: string }>> {
    const key = source.bookSourceUrl
    const hit = this.entriesCache.get(key)
    if (hit) return hit
    try {
      const entries = await createWebBook(source).getExploreEntries()
      this.entriesCache.set(key, entries)
      return entries
    } catch {
      return []
    }
  }

  /** 瀑布流加载：首页同步等，后续页后台自动翻（无按钮，列表逐步增多） */
  private async loadPage(source: BookSource, url: string, page: number): Promise<void> {
    const key = `${source.bookSourceUrl}|${url}`
    if (this.loading.has(key)) return
    this.loading.add(key)
    this.emitter.fire(undefined) // 显示加载指示器
    try {
      const books = await createWebBook(source).exploreBooks(url, page)
      if (books.length === 0) {
        this.nextPage.set(key, 0)
        return
      }
      const prev = this.pages.get(key) ?? []
      const seen = new Set(prev.map(b => b.bookUrl))
      this.pages.set(key, [...prev, ...books.filter(b => !seen.has(b.bookUrl))])
      this.nextPage.set(key, page + 1)
      this.emitter.fire(undefined) // 刷新列表（新书出现）

      // 瀑布流：还有下一页且未超上限 → 后台自动继续加载
      if (page < MAX_AUTO_PAGES) {
        void this.loadPage(source, url, page + 1)
      }
    } catch {
      this.nextPage.set(key, 0)
    } finally {
      this.loading.delete(key)
      this.emitter.fire(undefined) // 移除加载指示器
    }
  }
}
