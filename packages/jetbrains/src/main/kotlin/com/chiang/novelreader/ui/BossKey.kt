package com.chiang.novelreader.ui

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindowManager

/** 老板键：工具窗隐藏/恢复 + 状态栏 widget 同步隐藏 */
object BossKey {
    @JvmStatic
    var hidden = false
        private set

    private const val TOOL_WINDOW_ID = "墨遥·阅山行"

    fun toggle(project: Project?) {
        hidden = !hidden
        val tw = project?.let { ToolWindowManager.getInstance(it).getToolWindow(TOOL_WINDOW_ID) } ?: return
        if (hidden) {
            tw.hide(null)
        } else {
            tw.show(null)
        }
    }
}
