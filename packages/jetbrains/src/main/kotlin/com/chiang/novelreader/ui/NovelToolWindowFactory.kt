package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/** 工具窗：左侧「墨遥·阅山行」（书架树 + JCEF 阅读双 tab） */
class NovelToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: com.intellij.openapi.project.Project, toolWindow: ToolWindow) {
        val app = NovelApp.instance
        val contentFactory = ContentFactory.getInstance()

        val reader = ReaderPanel(app)
        val shelf = ShelfPanel(app)

        toolWindow.contentManager.addContent(
            contentFactory.createContent(reader, "阅读", true)
        )
        toolWindow.contentManager.addContent(
            contentFactory.createContent(shelf, "书架", true)
        )

        // 工具栏动作：搜索 / 导入 EPUB / 登录 / 设置
        val group = DefaultActionGroup().apply {
            add(ActionManager.getInstance().getAction("NovelReader.Search"))
            add(com.chiang.novelreader.actions.ImportEpubAction())
            add(com.chiang.novelreader.actions.LoginAction())
            addSeparator()
            add(com.intellij.openapi.actionSystem.ActionManager.getInstance().getAction("NovelReader.BossKey"))
        }
        toolWindow.setTitleActions(group)
    }
}
