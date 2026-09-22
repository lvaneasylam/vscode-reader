import * as vscode from 'vscode'
import { Store } from './store.js'
import { ReaderController } from './reader-controller.js'
import { importSource } from './commands/import-source.js'
import { manageSources } from './commands/manage-sources.js'
import { SourceEditor } from './commands/edit-source.js'
import { checkSources } from './commands/check-sources.js'
import { sourceLogin, setSourceCookie, pickAndLogin } from './commands/source-login.js'
import { exportSources } from './commands/export-sources.js'
import { searchBook } from './commands/search-book.js'
import { selectFontFile } from './commands/select-font.js'
import { ChaptersTree } from './tree/chapters-tree.js'
import { ReaderPanel } from './ui/reader-panel.js'
import { StatusReader } from './ui/status-reader.js'
import { StatusNav } from './ui/status-nav.js'
import { ToolbarView } from './ui/toolbar-view.js'
import { initSourceState } from './source-state.js'
import { createWebBook } from './webbook-factory.js'
import { ExploreTree } from './tree/explore-tree.js'
import { readEpubMeta } from 'book-source-engine'
import type { ShelfBook, SearchBook } from 'book-source-engine'

export function activate(ctx: vscode.ExtensionContext): void {
  // 书源 JS 的 detached 异步操作安全网（fire-and-forget 的 Promise 失败不应影响扩展宿主）
  process.on('unhandledRejection', reason => {
    console.warn('[novel-reader] 书源后台任务失败:', reason instanceof Error ? reason.message : reason)
  })

  const store = new Store(ctx)
  initSourceState(ctx)
  const controller = new ReaderController(
    origin => store.getSources().find(s => s.bookSourceUrl === origin),
    (bookUrl, index, count) => void store.updateProgress(bookUrl, index, count),
    // 目录缓存：打开书优先读缓存，拉到新目录回写（书架树离线可浏览）
    { get: bookUrl => store.getToc(bookUrl), save: (bookUrl, chapters) => void store.saveToc(bookUrl, chapters) }
  )
  const tree = new ChaptersTree(store, controller)
  const exploreTree = new ExploreTree(() => store.getSources())
  const panel = new ReaderPanel(controller, ReaderPanel.VIEW_ID)
  const sidebarPanel = new ReaderPanel(controller, ReaderPanel.SIDEBAR_VIEW_ID)
  const statusReader = new StatusReader(controller)
  const statusNav = new StatusNav(controller)
  const sourceEditor = new SourceEditor(ctx, store)

  /** 阅读位置模式：statusBar 显示单行正文；panel/sidebar 交给对应 webview 视图 */
  function applyLocation(): void {
    const loc = readLocation()
    if (loc === 'statusBar') statusReader.show()
    else statusReader.hide()
    // 侧边栏模式：自动展开活动栏的「阅读」视图
    if (loc === 'sidebar') sidebarPanel.reveal()
  }

  function readLocation(): 'panel' | 'sidebar' | 'statusBar' {
    const v = vscode.workspace.getConfiguration('novelReader').get<string>('readLocation')
    return v === 'statusBar' || v === 'sidebar' ? v : 'panel'
  }

  async function openBookAndJump(bookUrl: string, index?: number): Promise<void> {
    const book = store.getShelf().find(b => b.bookUrl === bookUrl)
    if (!book) return
    await store.setActiveBookUrl(bookUrl)
    tree.refresh()
    const isCurrent = controller.getState().book?.bookUrl === bookUrl
    if (!isCurrent) await controller.openBook(book)
    if (index !== undefined) await controller.jumpTo(index)
    // 按配置的阅读位置把对应视图带到前台（点书/点章节即见正文）
    const loc = readLocation()
    if (loc === 'panel') panel.reveal()
    else if (loc === 'sidebar') sidebarPanel.reveal()
    // statusBar 模式状态栏常驻，无需处理
  }

  async function selectChapter(): Promise<void> {
    const s = controller.getState()
    if (!s.book) {
      void vscode.window.showInformationMessage('还没有打开的书籍，请先搜索或从书架选择')
      return
    }
    const pick = await vscode.window.showQuickPick(
      s.chapters.map((c, i) => ({
        label: c.title,
        description: i === s.chapterIndex ? '正在读' : '',
        index: i
      })),
      { placeHolder: `${s.book.name} · 选择章节（可输入过滤）` }
    )
    if (pick) await controller.jumpTo(pick.index)
  }

  async function switchLocation(): Promise<void> {
    const order: Array<'panel' | 'sidebar' | 'statusBar'> = ['panel', 'sidebar', 'statusBar']
    const next = order[(order.indexOf(readLocation()) + 1) % order.length]
    await vscode.workspace.getConfiguration('novelReader').update('readLocation', next, vscode.ConfigurationTarget.Global)
    const tip: Record<string, string> = {
      panel: '正文已切换到底部面板（底部「墨遥·阅山行」面板查看）',
      sidebar: '正文已切换到侧边栏（左侧活动栏书本图标 → 阅读）',
      statusBar: '正文已切换到状态栏单行模式（Alt+↓/↑ 翻行，最隐蔽）'
    }
    void vscode.window.showInformationMessage(tip[next])
  }

  /** 老板键：一键隐藏/恢复全部阅读界面（context key 控制视图 when + 状态栏 hide） */
  let bossHidden = false
  function toggleBossKey(): void {
    bossHidden = !bossHidden
    void vscode.commands.executeCommand('setContext', 'novelReader.bossHidden', bossHidden)
    if (bossHidden) {
      statusReader.hide()
      void vscode.window.showInformationMessage('🙈 阅读已隐藏，再按一次老板键恢复')
      return
    }
    const loc = readLocation()
    if (loc === 'statusBar') statusReader.show()
    else if (loc === 'sidebar') sidebarPanel.reveal()
    else panel.reveal()
  }

  // 书架树视图（reveal API 需 createTreeView 而非 registerTreeDataProvider）
  const shelfView = vscode.window.createTreeView('novelReader.shelf', { treeDataProvider: tree })

  applyLocation()

  ctx.subscriptions.push(
    controller,
    statusReader,
    statusNav,
    vscode.window.registerWebviewViewProvider(ReaderPanel.VIEW_ID, panel),
    vscode.window.registerWebviewViewProvider(ReaderPanel.SIDEBAR_VIEW_ID, sidebarPanel),
    vscode.window.createTreeView('novelReader.toolbar', { treeDataProvider: new ToolbarView() }),
    vscode.window.registerTreeDataProvider('novelReader.shelf', tree),
    vscode.window.createTreeView(ExploreTree.VIEW_ID, { treeDataProvider: exploreTree, canSelectMany: false }),
    // 锚点定位：滚动书架树到正在读的章节（缓存优先 → 引用一致 → reveal 滚动）
    vscode.commands.registerCommand('novelReader.locateChapter', async () => {
      const state = controller.getState()
      if (!state.book) {
        void vscode.window.showInformationMessage('还没有打开的书籍')
        return
      }
      const el = tree.getChapterElement(state.book.bookUrl, state.chapterIndex)
      if (!el) return
      await shelfView.reveal(el, { select: true, focus: true, expand: true })
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('novelReader.readLocation')) applyLocation()
    }),
    vscode.workspace.onDidSaveTextDocument(doc => void sourceEditor.handleSaved(doc)),
    vscode.commands.registerCommand('novelReader.searchBook', () =>
      searchBook(ctx, store, book => openBookAndJump(book.bookUrl))
    ),
    vscode.commands.registerCommand('novelReader.openChapter', openBookAndJump),
    vscode.commands.registerCommand('novelReader.refreshToc', async (el?: { kind?: string; book?: { bookUrl: string; tocUrl: string; name: string; origin: string } }) => {
      // 右键某本书 → 刷新那本；标题栏按钮 → 刷新正在读的书
      const target = el?.kind === 'book' ? el.book : controller.getState().book ?? undefined
      if (!target) {
        void vscode.window.showInformationMessage('还没有打开的书籍，右键书架里的书可刷新其目录')
        return
      }
      const isCurrent = controller.getState().book?.bookUrl === target.bookUrl
      if (isCurrent) {
        const ok = await controller.refreshToc()
        tree.refresh()
        void vscode.window[ok ? 'showInformationMessage' : 'showWarningMessage'](
          ok ? `目录已刷新（${controller.getState().chapters.length} 章）` : '目录刷新失败，请稍后重试'
        )
        return
      }
      const source = store.getSources().find(s => s.bookSourceUrl === target.origin)
      if (!source) {
        void vscode.window.showWarningMessage(`书源不存在：${target.name}`)
        return
      }
      try {
        const chapters = await createWebBook(source).getChapterList(target.tocUrl)
        if (chapters.length === 0) throw new Error('目录为空')
        await store.saveToc(target.bookUrl, chapters)
        tree.refresh()
        void vscode.window.showInformationMessage(`「${target.name}」目录已刷新（${chapters.length} 章）`)
      } catch (e) {
        void vscode.window.showWarningMessage(`「${target.name}」目录刷新失败：${(e as Error).message.slice(0, 80)}`)
      }
    }),
    vscode.commands.registerCommand('novelReader.removeShelfBook', async (el: { kind?: string; book?: { bookUrl: string; name: string } }) => {
      if (el?.kind !== 'book' || !el.book) return
      const yes = await vscode.window.showWarningMessage(
        `从书架移除「${el.book.name}」？（阅读进度一并清除，书源不受影响）`,
        { modal: true },
        '移除'
      )
      if (yes !== '移除') return
      await store.removeFromShelf(el.book.bookUrl)
      if (store.getActiveBookUrl() === el.book.bookUrl) await store.setActiveBookUrl(undefined)
      if (controller.getState().book?.bookUrl === el.book.bookUrl) controller.closeBook()
      tree.refresh()
    }),
    vscode.commands.registerCommand('novelReader.openShelfBook', (bookUrl: string) =>
      openBookAndJump(bookUrl)
    ),
    // 发现页：点击书 → 取详情（tocUrl）→ 入书架 → 打开阅读
    vscode.commands.registerCommand('novelReader.openExploreBook', async (sourceUrl: string, book: SearchBook) => {
      const source = store.getSources().find(s => s.bookSourceUrl === sourceUrl)
      if (!source) return
      let tocUrl = book.bookUrl
      try {
        const info = await createWebBook(source).getBookInfo(book.bookUrl)
        tocUrl = info.tocUrl
      } catch {
        /* 详情失败仍可按详情页当目录页 */
      }
      const shelfBook: ShelfBook = {
        bookUrl: book.bookUrl,
        name: book.name,
        author: book.author || '佚名',
        tocUrl,
        origin: book.origin,
        originName: book.originName,
        chapterIndex: 0
      }
      await store.addToShelf(shelfBook)
      tree.refresh()
      await openBookAndJump(shelfBook.bookUrl)
    }),
    // 导入本地 EPUB：解析元数据/目录 → 入书架（origin=local，正文懒读取文件）
    vscode.commands.registerCommand('novelReader.importEpub', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: true,
        openLabel: '导入书架',
        filters: { 'EPUB 电子书': ['epub'] }
      })
      if (!picked || picked.length === 0) return
      let added = 0
      let lastUrl = ''
      for (const file of picked) {
        try {
          const meta = await readEpubMeta(file.fsPath)
          const chapters = meta.toc.map((t, i) => ({ title: t.title, url: t.href, index: i }))
          const shelfBook: ShelfBook = {
            bookUrl: `epub://${file.fsPath}`,
            name: meta.name,
            author: meta.author,
            tocUrl: 'epub',
            origin: 'local',
            originName: 'EPUB 本地书',
            chapterIndex: 0
          }
          await store.addToShelf(shelfBook)
          await store.saveToc(shelfBook.bookUrl, chapters)
          added++
          lastUrl = shelfBook.bookUrl
        } catch (e) {
          void vscode.window.showWarningMessage(
            `导入失败 ${file.path.split('/').pop()}：${(e as Error).message.slice(0, 80)}`
          )
        }
      }
      if (added > 0) {
        tree.refresh()
        void vscode.window.showInformationMessage(`已导入 ${added} 本 EPUB`)
        await openBookAndJump(lastUrl)
      }
    }),
    vscode.commands.registerCommand('novelReader.selectChapter', selectChapter),
    vscode.commands.registerCommand('novelReader.toggleBossKey', toggleBossKey),
    vscode.commands.registerCommand('novelReader.nextChapter', () => controller.nextChapter()),
    vscode.commands.registerCommand('novelReader.prevChapter', () => controller.prevChapter()),
    vscode.commands.registerCommand('novelReader.nextLine', () => controller.nextLine()),
    vscode.commands.registerCommand('novelReader.prevLine', () => controller.prevLine()),
    vscode.commands.registerCommand('novelReader.switchLocation', switchLocation),
    vscode.commands.registerCommand('novelReader.selectFontFile', () => selectFontFile()),
    // 设置页直达：按本扩展过滤（@ext: 只显示这个插件的配置项）
    vscode.commands.registerCommand('novelReader.openSettings', () =>
      void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:c-hiang-dev.novel-reader')
    ),
    vscode.commands.registerCommand('novelReader.importSourceFromFile', () =>
      importSource(ctx, store, 'file')
    ),
    vscode.commands.registerCommand('novelReader.importSourceFromUrl', () =>
      importSource(ctx, store, 'url')
    ),
    vscode.commands.registerCommand('novelReader.importSourceFromClipboard', () =>
      importSource(ctx, store, 'clipboard')
    ),
    vscode.commands.registerCommand('novelReader.manageSources', () =>
      manageSources(
        store,
        source => sourceEditor.open(source),
        source => sourceLogin(source, store)
      )
    ),
    vscode.commands.registerCommand('novelReader.checkSources', () => checkSources(store)),
    vscode.commands.registerCommand('novelReader.sourceLogin', () => pickAndLogin(store)),
    vscode.commands.registerCommand('novelReader.setSourceCookie', () => setSourceCookie(store)),
    vscode.commands.registerCommand('novelReader.exportSources', () => exportSources(store))
  )

  // 会话恢复：打开上次阅读的书
  const lastBook = store.getShelf().find(b => b.bookUrl === store.getActiveBookUrl())
  if (lastBook) void controller.openBook(lastBook)
}

export function deactivate(): void {
  /* 订阅已在 ctx.subscriptions 统一释放 */
}
