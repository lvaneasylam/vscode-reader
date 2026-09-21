package com.chiang.novelreader.reader

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.data.Chapter
import com.chiang.novelreader.data.ShelfBook
import com.chiang.novelreader.settings.AppSettings
import java.util.LinkedList

/** 阅读状态机：书/章节/正文缓存 + 翻章翻行 + 显示净化（对齐 VSCode reader-controller） */
class ReaderController(private val app: NovelApp) {

    data class State(
        var book: ShelfBook? = null,
        var chapters: List<Chapter> = emptyList(),
        var chapterIndex: Int = -1,
        var content: String = "",
        var lines: List<String> = emptyList(),
        var lineIndex: Int = 0,
        var segIndex: Int = 0,
        var loading: Boolean = false,
        var error: String? = null
    )

    val state = State()
    private val listeners = mutableListOf<() -> Unit>()
    private val contentCache = LinkedHashMap<String, String>()
    private var preloadToken = 0

    fun onChange(listener: () -> Unit) {
        listeners.add(listener)
    }

    private fun fire() = listeners.forEach { it() }

    // ---------- 打开与跳转 ----------

    fun openBook(book: ShelfBook, jumpIndex: Int? = null) {
        state.book = book
        state.loading = true
        state.error = null
        fire()
        app.execute(
            onDone = { result: Result<Unit> ->
                state.loading = false
                result.fold(
                    onSuccess = {
                        val idx = jumpIndex?.coerceIn(0, state.chapters.size - 1)
                            ?: book.chapterIndex.coerceIn(0, state.chapters.size - 1)
                        loadChapter(idx)
                    },
                    onFailure = { state.error = it.message; fire() }
                )
            }
        ) {
            val cached = app.store.loadToc(book.bookUrl)
            state.chapters = if (cached.isNotEmpty()) cached else {
                val chapters = when {
                    // 本地 EPUB
                    book.origin == "local" -> {
                        val meta = app.rpc("readEpubMeta", mapOf("filePath" to book.bookUrl.removePrefix("epub://")))
                        val arr = meta.getAsJsonArray("result") ?: error("目录为空")
                        (0 until arr.size()).map { i ->
                            val o = arr.get(i).asJsonObject
                            Chapter(o.get("title").asString, o.get("href").asString, i)
                        }
                    }
                    else -> {
                        val source = app.sourceOf(book.origin) ?: error("书源不存在或已删除：${book.originName}")
                        val res = app.rpc(
                            "getChapterList",
                            mapOf("source" to source.json, "tocUrl" to book.tocUrl)
                        )
                        chaptersFrom(res)
                    }
                }
                if (chapters.isEmpty()) error("目录为空")
                app.store.saveToc(book.bookUrl, chapters)
                chapters
            }
            Result.success(Unit)
        }
    }

    private fun chaptersFrom(res: com.google.gson.JsonObject): List<Chapter> {
        val arr = res.getAsJsonArray("result") ?: return emptyList()
        return (0 until arr.size()).map { i ->
            val o = arr.get(i).asJsonObject
            Chapter(
                o.getAsJsonPrimitive("title")?.asString ?: "第${i + 1}节",
                o.getAsJsonPrimitive("url")?.asString ?: "",
                i
            )
        }
    }

    fun jumpTo(index: Int) {
        if (index < 0 || index >= state.chapters.size) return
        loadChapter(index)
    }

    fun nextChapter() = jumpTo(state.chapterIndex + 1)
    fun prevChapter() = jumpTo(state.chapterIndex - 1)

    private fun loadChapter(index: Int) {
        val book = state.book ?: return
        val chapter = state.chapters.getOrNull(index) ?: return
        val cached = contentCache.remove(chapter.url)
        state.loading = cached == null
        state.error = null
        if (cached != null) {
            contentCache[chapter.url] = cached // LRU touch
            applyContent(index, cached)
            return
        }
        fire()
        app.execute(onDone = { result: Result<String> ->
            result.fold(
                onSuccess = { content ->
                    contentCache[chapter.url] = content
                    trimCache()
                    applyContent(index, content)
                },
                onFailure = { state.loading = false; state.error = it.message; fire() }
            )
        }) {
            val content: String = when {
                book.origin == "local" -> app.rpc(
                    "readEpubChapter",
                    mapOf("filePath" to book.bookUrl.removePrefix("epub://"), "href" to chapter.url)
                ).getAsJsonPrimitive("result").asString
                else -> {
                    val source = app.sourceOf(book.origin) ?: error("书源不存在")
                    val next = state.chapters.getOrNull(index + 1)?.url
                    app.rpc(
                        "getContent",
                        mapOf("source" to source.json, "chapterUrl" to chapter.url, "nextChapterUrl" to next)
                    ).getAsJsonPrimitive("result").asString
                }
            }
            content
        }
    }

