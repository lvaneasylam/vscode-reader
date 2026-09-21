package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.reader.ReaderController
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.impl.status.EditorBasedWidget
import java.awt.event.MouseEvent

/** 状态栏单行正文 widget（长行按宽度切段，点击弹章节跳转） */
class StatusWidgetFactory : com.intellij.openapi.wm.StatusBarWidgetFactory {
    override fun getId() = "NovelReaderStatus"
    override fun getDisplayName() = "墨遥·阅山行"
    override fun isAvailable(project: Project) = true
    override fun createWidget(project: Project): StatusBarWidget = NovelStatusWidget(project)
    override fun canBeEnabledOn(statusBar: StatusBar) = true
}

class NovelStatusWidget(project: Project) : EditorBasedWidget(project), StatusBarWidget.TextDisplay,
    com.intellij.openapi.wm.StatusBarWidget.Multiframe {

    private var currentText = "📖"

    init {
        NovelApp.instance.controller.onChange { update() }
    }

    override fun ID() = "NovelReaderStatus"
    override fun getText() = currentText
    override fun getTooltipText() = "墨遥·阅山行（Alt+↑/↓ 翻行，Alt+←/→ 翻章；点击选择章节）"

    override fun install(statusBar: StatusBar) = Unit
    override fun dispose() = Unit

    override fun copy() = NovelStatusWidget(project)

    private fun update() {
        val state: ReaderController.State = NovelApp.instance.controller.state
        currentText = when {
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
        myStatusBar?.updateWidget(ID())
    }

    override fun getClickConsumer(): java.awt.event.MouseListener = object : java.awt.event.MouseAdapter() {
        override fun mouseClicked(e: MouseEvent?) {
            val state = NovelApp.instance.controller.state
            if (state.chapters.isNotEmpty()) {
                val names = state.chapters.map { it.title }.toTypedArray()
                val pick = com.intellij.openapi.ui.Messages.showEditableChooseInputDialog(
                    "", "跳转章节（可输入过滤）", "墨遥·阅山行", null, names, null
                )
                val idx = names.indexOfFirst { it == pick }
                if (idx >= 0) NovelApp.instance.controller.jumpTo(idx)
            }
        }
    }
}
