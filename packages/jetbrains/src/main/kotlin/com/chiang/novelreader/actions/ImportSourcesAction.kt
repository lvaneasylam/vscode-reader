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
class ImportSourcesAction : AnAction("导入书源", "导入书源 JSON（支持合集）", com.intellij.openapi.util.IconLoader.getIcon("/icons/importSources.svg", ImportSourcesAction::class.java)), DumbAware {
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