    private fun trimCache() {
        val limit = AppSettings.instance.contentCacheSize.coerceAtLeast(1)
        while (contentCache.size > limit) {
            val oldest = contentCache.keys.firstOrNull() ?: break
            contentCache.remove(oldest)
        }
    }

    private fun applyContent(index: Int, content: String) {
        state.chapterIndex = index
        state.content = content
        state.lines = displayLines(content)
        state.lineIndex = 0
        state.segIndex = 0
        state.loading = false
        state.book?.let { app.store.updateProgress(it.bookUrl, index, state.chapters.size) }
        fire()
        preloadAhead()
    }

    /** 向后预加载 N 章（LRU 保护在读章节） */
    private fun preloadAhead() {
        val n = AppSettings.instance.preloadChapters
        if (n <= 0) return
        val book = state.book ?: return
        val source = app.sourceOf(book.origin) ?: return
        val token = ++preloadToken
        app.execute(onDone = {}) {
            for (k in 1..n) {
                if (token != preloadToken) break
                val ch = state.chapters.getOrNull(state.chapterIndex + k) ?: continue
                if (contentCache.containsKey(ch.url)) continue
                try {
                    val next = state.chapters.getOrNull(state.chapterIndex + k + 1)?.url
                    val content = app.rpc(
                        "getContent",
                        mapOf("source" to source.json, "chapterUrl" to ch.url, "nextChapterUrl" to next)
                    ).getAsJsonPrimitive("result").asString
                    contentCache[ch.url] = content
                    // LRU 保护：重新激活当前章
                    val cur = state.chapters.getOrNull(state.chapterIndex)
                    if (cur != null && contentCache.containsKey(cur.url)) {
                        val c = contentCache.remove(cur.url)!!
                        contentCache[cur.url] = c
                    }
                    trimCache()
                } catch (_: Exception) {
                    /* 预取失败静默 */
                }
            }
            null
        }
    }

    // ---------- 翻行与显示 ----------

    fun nextLine() {
        if (currentSegments().let { state.segIndex < it.size - 1 }) {
            state.segIndex++
            fire()
            return
        }
        state.segIndex = 0
        if (state.lineIndex < state.lines.size - 1) {
            state.lineIndex++
            fire()
            return
        }
        if (AppSettings.instance.autoNextChapter && state.chapterIndex < state.chapters.size - 1) {
            loadChapter(state.chapterIndex + 1)
        }
    }

    fun prevLine() {
        if (state.segIndex > 0) {
            state.segIndex--
            fire()
            return
        }
        if (state.lineIndex > 0) {
            state.lineIndex--
            state.segIndex = currentSegments().size - 1
            fire()
            return
        }
        state.segIndex = 0
        if (AppSettings.instance.autoNextChapter && state.chapterIndex > 0) {
            loadChapter(state.chapterIndex - 1)
            // 章末定位：loadChapter 完成后由 UI 侧处理（简化：跳到下章首行）
        }
    }

    private fun currentSegments(): List<String> {
        val line = state.lines.getOrNull(state.lineIndex) ?: return emptyList()
        val maxW = AppSettings.instance.statusBarWidth
        val segs = wrapByDisplayWidth(line, maxW)
        return segs.ifEmpty { listOf(line) }
    }

    companion object {
        /** 显示净化：段评 data:image → 💬；机器载荷行隐藏（对齐 VSCode displayLines） */
        fun displayLines(content: String): List<String> = content
            .split('\n')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .map { it.replace(Regex("data:image/[^\\s\"']+"), "💬") }
            .filter { !Regex("^[A-Za-z0-9+/=]{40,}").containsMatchIn(it) }
            .map { line ->
                Regex("^(https?://[^,{\\s]+),\\s*\\{[\\s\\S]*$").find(line)?.let { "[[img:${it.groupValues[1]}]]" } ?: line
            }

        /** 长行按显示宽度切段（中文算 2），段尾 … 提示未完 */
        fun wrapByDisplayWidth(line: String, maxWidth: Int): List<String> {
            val segs = mutableListOf<StringBuilder>()
            var cur = StringBuilder()
            var w = 0
            for (ch in line) {
                val cw = if (ch.codePointAt(0) > 0xff) 2 else 1
                if (w + cw > maxWidth - 1 && cur.isNotEmpty()) {
                    cur.append('…')
                    segs.add(cur)
                    cur = StringBuilder()
                    w = 0
                }
                cur.append(ch)
                w += cw
            }
            if (cur.isNotEmpty()) segs.add(cur)
            return segs.map { it.toString() }.ifEmpty { listOf(line) }
        }
    }
}
