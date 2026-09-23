package com.chiang.novelreader

import com.chiang.novelreader.data.SourceEntry
import com.chiang.novelreader.data.Store
import com.chiang.novelreader.reader.ReaderController
import com.chiang.novelreader.sidecar.NodeSidecar
import com.google.gson.JsonObject
import com.intellij.openapi.application.ApplicationManager
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** 应用服务：sidecar RPC 封装 + 后台执行器 + 全局单例（Store/Controller） */
class NovelApp {
    val store = Store()
    val sidecar = NodeSidecar.get()
    val controller = ReaderController(this)

    private val pool: ExecutorService = Executors.newCachedThreadPool {
        Thread(it, "novel-reader-worker").apply { isDaemon = true }
    }

    /** 后台执行（blocking lambda），完成后回 EDT（结果回调）。
     *  ModalityState.any()：模态对话框（登录/搜索）打开期间回调也必须执行，
     *  否则 dialog 等回调恢复按钮、回调等 dialog 关闭——UI 层死锁（登录卡「执行中」根因）。 */
    fun <T> execute(onDone: (Result<T>) -> Unit, block: () -> T) {
        pool.execute {
            val result = runCatching(block)
            ApplicationManager.getApplication().invokeLater({ onDone(result) }, com.intellij.openapi.application.ModalityState.any())
        }
    }

    /** RPC：返回原始 JsonObject（含 ok/result/error 三态展开为异常） */
    fun rpc(method: String, params: Map<String, Any?> = emptyMap()): JsonObject {
        val res = sidecar.call(method, params)
        if (res.get("ok")?.asBoolean != true) {
            throw IllegalStateException(res.get("error")?.asString ?: "sidecar 调用失败")
        }
        return res
    }

    fun sourceOf(origin: String): SourceEntry? =
        store.loadSources().find { it.url == origin }

    /** 搜索/发现命中的书 → getBookInfo 补 tocUrl → 入书架 → EDT 上打开阅读 */
    fun addAndOpen(
        name: String, author: String, bookUrl: String,
        origin: String, originName: String,
        onDone: (Result<Unit>) -> Unit = {}
    ) {
        execute({ res: Result<com.chiang.novelreader.data.ShelfBook> ->
            res.fold(
                onSuccess = { book -> controller.openBook(book) },
                onFailure = {}
            )
            onDone(res.map { })
        }) {
            val source = sourceOf(origin) ?: error("书源不存在或已删除：$originName")
            val tocUrl = try {
                rpc("getBookInfo", mapOf("source" to source.json, "bookUrl" to bookUrl))
                    .getAsJsonObject("result")?.getAsJsonPrimitive("tocUrl")?.asString
            } catch (_: Exception) { null } ?: bookUrl
            val book = com.chiang.novelreader.data.ShelfBook(
                bookUrl = bookUrl, name = name, author = author,
                tocUrl = tocUrl, origin = origin, originName = originName
            )
            store.addToShelf(book)
            book
        }
    }

    companion object {
        val instance: NovelApp
            get() = ApplicationManager.getApplication().getService(NovelApp::class.java)
    }
}
