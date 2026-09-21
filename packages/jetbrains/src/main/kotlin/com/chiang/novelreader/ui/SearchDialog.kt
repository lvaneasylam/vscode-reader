package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.data.SearchHit
import com.chiang.novelreader.data.ShelfBook
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.SimpleListCellRenderer
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBTextField
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ListSelectionModel

/** 搜索书籍：选源 + 关键字 → 结果列表（双击或 OK 阅读选中项） */
class SearchDialog(private val app: NovelApp, project: Project?) : DialogWrapper(project) {
    private val sources = app.store.loadSources().filter { it.enabled }
    private val sourceBox = com.intellij.openapi.ui.ComboBox(sources.map { it.name }.toTypedArray())
    private val input = JBTextField()
    private val resultList = JBList<SearchHit>().apply {
        selectionMode = ListSelectionModel.SINGLE_SELECTION
        cellRenderer = SimpleListCellRenderer.create("") { "${it.name}（${it.author}）${it.kind}" }
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount == 2) openSelected()
            }
        })
    }
    private var hits: List<SearchHit>? = null

    init {
        title = "搜索书籍"
        init()
        if (sources.isEmpty()) {
            setErrorText("还没有书源（先导入书源 JSON），或用工具窗的「导入 EPUB」读本地书")
            isOKActionEnabled = false
        }
    }

    override fun createCenterPanel(): JComponent = JPanel(BorderLayout(8, 8)).apply {
        preferredSize = Dimension(500, 420)
        add(JPanel(BorderLayout(4, 4)).apply {
            add(sourceBox, BorderLayout.CENTER)
            add(input.apply { emptyText.text = "书名 / 作者" }, BorderLayout.SOUTH)
        }, BorderLayout.NORTH)
        add(com.intellij.ui.ScrollPaneFactory.createScrollPane(resultList), BorderLayout.CENTER)
    }

    override fun doOKAction() {
        // 已有结果：阅读选中项
        if (hits != null) {
            openSelected()
            return
        }
        val key = input.text.trim()
        if (key.isEmpty() || sources.isEmpty()) return
        val source = sources[sourceBox.selectedIndex]
        isOKActionEnabled = false
        setOKButtonText("搜索中…")
        app.execute(onDone = { res: Result<List<SearchHit>> ->
            res.fold(
                onSuccess = { found ->
                    hits = found
                    resultList.setListData(found.toTypedArray())
                    if (found.size == 1) resultList.selectedIndex = 0
                    setErrorText(if (found.isEmpty()) "没有搜索到结果" else null)
                    setOKButtonText("阅读选中")
                    isOKActionEnabled = found.isNotEmpty()
                },
                onFailure = {
                    setErrorText(it.message)
                    setOKButtonText("搜索")
                    isOKActionEnabled = true
                }
            )
        }) {
            val res = app.rpc("searchBooks", mapOf("source" to source.json, "key" to key))
            val arr = res.getAsJsonArray("result") ?: error("书源返回空数据")
            (0 until arr.size()).map { i ->
                val o = arr.get(i).asJsonObject
                SearchHit(
                    name = o.str("name"), author = o.str("author"), bookUrl = o.str("bookUrl"),
                    intro = o.str("intro"), kind = o.str("kind"), lastChapter = o.str("lastChapter"),
                    origin = source.url, originName = source.name
                )
            }
        }
    }

    private fun openSelected() {
        val hit = resultList.selectedValue ?: return
        val sourceJson = app.store.loadSources().find { it.url == hit.origin }?.json ?: return
        app.execute(onDone = { res: Result<ShelfBook> ->
            res.fold(
                onSuccess = { book ->
                    app.store.addToShelf(book)
                    close(OK_EXIT_CODE)
                    app.controller.openBook(book)
                },
                onFailure = { setErrorText(it.message) }
            )
        }) {
            val tocUrl = try {
                app.rpc("getBookInfo", mapOf("source" to sourceJson, "bookUrl" to hit.bookUrl))
                    .getAsJsonObject("result")?.getAsJsonPrimitive("tocUrl")?.asString
            } catch (_: Exception) { null } ?: hit.bookUrl
            ShelfBook(
                bookUrl = hit.bookUrl, name = hit.name, author = hit.author,
                tocUrl = tocUrl, origin = hit.origin, originName = hit.originName
            )
        }
    }

    private fun com.google.gson.JsonObject.str(key: String): String =
        getAsJsonPrimitive(key)?.takeIf { it.isString }?.asString ?: ""
}
