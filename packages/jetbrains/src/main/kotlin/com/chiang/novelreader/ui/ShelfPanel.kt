package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.icons.AllIcons
import com.intellij.ui.treeStructure.Tree
import java.awt.BorderLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JMenuItem
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTree
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath

/** 书架面板：书 → 章节 两层树（点击打开/跳转）；右键/Del：刷新目录、移除书籍、定位正在读的章节 */
class ShelfPanel(private val app: NovelApp) : JPanel(BorderLayout()) {

    /** 打开书/章节后回调（工厂注入：切换到「阅读」tab） */
    var onOpenBook: (() -> Unit)? = null

    private val root = DefaultMutableTreeNode("书架")
    private val model = DefaultTreeModel(root)
    private val tree: Tree = Tree(model).apply {
        isRootVisible = false
        showsRootHandles = true
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount < 2) return  // 单击交给树默认（展开/收起）；双击打开并跳阅读
                val path: TreePath = tree.getPathForLocation(e.x, e.y) ?: return
                val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return
                val data = node.userObject
                if (data is BookNode) {
                    app.controller.openBook(data.book)
                    onOpenBook?.invoke()
                } else if (data is ChapterItem) {
                    // 所属书从父节点取——不依赖当前已打开的书（重启后直接双击章节也能直达）
                    val parent = if (path.pathCount >= 2)
                        path.getPathComponent(path.pathCount - 2) as? DefaultMutableTreeNode else null
                    val book = (parent?.userObject as? BookNode)?.book
                        ?: app.controller.state.book
                    if (book != null) {
                        app.controller.openBook(book, data.index)
                        onOpenBook?.invoke()
                    }
                }
            }

            override fun mousePressed(e: MouseEvent) {
                if (e.isPopupTrigger) showPopup(e)
            }

            override fun mouseReleased(e: MouseEvent) {
                if (e.isPopupTrigger) showPopup(e)
            }
        })
        // Delete 键：移除选中书籍
        addKeyListener(object : java.awt.event.KeyAdapter() {
            override fun keyPressed(e: java.awt.event.KeyEvent) {
                if (e.keyCode == java.awt.event.KeyEvent.VK_DELETE) {
                    (tree.selectionPath?.lastPathComponent as? DefaultMutableTreeNode)
                        ?.userObject.let { if (it is BookNode) removeBook(it) }
                }
            }
        })
    }

    data class BookNode(val book: com.chiang.novelreader.data.ShelfBook) {
        override fun toString(): String =
            "${book.name}（${book.author}）" + if (book.chapterCount > 0) " ${book.chapterIndex + 1}/${book.chapterCount}" else ""
    }

    init {
        add(JScrollPane(tree), BorderLayout.CENTER)
        app.controller.onChange { refresh() }
        refresh()
    }

    fun refresh() {
        // 记住展开状态（reload 会折叠整树）
        val expanded = HashSet<String>()
        for (i in 0 until root.childCount) {
            val n = root.getChildAt(i) as? DefaultMutableTreeNode ?: continue
            val b = (n.userObject as? BookNode)?.book ?: continue
            if (tree.isExpanded(TreePath(arrayOf(root, n)))) expanded.add(b.bookUrl)
        }
        root.removeAllChildren()
        val current = app.controller.state.book
        val curIndex = app.controller.state.chapterIndex
        for (book in app.store.loadShelf()) {
            val bookNode = DefaultMutableTreeNode(BookNode(book))
            val isCurrent = current?.bookUrl == book.bookUrl
            // 章节一律从本地缓存渲染（当前书用内存态，其余读 toc.json）——零网络请求，展开即得
            val chapters = if (isCurrent && app.controller.state.chapters.isNotEmpty()) {
                app.controller.state.chapters
            } else {
                app.store.loadToc(book.bookUrl)
            }
            chapters.forEachIndexed { i, ch ->
                bookNode.add(DefaultMutableTreeNode(ChapterItem(ch.title, i, isCurrent && i == curIndex)))
            }
            root.add(bookNode)
        }
        model.reload()
        // 恢复展开；正在读的书自动展开（点书即可见章节列表）
        for (i in 0 until root.childCount) {
            val n = root.getChildAt(i) as? DefaultMutableTreeNode ?: continue
            val b = (n.userObject as? BookNode)?.book ?: continue
            if (b.bookUrl in expanded || b.bookUrl == current?.bookUrl) {
                tree.expandPath(TreePath(arrayOf(root, n)))
            }
        }
    }

    /** 定位正在读的章节：展开当前书节点，滚动并选中 🔖 章节行 */
    fun locateCurrent() {
        val state = app.controller.state
        val book = state.book ?: return
        var bookPath: TreePath? = null
        for (i in 0 until root.childCount) {
            val n = root.getChildAt(i) as? DefaultMutableTreeNode ?: continue
            if ((n.userObject as? BookNode)?.book?.bookUrl == book.bookUrl) {
                bookPath = TreePath(arrayOf(root, n)); break
            }
        }
        if (bookPath == null) return
        tree.expandPath(bookPath)
        refresh() // refresh 后节点重建，需重新取路径
        for (i in 0 until root.childCount) {
            val n = root.getChildAt(i) as? DefaultMutableTreeNode ?: continue
            if ((n.userObject as? BookNode)?.book?.bookUrl != book.bookUrl) continue
            for (j in 0 until n.childCount) {
                val ch = n.getChildAt(j) as? DefaultMutableTreeNode ?: continue
                if ((ch.userObject as? ChapterItem)?.current == true) {
                    val path = TreePath(arrayOf(root, n, ch))
                    tree.selectionPath = path
                    tree.scrollPathToVisible(path)
                    return
                }
            }
        }
        tree.scrollPathToVisible(bookPath)
    }

    private fun showPopup(e: MouseEvent) {
        val path = tree.getPathForLocation(e.x, e.y)
        val node = path?.lastPathComponent as? DefaultMutableTreeNode
        if (node != null) tree.selectionPath = path
        val menu = javax.swing.JPopupMenu()
        menu.add(JMenuItem("刷新目录（重新请求章节列表）", AllIcons.Actions.Refresh).apply {
            addActionListener { app.controller.refreshToc() }
        })
        menu.add(JMenuItem("定位正在读的章节", AllIcons.Actions.FindBackward).apply {
            addActionListener { locateCurrent() }
        })
        val bookNode = node?.userObject as? BookNode
        if (bookNode != null) {
            menu.addSeparator()
            menu.add(JMenuItem("从书架移除《${bookNode.book.name}》", AllIcons.General.Remove).apply {
                addActionListener { removeBook(bookNode) }
            })
        }
        menu.show(tree, e.x, e.y)
    }

    private fun removeBook(node: BookNode) {
        app.store.removeFromShelf(node.book.bookUrl)
        if (app.controller.state.book?.bookUrl == node.book.bookUrl) {
            app.controller.clearReading()
        }
        refresh()
    }

    /** 章节节点：index 供点击直达，🔖 标记正在读 */
    data class ChapterItem(val title: String, val index: Int, val current: Boolean) {
        override fun toString(): String = title + if (current) "  🔖" else ""
    }
}
