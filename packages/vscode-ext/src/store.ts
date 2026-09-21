import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import type { BookSource, BookChapter, ShelfBook } from 'book-source-engine'

const KEY_SOURCES = 'novelReader.sources'
const KEY_SHELF = 'novelReader.shelf'
const KEY_ACTIVE = 'novelReader.activeBookUrl'
const KEY_TOC = 'novelReader.tocs'

/** globalState 持久化封装（书源/书架/进度全局跨工作区） */
export class Store {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  getSources(): BookSource[] {
    return this.ctx.globalState.get<BookSource[]>(KEY_SOURCES) ?? []
  }

  async saveSources(sources: BookSource[]): Promise<void> {
    await this.ctx.globalState.update(KEY_SOURCES, sources)
  }

  /** 按 bookSourceUrl 去重合并导入 */
  async mergeSources(incoming: BookSource[]): Promise<{ added: number; updated: number }> {
    const existing = this.getSources()
    const map = new Map(existing.map(s => [s.bookSourceUrl, s]))
    let added = 0
    let updated = 0
    for (const s of incoming) {
      if (map.has(s.bookSourceUrl)) updated++
      else added++
      map.set(s.bookSourceUrl, s)
    }
    await this.saveSources([...map.values()])
    return { added, updated }
  }

  getShelf(): ShelfBook[] {
    return this.ctx.globalState.get<ShelfBook[]>(KEY_SHELF) ?? []
  }

  async addToShelf(book: ShelfBook): Promise<void> {
    const shelf = this.getShelf().filter(b => b.bookUrl !== book.bookUrl)
    shelf.push(book)
    await this.ctx.globalState.update(KEY_SHELF, shelf)
  }

  async removeFromShelf(bookUrl: string): Promise<void> {
    const shelf = this.getShelf().filter(b => b.bookUrl !== bookUrl)
    await this.ctx.globalState.update(KEY_SHELF, shelf)
  }

  async updateProgress(bookUrl: string, chapterIndex: number, chapterCount?: number): Promise<void> {
    const shelf = this.getShelf()
    const book = shelf.find(b => b.bookUrl === bookUrl)
    if (!book) return
    book.chapterIndex = chapterIndex
    book.chapterCount = chapterCount
    await this.ctx.globalState.update(KEY_SHELF, shelf)
  }

  getActiveBookUrl(): string | undefined {
    return this.ctx.globalState.get<string>(KEY_ACTIVE)
  }

  async setActiveBookUrl(bookUrl: string | undefined): Promise<void> {
    await this.ctx.globalState.update(KEY_ACTIVE, bookUrl)
  }

  /** 目录缓存（bookUrl 是超长 data URL，以 md5 为键；书架树离线可浏览、打开书免重复请求） */
  getToc(bookUrl: string): BookChapter[] | undefined {
    const all = this.ctx.globalState.get<Record<string, BookChapter[]>>(KEY_TOC) ?? {}
    return all[tocKey(bookUrl)]
  }

  async saveToc(bookUrl: string, chapters: BookChapter[]): Promise<void> {
    const all = this.ctx.globalState.get<Record<string, BookChapter[]>>(KEY_TOC) ?? {}
    all[tocKey(bookUrl)] = chapters
    await this.ctx.globalState.update(KEY_TOC, all)
  }
}

function tocKey(bookUrl: string): string {
  return createHash('md5').update(bookUrl).digest('hex')
}
