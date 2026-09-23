package com.chiang.novelreader.sidecar

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.Logger
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/**
 * engine-sidecar 宿主：管理 Node 子进程（行协议 JSON-RPC），崩溃自动重启。
 * sidecar.cjs 从插件 jar 资源释放到插件数据目录后以 node 运行。
 */
class NodeSidecar private constructor() {
    private val log = Logger.getInstance(NodeSidecar::class.java)
    private val gson = Gson()
    private val pending = ConcurrentHashMap<Long, CompletableFuture<JsonObject>>()
    private val pendingEvents = mutableListOf<(String, String) -> Unit>()
    private val idSeq = AtomicLong(1)

    @Volatile private var process: Process? = null
    @Volatile private var writer: java.io.BufferedWriter? = null
    private val writeLock = Any()

    /** toast/log 事件订阅（UI 通知） */
    fun onEvent(handler: (event: String, data: String) -> Unit) {
        synchronized(pendingEvents) { pendingEvents.add(handler) }
    }

    private fun dataDir(): File =
        PathManager.getConfigDir().resolve("novel-reader").toFile().apply { mkdirs() }

    @Volatile private var cachedNode: String? = null

    /** Node 探测：设置项 → 常见安装位 → 版本管理器（nvmd/nvm）目录 → PATH。结果缓存（设置变更时失效） */
    @Volatile private var cachedNodeFromConfig = ""
    private fun nodeBinary(): String {
        val configured = com.chiang.novelreader.settings.AppSettings.instance.nodePath.trim()
        if (configured.isNotEmpty()) {
            if (File(configured).canExecute()) {
                cachedNode = configured
                cachedNodeFromConfig = configured
                return configured
            }
        } else if (cachedNodeFromConfig.isNotEmpty()) {
            // 用户清空了显式配置：作废缓存重新探测
            cachedNode = null
            cachedNodeFromConfig = ""
        }
        cachedNode?.let { return it }
        val home = System.getenv("HOME") ?: System.getProperty("user.home") ?: ""
        val fixed = listOf(
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/usr/bin/node",
            if (home.isNotEmpty()) "$home/.volta/bin/node" else "",
            if (home.isNotEmpty()) "$home/.fnm/current/bin/node" else ""
        ).firstOrNull { it.isNotEmpty() && File(it).canExecute() }
        if (fixed != null) {
            cachedNode = fixed
            return fixed
        }
        // 版本管理器目录：~/.nvmd/versions/<ver>/bin、~/.nvm/versions/node/<ver>/bin（取最大版本号）
        val versionRoots = listOf(
            if (home.isNotEmpty()) File(home, ".nvmd/versions") else null,
            if (home.isNotEmpty()) File(home, ".nvm/versions/node") else null
        ).filterNotNull()
        for (root in versionRoots) {
            val found = root.listFiles()
                ?.filter { it.isDirectory }
                ?.map { File(it, "bin/node") }
                ?.filter { it.canExecute() }
                ?.maxByOrNull { it.parentFile?.name ?: "" }
            if (found != null) {
                cachedNode = found.absolutePath
                return found.absolutePath
            }
        }
        val fromPath = System.getenv("PATH")?.split(':')?.firstNotNullOfOrNull { p ->
            File(p, "node").takeIf { it.canExecute() }?.absolutePath
        }
        if (fromPath != null) {
            cachedNode = fromPath
            return fromPath
        }
        return "node" // 交给 ensureProcess 包装成可读错误
    }

    private fun extractSidecar(): File {
        val out = File(dataDir(), "sidecar.cjs")
        val resource = javaClass.classLoader.getResourceAsStream("sidecar.cjs")
            ?: throw IllegalStateException("sidecar.cjs 未打包进插件资源")
        // 资源更新（插件升级）时覆盖：长度不同才重写，减少启动 IO
        val tmp = File(dataDir(), "sidecar.cjs.tmp")
        resource.use { input -> tmp.outputStream().use { input!!.copyTo(it) } }
        if (!out.exists() || out.length() != tmp.length()) {
            tmp.copyTo(out, overwrite = true)
        }
        tmp.delete()
        return out
    }

