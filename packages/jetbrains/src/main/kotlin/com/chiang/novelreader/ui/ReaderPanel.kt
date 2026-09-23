package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefJSQuery
import com.google.gson.Gson
import java.awt.BorderLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.JTextArea

/**
 * JCEF 阅读面板：渲染 ReaderHtml。页面内按钮/快捷键经 JBCefJSQuery 路由到 controller
 * （prev/next/nextLine/prevLine）——IDE keymap 冲突（alt+方向键）时的独立通道；
 * 翻行走 setCur 局部更新不重载页面；段评图补图走 replaceImg 局部替换（滚动位置不受影响）。
 * JCEF 不可用（JBR 无 CEF/远程开发）时降级为 Swing 只读文本面板。
 */
class ReaderPanel(private val app: NovelApp) : JPanel(BorderLayout()) {

    private val cefRenderer: CefHtmlRenderer? = if (JBCefApp.isSupported()) CefHtmlRenderer(app) else null
    private val fallback: FallbackTextPanel? = if (cefRenderer == null) FallbackTextPanel(app) else null

    init {
        cefRenderer?.let { add(it.component, BorderLayout.CENTER) }
        fallback?.let { add(it, BorderLayout.CENTER) }
        app.controller.onChange { render() }
        render()
    }

    fun render() {
        cefRenderer?.render()
        fallback?.render()
    }
    // 注意：不重写 removeNotify 去 dispose jsQuery——tab 切换/工具窗收起都会触发 removeNotify，
    // 提前 dispose 后再 render 会抛 "the JS query has been disposed"（双击章节跳转崩溃的根因）。
    // browser 生命周期归 content/component 树，工具窗销毁时统一回收。
}

private class CefHtmlRenderer(private val app: NovelApp) {

    val browser: JBCefBrowser = JBCefBrowser()

    /** 页面 → Kotlin 命令通道（IC 2023.3 API：JBCefJSQuery + inject 生成调用串） */
    private var jsQuery: JBCefJSQuery = createQuery()

    val component: JComponent = browser.component

    private var lastRenderedKey = ""
    private var lastLineIndex = 0
    private val imgCache = HashMap<String, String>()
    private val gson = Gson()

    private fun createQuery(): JBCefJSQuery =
        JBCefJSQuery.create(browser).also { q ->
            q.addHandler { req ->
                when {
                    req == "prev" -> app.controller.prevChapter()
                    req == "next" -> app.controller.nextChapter()
                    req == "nextLine" -> app.controller.nextLine()
                    req == "prevLine" -> app.controller.prevLine()
                    req.startsWith("jump:") -> req.removePrefix("jump:").toIntOrNull()
                        ?.let {
                            noScrollOnce = true  // 点击定位：仅切高亮不滚动
                            app.controller.jumpLine(it)
                        }
                    else -> return@addHandler null
                }
                JBCefJSQuery.Response("")
            }
        }

    /** 点击行定位只切高亮不滚动页面（Alt+↓ 翻行仍保留滚动跟随） */
    private var noScrollOnce = false

    /** inject 结果缓存（每 query 实例只生成一次；query 意外释放后不再重建——
     *  在已创建的 browser 上 JBCefJSQuery.create 会抛异常，此时交互命令退化 no-op，
     *  但内容渲染绝不能被打断） */
    private var cachedCalls: Map<String, String> = emptyMap()

    private fun calls(): Map<String, String> {
        if (cachedCalls.isNotEmpty()) return cachedCalls
        if (jsQuery.isDisposed) return emptyMap()
        return try {
            // inject 模板：window.<funcName>({request: '' + <参数表达式>, ...})
            // —— 参数是求值为字符串的表达式（不是函数体！传 return 会造成整页 JS 语法错误）
            cachedCalls = mapOf(
                "prev" to jsQuery.inject("'prev'"),
                "next" to jsQuery.inject("'next'"),
                "nextLine" to jsQuery.inject("'nextLine'"),
                "prevLine" to jsQuery.inject("'prevLine'"),
                "jump" to jsQuery.inject("'jump:' + jumpTarget")
            )
            cachedCalls
        } catch (_: Exception) {
            emptyMap()
        }
    }

