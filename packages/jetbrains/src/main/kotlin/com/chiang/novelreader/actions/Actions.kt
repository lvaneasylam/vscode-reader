package com.chiang.novelreader.actions

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.ui.LoginDialog
import com.chiang.novelreader.ui.SearchDialog
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages

/** 搜索书籍：选源 → 输关键字 → 结果 → 进书架并阅读 */
class SearchAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        SearchDialog(NovelApp.instance, e.project).show()
    }
}

/** 导入 EPUB */
class ImportEpubAction : AnAction("导入 EPUB"), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        val desc = FileChooserDescriptor(true, false, false, false, false, true)
            .withTitle("选择 EPUB 文件").withFileFilter { it.extension.equals("epub", true) }
        FileChooser.chooseFiles(desc, e.project, null) { files ->
            if (files.isEmpty()) return@chooseFiles
            val app = NovelApp.instance
            app.execute(onDone = { res: Result<Pair<Int, String> ->
                res.fold(onSuccess = {
                    Messages.showInfoMessage("已导入 ${it.first} 本 EPUB：${it.second}", "墨遥·阅山行")
                    app.controller.openBook(com.chiang.novelreader.data.ShelfBook(bookUrl = "epub://${files[0].path}", name = it.second, origin = "local", originName = "EPUB 本地书"))
                }, onFailure = { Messages.showErrorDialog(it.message, "导入失败") })
            }) {
                var added = 0
                var firstName = ""
                for (f in files) {
                    val meta = app.rpc("readEpubMeta", mapOf("filePath" to f.path))
                    val name = meta.getAsJsonObject("result").getAsJsonPrimitive("name").asString
                    val author = meta.getAsJsonObject("result").getAsJsonPrimitive("author").asString
                    val toc = meta.getAsJsonObject("result").getAsJsonArray("toc")
                    val chapters = (0 until toc.size()).map { i ->
                        val o = toc.get(i).asJsonObject
                        com.chiang.novelreader.data.Chapter(o.get("title").asString, o.get("href").asString, i)
                    }
                    val book = com.chiang.novelreader.data.ShelfBook(
                        bookUrl = "epub://${f.path}", name = name, author = author,
                        tocUrl = "epub", origin = "local", originName = "EPUB 本地书"
                    )
                    app.store.addToShelf(book)
                    app.store.saveToc(book.bookUrl, chapters)
                    added++
                    if (firstName.isEmpty()) firstName = name
                }
                added to firstName
            }
        }
    }
}

/** 书源登录（表单 / token 直登 / Cookie） */
class LoginAction : AnAction("书源登录"), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        LoginDialog(NovelApp.instance, e.project).show()
    }
}

/** 老板键：隐藏/恢复工具窗与状态栏 widget */
class BossKeyAction : AnAction("老板键（隐藏/恢复阅读）"), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        com.chiang.novelreader.ui.BossKey.toggle(e.project)
    }
}

class NextChapterAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) = NovelApp.instance.controller.nextChapter()
}

class PrevChapterAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) = NovelApp.instance.controller.prevChapter()
}

class NextLineAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) = NovelApp.instance.controller.nextLine()
}

class PrevLineAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) = NovelApp.instance.controller.prevLine()
}
