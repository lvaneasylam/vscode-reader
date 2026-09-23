package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory

/** 工具窗：左侧「墨遥·阅山行」（书架树 + JCEF 阅读双 tab，书架在前） */
class NovelToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: com.intellij.openapi.project.Project, toolWindow: ToolWindow) {
        val app = NovelApp.instance
        val contentFactory = ContentFactory.getInstance()

        val reader = ReaderPanel(app)
        val shelf = ShelfPanel(app)
        // 打开书/章节时自动切到「阅读」tab
        shelf.onOpenBook = {
            toolWindow.contentManager.contents
                .firstOrNull { it.displayName == "阅读" }
                ?.let { toolWindow.contentManager.setSelectedContent(it, true) }
        }

        // 标题统一用插件名（新 UI 会把 toolWindow id 显示出来，这里显式覆盖）
        toolWindow.title = "墨遥·阅山行"
        toolWindow.stripeTitle = "墨遥·阅山行"

        // 书架在前（首个 content 为默认选中页），发现页第三
        toolWindow.contentManager.addContent(
            contentFactory.createContent(shelf, "书架", true)
        )
        toolWindow.contentManager.addContent(
            contentFactory.createContent(reader, "阅读", true)
        )
        toolWindow.contentManager.addContent(
            contentFactory.createContent(com.chiang.novelreader.ui.ExplorePanel(app), "发现", true)
        )

        // 工具栏动作：搜索 / 导入书源 / 导入 EPUB / 登录 / 老板键
        //（不手动展开 DefaultActionGroup——平台禁止 getChildren(null)）
        val am = ActionManager.getInstance()
        toolWindow.setTitleActions(
            listOfNotNull(
                am.getAction("NovelReader.Search"),
                com.chiang.novelreader.actions.ImportSourcesAction(),
                com.chiang.novelreader.actions.ImportEpubAction(),
                com.chiang.novelreader.actions.LoginAction(),
                am.getAction("NovelReader.BossKey")
            )
        )
    }
}
