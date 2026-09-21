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

    /** 后台执行（blocking lambda），完成后回 EDT（结果回调） */
    fun <T> execute(onDone: (Result<T>) -> Unit, block: () -> T) {
        pool.execute {
            val result = runCatching(block)
            ApplicationManager.getApplication().invokeLater { onDone(result) }
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

    companion object {
        val instance: NovelApp
            get() = ApplicationManager.getApplication().getService(NovelApp::class.java)
    }
}
