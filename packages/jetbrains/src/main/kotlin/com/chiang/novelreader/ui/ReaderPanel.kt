package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.ui.jcef.JBCefBrowser
import javax.swing.JPanel
import java.awt.BorderLayout

/**
 * JCEF 阅读面板：渲染 ReaderHtml。面板内 JS 的翻章/翻行请求经 IDE 快捷键
 * （AnAction，plugin.xml alt+方向键）完成——cefQuery 路由 M2 接入。
 */
class ReaderPanel(private val app: NovelApp) : JPanel(BorderLayout()) {
    private val browser: JBCefBrowser = JBCefBrowser()
    private var lastRenderedKey = ""
    private val imgCache = HashMap<String, String>()

    init {
        add(browser.component, BorderLayout.CENTER)
        app.controller.onChange { render() }
        render()
    }

    fun render() {
        val state = app.controller.state
        val key = "${state.book?.bookUrl}|${state.chapterIndex}|${state.loading}|${state.error}|${state.content.length}"
        if (key == lastRenderedKey) return
        lastRenderedKey = key
        browser.loadHTML(ReaderHtml.render(state))
        // 段评图代理：两段式（先渲染占位，图到后补渲）
        val imgMarks = state.lines.mapNotNull { l ->
            Regex("^\\[\\[img:(https?://[^\\]]+)\\]\\]$").find(l)?.groupValues?.get(1)
        }.distinct()
        if (imgMarks.isNotEmpty()) {
            app.execute(onDone = { res: Result<Map<String, String>> ->
                res.getOrNull()?.takeIf { it.isNotEmpty() }?.let { cache ->
                    imgCache.putAll(cache)
                    browser.loadHTML(ReaderHtml.render(state, imgCache))
                }
            }) {
                val out = HashMap<String, String>()
                val book = state.book ?: return@execute out
                val source = app.sourceOf(book.origin) ?: return@execute out
                for (url in imgMarks) {
                    try {
                        val code = "java.ajax(${com.google.gson.Gson().toJson(url)})"
                        val body = app.rpc("runJs", mapOf("source" to source.json, "code" to code))
                            .getAsJsonPrimitive("result")?.takeIf { it.isString }?.asString
                        if (!body.isNullOrEmpty() && body.trimStart().startsWith("<")) {
                            out[url] = "data:image/svg+xml;base64," +
                                java.util.Base64.getEncoder().encodeToString(body.toByteArray())
                        }
                    } catch (_: Exception) { /* 失败回退 💬 */ }
                }
                out
            }
        }
    }
}