    /** 结构不变时只执行 JS（setCur/replaceImg），避免整页重载丢滚动位置 */
    private fun execJs(js: String) {
        browser.cefBrowser.executeJavaScript(js, "reader", 0)
    }

    fun render() {
        val state = app.controller.state
        val key = "${state.book?.bookUrl}|${state.chapterIndex}|${state.loading}|${state.error}|${state.content.length}"
        if (key != lastRenderedKey) {
            lastRenderedKey = key
            lastLineIndex = state.lineIndex
            // 每个命令的调用串经 inject 生成一次后缓存（query 释放后调用串失效也不重来——
            // 见 calls() 注释）；jump 用闭包变量 jumpTarget 携带行号（inject 串静态、行号动态）
            val calls = calls()
            browser.loadHTML(ReaderHtml.render(state, imgCache, calls))
            fetchImages(state)
            return
        }
        // 仅翻行：JS 局部移动高亮并滚动跟随（点击定位时 noScroll，页面不动）
        if (state.lineIndex != lastLineIndex) {
            val dir = if (state.lineIndex >= lastLineIndex) "down" else "up"
            lastLineIndex = state.lineIndex
            val noScroll = noScrollOnce
            noScrollOnce = false
            execJs("setCur(${state.lineIndex}, '$dir', $noScroll)")
        }
    }

    /** 段评图代理：拉取完成后 replaceImg 局部替换占位（不整页重载，滚动位置不动） */
    private fun fetchImages(state: com.chiang.novelreader.reader.ReaderController.State) {
        val imgMarks = state.lines.mapNotNull { l ->
            Regex("^\\[\\[img:(https?://[^\\]]+)\\]\\]$").find(l)?.groupValues?.get(1)
        }.distinct().filter { it !in imgCache }
        if (imgMarks.isEmpty()) return
        app.execute(onDone = { res: Result<Map<String, String>> ->
            res.getOrNull()?.forEach { (url, dataUri) ->
                imgCache[url] = dataUri
                val u = gson.toJson(url)
                val s = gson.toJson(dataUri)
                execJs("replaceImg($u, $s)")
            }
        }) {
            val out = HashMap<String, String>()
            val book = state.book ?: return@execute out
            val source = app.sourceOf(book.origin) ?: return@execute out
            for (url in imgMarks) {
                try {
                    val code = "java.ajax(${gson.toJson(url)})"
                    val body = app.rpc("runJs", mapOf("source" to source.json, "code" to code))
                        .getAsJsonPrimitive("result")?.takeIf { it.isString }?.asString
                    if (!body.isNullOrEmpty() && body.trimStart().startsWith("<")) {
                        out[url] = "data:image/svg+xml;base64," +
                            java.util.Base64.getEncoder().encodeToString(body.toByteArray())
                    }
                } catch (_: Exception) { /* 失败保留 💬 占位 */ }
            }
            out
        }
    }
}

/** JCEF 不可用时的降级：只读文本面板（翻行同样跟随） */
private class FallbackTextPanel(private val app: NovelApp) : JTextArea() {
    init {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
    }

    fun render() {
        val state = app.controller.state
        text = when {
            state.error != null -> "⚠ ${state.error}"
            state.book == null ->
                "本 IDE 不支持内嵌浏览器（JCEF），已切换纯文本模式。\n工具栏「搜索书籍」或展开书架选书。"
            else -> buildString {
                appendLine(state.chapters.getOrNull(state.chapterIndex)?.title ?: "")
                appendLine()
                state.lines.forEachIndexed { i, line ->
                    appendLine(if (i == state.lineIndex) "▶ $line" else line)
                }
            }
        }
        caretPosition = 0
    }
}
