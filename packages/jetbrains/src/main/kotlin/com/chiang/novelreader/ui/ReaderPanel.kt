package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.openapi.application.ApplicationManager
import com.intellij.ui.jcef.JBCefBrowser
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefMessageRouterHandlerAdapter
import java.awt.BorderLayout
import java.util.concurrent.atomic.AtomicReference
import javax.swing.JComponent
import javax.swing.JPanel

/** JCEF 阅读面板：渲染 ReaderHtml，cefQuery 交互（翻章/翻行）回传 Kotlin */
class ReaderPanel(private val app: NovelApp) : JPanel(BorderLayout()) {
    private val browser: JBCefBrowser = JBCefBrowser()
    private var lastLineIndex = -1
    private var lastRenderedKey = ""
    private val imgCache = HashMap<String, String>()
    private val pendingSeg = AtomicReference<Pair<String, Runnable>?>>(null)

    init {
        add(browser.component, BorderLayout.CENTER)
        browser.jbCefClient.addMessageRouter(
            org.cef.browser.CefMessageRouter.create().apply {
                addHandler(object : CefMessageRouterHandlerAdapter() {
                    override fun onQuery(
                        browser: CefBrowser?, frame: CefFrame?, queryId: Long,
                        request: String, persistent: Boolean, callback: org.cef.callback.CefQueryCallback?
                    ): Boolean {
                        handleCommand(request)
                        callback?.success("")
                        return true
                    }
                })
            }
        )
        app.controller.onChange { render() }
        render()
    }

    private fun handleCommand(cmd: String) {
        ApplicationManager.getApplication().invokeLater {
            when (cmd) {
                "prev" -> app.controller.prevChapter()
                "next" -> app.controller.nextChapter()
                "nextLine" -> app.controller.nextLine()
                "prevLine" -> app.controller.prevLine()
            }
        }
    }

    fun render() {
        val state = app.controller.state
        val key = "${state.book?.bookUrl}|${state.chapterIndex}|${state.loading}|${state.error}|${state.content.length}"
        if (key != lastRenderedKey) {
            lastRenderedKey = key
            lastLineIndex = state.lineIndex
            // 段评图代理拉取（对齐 VSCode 两段式：先渲染，图到后补）
            val imgMarks = state.lines.mapNotNull { l ->
                Regex("^\\[\\[img:(https?://[^\\]]+)\\]\\]$").find(l)?.groupValues?.get(1)
            }
            browser.loadHTML(ReaderHtml.render(state))
            if (imgMarks.isNotEmpty()) {
                app.execute(onDone = { res: Result<Map<String, String>> ->
                    res.getOrNull()?.let { cache ->
                        imgCache.putAll(cache)
                        browser.loadHTML(ReaderHtml.render(state, imgCache))
                    }
                }) {
                    val out = HashMap<String, String>()
                    for (url in imgMarks) {
                        try {
                            val body = app.rpc("runJs", mapOf("code" to "java.ajax(${com.google.gson.Gson().toJson(url)})"))
                                .getAsJsonPrimitive("result")?.asString
                            if (!body.isNullOrEmpty() && body.trimStart().startsWith("<")) {
                                out[url] = "data:image/svg+xml;base64," +
                                    java.util.Base64.getEncoder().encodeToString(body.toByteArray())
                            }
                        } catch (_: Exception) { /* 失败回退 💬 */ }
                    }
                    out
                }
            }
            return
        }
        // 仅翻行：JS 端移动高亮并滚动
        val dir = if (state.lineIndex >= lastLineIndex) "down" else "up"
        lastLineIndex = state.lineIndex
        browser.getCefBrowser().executeJavaScript(
            "setCur(${state.lineIndex}, '$dir')", browser.getCefBrowser().url, 0
        )
    }
}
