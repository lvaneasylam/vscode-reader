import * as vscode from 'vscode'
import { type SearchBook, type ShelfBook } from 'book-source-engine'
import type { Store } from '../store.js'
import { createWebBook, debugLog } from '../webbook-factory.js'

const KEY_LAST_SOURCE = 'novelReader.lastSourceUrl'

/** 搜索选书 → 加入书架 → 开始阅读 */
export async function searchBook(
  ctx: vscode.ExtensionContext,
  store: Store,
  onBookAdded: (book: ShelfBook) => Promise<void>
): Promise<void> {
  const enabled = store.getSources().filter(s => s.enabled !== false)
  if (enabled.length === 0) {
    void vscode.window.showWarningMessage('没有可用书源，请先导入', '导入书源').then(c => {
      if (c === '导入书源') void vscode.commands.executeCommand('novelReader.importSourceFromFile')
    })
    return
  }

  const lastUrl = ctx.globalState.get<string>(KEY_LAST_SOURCE)
  const sourcePick = await vscode.window.showQuickPick(
    enabled.map(s => ({
      label: s.bookSourceName,
      description: s.bookSourceGroup,
      detail: s.bookSourceUrl,
      picked: s.bookSourceUrl === lastUrl,
      source: s
    })),
    { placeHolder: '选择书源' }
  )
  if (!sourcePick) return
  await ctx.globalState.update(KEY_LAST_SOURCE, sourcePick.source.bookSourceUrl)

  const key = await vscode.window.showInputBox({ prompt: `在「${sourcePick.source.bookSourceName}」中搜索`, placeHolder: '书名/作者' })
  if (!key) return

  const wb = createWebBook(sourcePick.source)

  let results: SearchBook[]
  try {
    results = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `搜索「${key}」…` },
      () => wb.searchBooks(key)
    )
  } catch (e) {
    debugLog(`搜索失败: ${sourcePick.source.bookSourceName} 「${key}」: ${(e as Error).message}`)
    void vscode.window.showErrorMessage(`搜索失败: ${(e as Error).message}`)
    return
  }
  debugLog(`搜索完成: ${sourcePick.source.bookSourceName} 「${key}」→ ${results.length} 本`)
  if (results.length === 0) {
    void vscode.window.showInformationMessage('没有搜索到结果')
    return
  }

  const bookPick = await vscode.window.showQuickPick(
    results.map(b => ({
      label: b.name,
      description: b.author,
      detail: [b.lastChapter, b.kind].filter(Boolean).join(' · '),
      book: b
    })),
    { placeHolder: `共 ${results.length} 个结果` }
  )
  if (!bookPick) return

  // 取 tocUrl（详情规则），失败则退回 bookUrl
  let tocUrl = bookPick.book.bookUrl
  try {
    const info = await wb.getBookInfo(bookPick.book.bookUrl)
    tocUrl = info.tocUrl
  } catch {
    /* 详情失败仍可尝试直接按详情页当目录页 */
  }

  const shelfBook: ShelfBook = {
    bookUrl: bookPick.book.bookUrl,
    name: bookPick.book.name,
    author: bookPick.book.author,
    tocUrl,
    origin: bookPick.book.origin,
    originName: bookPick.book.originName,
    chapterIndex: 0
  }
  await store.addToShelf(shelfBook)
  await onBookAdded(shelfBook)
}
