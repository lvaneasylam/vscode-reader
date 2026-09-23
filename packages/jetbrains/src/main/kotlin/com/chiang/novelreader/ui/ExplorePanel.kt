package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.components.JBList
import java.awt.BorderLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import javax.swing.SwingUtilities

/** 发现页：源 → 分类（exploreUrl）→ 书列表，双击入书架并阅读（对齐 VSCode 发现视图） */
class ExplorePanel(private val app: NovelApp) : JPanel(BorderLayout(8, 8)) {

    private data class Entry(val name: String, val url: String) {
        override fun toString(): String = name
    }

    private class BookHit(
        val name: String, val author: String, val bookUrl: String,
        val intro: String, val origin: String, val originName: String
    ) {
        override fun toString(): String = "$name（$author）\n${intro.take(60)}"
    }

    private val sources = app.store.loadSources().filter { it.enabled }
    private val sourceBox = ComboBox(sources.map { it.name }.toTypedArray())
    private val categoryBox = ComboBox<Entry>()
    private val bookList = JBList<BookHit>().apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        cellRenderer = SimpleListCellRenderer.create("") { it.name }
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2) openSelected()
            }
        })
    }
    private var page = 1
    private var loading = false

    init {
        add(toolbar(), BorderLayout.NORTH)
        add(com.intellij.ui.ScrollPaneFactory.createScrollPane(bookList), BorderLayout.CENTER)
        if (sources.isNotEmpty()) {
            sourceBox.selectedIndex = 0
            loadCategories()
        } else {
            bookList.setListData(arrayOf())
        }
        sourceBox.addActionListener { loadCategories() }
        categoryBox.addActionListener { reload() }
    }

    private fun toolbar(): JComponent = JPanel(BorderLayout(6, 4)).apply {
        add(JPanel(BorderLayout(6, 4)).apply {
            add(sourceBox, BorderLayout.CENTER)
            add(categoryBox, BorderLayout.EAST)
        }, BorderLayout.CENTER)
        add(JButton("刷新分类").apply { addActionListener { loadCategories() } }, BorderLayout.WEST)
        add(JButton("下一页").apply { addActionListener { loadMore() } }, BorderLayout.EAST)
    }

    private fun selectedSource() = sources.getOrNull(sourceBox.selectedIndex)

    private fun loadCategories() {
        val src = selectedSource() ?: return
        categoryBox.removeAllItems()
        app.execute(onDone = { res: Result<List<Entry>> ->
            res.fold(
                onSuccess = { entries ->
                    entries.forEach { categoryBox.addItem(it) }
                    if (entries.isNotEmpty()) {
                        categoryBox.selectedIndex = 0
                        SwingUtilities.invokeLater { reload() }
                    }
                },
                onFailure = { bookList.setListData(arrayOf()); hint(it.message ?: "失败") }
            )
        }) {
            val res = app.rpc("parseExplore", mapOf("source" to src.json))
            val arr = res.getAsJsonArray("result") ?: error("书源无发现页（exploreUrl 为空）")
            (0 until arr.size()).map { i ->
                val o = arr.get(i).asJsonObject
                Entry(o.str("name"), o.str("url"))
            }
        }
    }

    private fun reload() {
        page = 1
        bookList.setListData(arrayOf())
        load(false)
    }

    private fun loadMore() = load(true)

    private fun load(append: Boolean) {
        val src = selectedSource() ?: return
        val entry = categoryBox.selectedItem as? Entry ?: return
        if (loading) return
        loading = true
        app.execute(onDone = { res: Result<List<BookHit>> ->
            loading = false
            res.fold(
                onSuccess = { hits ->
                    if (append) {
                        val model = bookList.model
                        val merged = ArrayList<BookHit>(model.size + hits.size)
                        val seen = HashSet<String>()
                        for (i in 0 until model.size) model.getElementAt(i).let {
                            merged.add(it); seen.add(it.bookUrl)
                        }
                        // 书源翻页偶发返回重复条目：按 bookUrl 去重后再追加
                        var added = 0
                        for (h in hits) if (seen.add(h.bookUrl)) { merged.add(h); added++ }
                        bookList.setListData(merged.toTypedArray())
                        bookList.selectedIndex = (merged.size - added - 1).coerceAtLeast(0)
                        if (added == 0) hint("没有更多了")
                    } else {
                        bookList.setListData(hits.toTypedArray())
                        if (hits.isEmpty()) hint("没有更多了")
                    }
                },
                onFailure = { hint(it.message ?: "加载失败") }
            )
        }) {
            val res = app.rpc(
                "exploreBooks",
                mapOf("source" to src.json, "exploreUrl" to entry.url, "page" to page)
            )
            val arr = res.getAsJsonArray("result") ?: error("返回空数据")
            (0 until arr.size()).map { i ->
                val o = arr.get(i).asJsonObject
                BookHit(o.str("name"), o.str("author"), o.str("bookUrl"), o.str("intro"), src.url, src.name)
            }.also { if (append || it.isNotEmpty()) page += 1 }
        }
    }

    private fun openSelected() {
        val hit = bookList.selectedValue ?: return
        app.addAndOpen(
            name = hit.name, author = hit.author, bookUrl = hit.bookUrl,
            origin = hit.origin, originName = hit.originName,
            onDone = { res -> res.onFailure { hint("打开失败：${it.message}") } }
        )
    }

    private fun hint(msg: String) {
        // 简易提示：借列表空态（JBList 无 emptyText 直设时用占位）
        bookList.setListData(arrayOf())
        bookList.emptyText.text = msg
    }

    private fun com.google.gson.JsonObject.str(key: String): String =
        getAsJsonPrimitive(key)?.takeIf { it.isString }?.asString ?: ""
}
