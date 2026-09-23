package com.chiang.novelreader.actions

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.data.SourceEntry
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptor
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.ui.Messages

/** 导入书源 JSON（文件选择，支持合集；与 VSCode 版 importSource 等价） */
class ImportSourcesAction : AnAction("导入书源（本地文件）", "导入书源 JSON（支持合集）", com.intellij.openapi.util.IconLoader.getIcon("/icons/importSources.svg", ImportSourcesAction::class.java)), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        val desc = FileChooserDescriptor(true, false, false, false, false, true)
            .withTitle("选择书源 JSON 文件（支持合集）")
            .withFileFilter { it.extension.equals("json", true) || it.extension.equals("txt", true) }
        FileChooser.chooseFiles(desc, e.project, null) { files ->
            if (files.isEmpty()) return@chooseFiles
            val app = NovelApp.instance
            app.execute(onDone = { res: Result<Triple<Int, Int, Int>> ->
                res.fold(
                    onSuccess = { r: Triple<Int, Int, Int> ->
                        val msg = buildString {
                            append("导入完成：新增 ${r.first}、更新 ${r.second}")
                            if (r.third > 0) append("、跳过非法 ${r.third}")
                        }
                        Messages.showInfoMessage(msg, "墨遥·阅山行")
                    },
                    onFailure = { Messages.showErrorDialog(it.message, "导入失败") }
                )
            }) {
                var added = 0
                var updated = 0
                var invalid = 0
                for (f in files) {
                    val text = String(f.contentsToByteArray(), Charsets.UTF_8)
                    val arr = app.rpc("parseSources", mapOf("text" to text)).getAsJsonArray("result")
                        ?: throw IllegalStateException("书源解析失败")
                    val entries = mutableListOf<SourceEntry>()
                    for (i in 0 until arr.size()) {
                        val o = arr.get(i).asJsonObject
                        val src = o.getAsJsonObject("source")
                        if (src == null) {
                            invalid++
                        } else {
                            entries.add(SourceEntry(src))
                        }
                    }
                    val merged = app.store.mergeSources(entries)
                    added += merged.first
                    updated += merged.second
                }
                Triple(added, updated, invalid)
            }
        }
    }
}

/** 导入书源（URL 下载合集；宿主直接 fetch，不依赖书源上下文——对齐 VSCode 版） */
class ImportSourcesFromUrlAction : AnAction("导入书源（URL）", "从 URL 下载书源合集 JSON", com.intellij.openapi.util.IconLoader.getIcon("/icons/importSources.svg", ImportSourcesAction::class.java)), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        val url = Messages.showInputDialog(e.project, "书源合集 URL", "导入书源（URL）", null)
        if (url.isNullOrBlank()) return
        val app = NovelApp.instance
        app.execute(onDone = { res: Result<Pair<Int, Int>> ->
            res.fold(
                onSuccess = { (added, updated) -> Messages.showInfoMessage("导入完成：新增 $added、更新 $updated", "墨遥·阅山行") },
                onFailure = { Messages.showErrorDialog(it.message, "导入失败") }
            )
        }) {
            val text = java.net.URI(url.trim()).toURL()
                .openConnection().let { conn ->
                    conn.connectTimeout = 15000
                    conn.readTimeout = 30000
                    conn.getInputStream().use { it.readBytes().toString(Charsets.UTF_8) }
                }
            mergeText(app, text)
        }
    }
}

/** 导入书源（剪贴板） */
class ImportSourcesFromClipboardAction : AnAction("导入书源（剪贴板）", "解析剪贴板中的书源 JSON", com.intellij.openapi.util.IconLoader.getIcon("/icons/importSources.svg", ImportSourcesAction::class.java)), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) {
        val app = NovelApp.instance
        app.execute(onDone = { res: Result<Pair<Int, Int>> ->
            res.fold(
                onSuccess = { (added, updated) -> Messages.showInfoMessage("导入完成：新增 $added、更新 $updated", "墨遥·阅山行") },
                onFailure = { Messages.showErrorDialog(it.message, "导入失败") }
            )
        }) {
            val contents = java.awt.Toolkit.getDefaultToolkit().systemClipboard.getContents(null)
            val text = contents?.getTransferData(java.awt.datatransfer.DataFlavor.stringFlavor) as? String
                ?: error("剪贴板没有文本内容")
            mergeText(app, text)
        }
    }
}

/** 书源文本 → parseSources → 合并入库，返回 (新增, 更新) */
private fun mergeText(app: NovelApp, text: String): Pair<Int, Int> {
    if (text.isBlank()) error("未获取到书源内容")
    val arr = app.rpc("parseSources", mapOf("text" to text)).getAsJsonArray("result")
        ?: throw IllegalStateException("未解析到有效书源")
    val entries = mutableListOf<SourceEntry>()
    for (i in 0 until arr.size()) {
        val src = arr.get(i).asJsonObject.getAsJsonObject("source") ?: continue
        entries.add(SourceEntry(src))
    }
    if (entries.isEmpty()) error("未解析到有效书源（JSON 非法或缺少 bookSourceUrl）")
    return app.store.mergeSources(entries)
}