    @Synchronized
    private fun ensureProcess(): Process {
        process?.takeIf { it.isAlive }?.let { return it }
        val sidecarFile = extractSidecar()
        val node = nodeBinary()
        val pb = ProcessBuilder(
            node, sidecarFile.absolutePath,
            "--data-dir", dataDir().absolutePath,
            "--insecure-tls", if (com.chiang.novelreader.settings.AppSettings.instance.insecureTLS) "1" else "0",
            "--timeout-ms", com.chiang.novelreader.settings.AppSettings.instance.requestTimeoutMs.coerceAtLeast(3000).toString()
        )
        pb.redirectErrorStream(false)
        val proc = try {
            pb.start()
        } catch (e: Exception) {
            cachedNode = null
            throw IllegalStateException(
                "无法启动 Node.js（尝试路径：$node）。GUI 启动的 IDE 不继承终端 PATH，" +
                    "请在 设置 → 工具 → 墨遥·阅山行 显式配置 Node.js 路径（终端执行 which node 可得）",
                e
            )
        }
        writer = proc.outputStream.bufferedWriter()
        val readerThread = Thread({
            BufferedReader(InputStreamReader(proc.inputStream, Charsets.UTF_8)).useLines { lines ->
                lines.forEach { line ->
                    if (line.isBlank()) return@forEach
                    try {
                        val obj = gson.fromJson(line, JsonObject::class.java)
                        if (obj.has("id")) {
                            log.info("[sidecar] 响应行 id=${obj.get("id").asLong} ok=${obj.get("ok")?.asBoolean} 长度=${line.length}")
                            pending.remove(obj.get("id").asLong)?.complete(obj)
                                ?: log.warn("[sidecar] 响应无匹配请求: id=${obj.get("id").asLong}（pending=${pending.keys}）")
                        } else if (obj.has("event")) {
                            val ev = obj.get("event").asString
                            val data = obj.get("data")?.takeIf { it.isJsonPrimitive }?.asString ?: ""
                            synchronized(pendingEvents) { pendingEvents.toList() }.forEach { it(ev, data) }
                        }
                    } catch (e: Exception) {
                        log.warn("sidecar 行解析失败: ${line.take(120)}")
                    }
                }
            }
            // 流关闭（进程退出）：未完成请求全部失败
            pending.values.forEach { it.completeExceptionally(IllegalStateException("sidecar 进程退出")) }
            pending.clear()
        }, "novel-reader-sidecar-reader")
        readerThread.isDaemon = true
        readerThread.start()
        val errThread = Thread({
            BufferedReader(InputStreamReader(proc.errorStream, Charsets.UTF_8)).useLines { lines ->
                lines.forEach { log.warn("[sidecar:err] ${it.take(300)}") }
            }
        }, "novel-reader-sidecar-err")
        errThread.isDaemon = true
        errThread.start()
        process = proc
        log.info("sidecar 启动: pid=${proc.pid()} node=${nodeBinary()}")
        return proc
    }

    /** 发起 RPC 请求；首次调用启动 sidecar 进程，崩溃自动重启重试一次 */
    fun call(method: String, params: Map<String, Any?>): JsonObject {
        var firstError: Exception? = null
        repeat(2) { attempt ->
            try {
                ensureProcess() // 确保进程与 writer 就绪（此前漏接：writer 恒 null 导致「sidecar 未运行」）
                return callOnce(method, params)
            } catch (e: IllegalStateException) {
                firstError = e
                // 进程死亡：清理并让下次 ensureProcess 重启
                writer = null
                process?.destroyForcibly()
                process = null
                if (attempt == 1) throw e
            }
        }
        throw firstError ?: IllegalStateException("sidecar 调用失败")
    }

    private fun callOnce(method: String, params: Map<String, Any?>): JsonObject {
        val id = idSeq.getAndIncrement()
        val future = CompletableFuture<JsonObject>()
        pending[id] = future
        val req = gson.toJson(mapOf("id" to id, "method" to method, "params" to params))
        val t0 = System.currentTimeMillis()
        try {
            synchronized(writeLock) {
                val w = writer ?: throw IllegalStateException("sidecar 未运行")
                w.write(req)
                w.newLine()
                w.flush()
            }
        } catch (e: Exception) {
            pending.remove(id)
            throw IllegalStateException("sidecar 写入失败: ${e.message}")
        }
        log.info("[sidecar] → #$id $method (${req.length} 字节)")
        return try {
            val res = future.get(3, TimeUnit.MINUTES)
            log.info("[sidecar] ← #$id $method 耗时 ${System.currentTimeMillis() - t0}ms")
            res
        } catch (e: java.util.concurrent.TimeoutException) {
            // 超时是业务慢（慢书源），保持原样抛出：不触发 call() 的进程重启重试（避免 3min×2 卡死）
            pending.remove(id)
            log.warn("[sidecar] ✗ #$id $method 超时（3 分钟无响应；pending=${pending.size}）")
            throw RuntimeException("sidecar 响应超时: $method（书源过慢或网络不通）")
        }
    }

    fun shutdown() {
        process?.destroyForcibly()
        process = null
    }

    companion object {
        @Volatile private var instance: NodeSidecar? = null
        fun get(): NodeSidecar =
            instance ?: synchronized(this) { instance ?: NodeSidecar().also { instance = it } }
    }
}
