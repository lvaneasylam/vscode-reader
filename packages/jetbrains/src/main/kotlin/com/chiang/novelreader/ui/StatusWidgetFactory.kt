package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.reader.ReaderController
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.CustomStatusBarWidget
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import javax.swing.JLabel
import javax.swing.SwingUtilities
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent

/** 状态栏单行正文 widget（长行按宽度切段；点击弹章节跳转） */
class StatusWidgetFactory : StatusBarWidgetFactory {
    override fun getId() = "NovelReaderStatus"
    override fun getDisplayName() = "墨遥·阅山行"
    override fun isAvailable(project: Project) = true
    override fun canBeEnabledOn(statusBar: StatusBar) = true
    override fun createWidget(project: Project): StatusBarWidget = NovelStatusWidget()
}

class NovelStatusWidget : CustomStatusBarWidget {
    private val label = JLabel("📖").apply {
        toolTipText = "墨遥·阅山行（Alt+↑/↓ 翻行，Alt+←/→ 翻章；点击跳章节）"
        addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent?) {
                jumpChapter()
            }
        })
    }
    private var bar: StatusBar? = null

    init {
        NovelApp.instance.controller.onChange { update() }
    }

    override fun ID() = "NovelReaderStatus"
    override fun getComponent() = label
    override fun install(statusBar: StatusBar) {
        bar = statusBar
    }

    override fun dispose() = Unit

    private fun update() {
        val state: ReaderController.State = NovelApp.instance.controller.state
        val text = when {
            state.error != null -> "📖 ⚠"
            state.loading && state.content.isEmpty() -> "📖 ⌛"
            state.book == null -> "📖"
            else -> {
                val line = state.lines.getOrNull(state.lineIndex) ?: ""
                when {
                    line.startsWith("[[img:") -> "📖 💬 段评"
                    else -> {
                        val segs = ReaderController.wrapByDisplayWidth(
                            line, com.chiang.novelreader.settings.AppSettings.instance.statusBarWidth
                        )
                        "📖 " + segs.getOrNull(state.segIndex.coerceIn(0, segs.size - 1)).orEmpty()
                    }
                }
            }
        }
        SwingUtilities.invokeLater {
            label.text = text
            bar?.updateWidget(ID())
        }
    }

    private fun jumpChapter() {
        val state = NovelApp.instance.controller.state
        if (state.chapters.isEmpty()) return
        ChapterJumpDialog(state).show()
    }
}

/** 跳章对话框：输入过滤 + 列表选择（对齐 VSCode selectChapter） */
class ChapterJumpDialog(private val state: ReaderController.State) :
    com.intellij.openapi.ui.DialogWrapper(null as com.intellij.openapi.project.Project?) {

    private val input = com.intellij.ui.components.JBTextField().apply { emptyText.text = "输入关键字过滤章节" }
    private val listModel = com.intellij.ui.CollectionListModel(state.chapters.map { it.title })
    private val list = com.intellij.ui.components.JBList(listModel).apply {
        selectionMode = javax.swing.ListSelectionModel.SINGLE_SELECTION
        selectedIndex = state.chapterIndex.coerceAtLeast(0)
    }

    init {
        title = "跳转章节（${state.chapters.size} 章，当前 ${state.chapterIndex + 1}）"
        init()
        input.document.addDocumentListener(object : javax.swing.event.DocumentListener {
            override fun insertUpdate(e: javax.swing.event.DocumentEvent?) = refilter()
            override fun removeUpdate(e: javax.swing.event.DocumentEvent?) = refilter()
            override fun changedUpdate(e: javax.swing.event.DocumentEvent?) = refilter()
        })
    }

    private fun refilter() {
        val kw = input.text.trim()
        listModel.replaceAll(
            if (kw.isEmpty()) state.chapters.map { it.title }
            else state.chapters.map { it.title }.filter { it.contains(kw, ignoreCase = true) }
        )
        if (listModel.size > 0) list.selectedIndex = 0
    }

    override fun createCenterPanel() = javax.swing.JPanel(java.awt.BorderLayout(4, 4)).apply {
        preferredSize = java.awt.Dimension(480, 420)
        add(input, java.awt.BorderLayout.NORTH)
        add(com.intellij.ui.ScrollPaneFactory.createScrollPane(list), java.awt.BorderLayout.CENTER)
    }

    override fun doOKAction() {
        val title = list.selectedValue ?: return
        val idx = state.chapters.indexOfFirst { it.title == title }
        if (idx >= 0) {
            NovelApp.instance.controller.jumpTo(idx)
            close(OK_EXIT_CODE)
        }
    }
}
