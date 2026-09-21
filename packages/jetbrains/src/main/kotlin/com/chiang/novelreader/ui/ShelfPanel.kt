package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.ui.treeStructure.Tree
import java.awt.BorderLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreePath

/** 书架面板：书 → 章节 两层树（点击打开/跳转），顶部工具条（搜索/导入书源/登录/设置） */
class ShelfPanel(private val app: NovelApp) : JPanel(BorderLayout()) {
    private val root = DefaultMutableTreeNode("书架")
    private val model = DefaultTreeModel(root)
    private val tree: Tree = Tree(model).apply {
        isRootVisible = false
        showsRootHandles = true
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                val path: TreePath = tree.getClosestPathForLocation(e.x, e.y) ?: return
                val node = path.lastPathComponent as? DefaultMutableTreeNode ?: return
                val data = node.userObject
                if (data is BookNode) app.controller.openBook(data.book)
                else if (data is ChapterItem) {
                    app.controller.state.book?.let { app.controller.openBook(it, data.index) }
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
        root.removeAllChildren()
        val current = app.controller.state.book
        for (book in app.store.loadShelf()) {
            val bookNode = DefaultMutableTreeNode(BookNode(book))
            if (current?.bookUrl == book.bookUrl) {
                app.controller.state.chapters.forEachIndexed { i, ch ->
                    bookNode.add(DefaultMutableTreeNode(ChapterItem(ch.title, i, i == app.controller.state.chapterIndex)))
                }
            } else {
                val toc = app.store.loadToc(book.bookUrl)
                if (toc.isNotEmpty()) bookNode.add(DefaultMutableTreeNode("… ${toc.size} 章"))
            }
            root.add(bookNode)
        }
        model.reload()
    }

    /** 章节节点：index 供点击直达，🔖 标记正在读 */
    data class ChapterItem(val title: String, val index: Int, val current: Boolean) {
        override fun toString(): String = title + if (current) "  🔖" else ""
    }
}
