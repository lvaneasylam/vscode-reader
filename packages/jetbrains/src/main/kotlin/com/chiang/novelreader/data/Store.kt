package com.chiang.novelreader.data

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.reflect.TypeToken
import com.intellij.openapi.application.PathManager
import java.io.File

/** 书源/书架/目录缓存的 JSON 持久化（插件数据目录，与 sidecar state.json 同级） */
class Store {
    private val gson = Gson()
    private val dir: File get() = PathManager.getConfigDir().resolve("novel-reader").toFile().apply { mkdirs() }

    /** 损坏 JSON 的读取保护：解析失败把文件改名为 *.corrupt 备份后返回 null（自愈，避免每次启动都崩） */
    private fun readJsonFile(name: String, parse: (String) -> Any?): Any? {
        val f = File(dir, name)
        if (!f.exists()) return null
        return try {
            f.readText().let { if (it.isBlank()) null else parse(it) }
        } catch (e: Exception) {
            val backup = File(dir, "$name.corrupt")
            f.copyTo(backup, overwrite = true)
            f.delete()
            null
        }
    }

    private fun writeJsonFile(name: String, json: String) {
        try {
            File(dir, name).writeText(json)
        } catch (_: Exception) { /* 写盘失败不致命（内存态仍有效） */ }
    }

    // ---------- 书源 ----------

    fun loadSources(): MutableList<SourceEntry> {
        @Suppress("UNCHECKED_CAST")
        val arr = readJsonFile("sources.json") {
            gson.fromJson(it, com.google.gson.JsonArray::class.java)
        } as? com.google.gson.JsonArray ?: return mutableListOf()
        return arr.map { SourceEntry(it.asJsonObject) }.toMutableList()
    }

    fun saveSources(list: List<SourceEntry>) {
        val arr = com.google.gson.JsonArray()
        list.forEach { arr.add(it.json) }
        writeJsonFile("sources.json", gson.toJson(arr))
    }

    /** 合并导入（按 bookSourceUrl 去重，更新计数） */
    fun mergeSources(incoming: List<SourceEntry>): Pair<Int, Int> {
        val existing = loadSources()
        val map = linkedMapOf<String, SourceEntry>()
        existing.forEach { map[it.url] = it }
        var added = 0
        var updated = 0
        incoming.forEach { e ->
            if (map.containsKey(e.url)) updated++ else added++
            map[e.url] = e
        }
        saveSources(map.values.toList())
        return added to updated
    }

    /** 清除指定书的目录缓存（「刷新目录」用，下次 openBook 重新请求） */
    fun clearToc(bookUrl: String) {
        val f = File(dir, "toc.json")
        if (!f.exists()) return
        val type = object : TypeToken<MutableMap<String, List<Chapter>>>() {}.type
        @Suppress("UNCHECKED_CAST")
        val map = (readJsonFile("toc.json") {
            gson.fromJson<MutableMap<String, List<Chapter>>>(it, type)
        } as? MutableMap<String, List<Chapter>>) ?: return
        map.remove(tocKey(bookUrl))
        try {
            f.writeText(gson.toJson(map))
        } catch (_: Exception) { /* 忽略 */ }
    }

    // ---------- 书架 ----------

    fun loadShelf(): MutableList<ShelfBook> {
        val type = object : TypeToken<MutableList<ShelfBook>>() {}.type
        @Suppress("UNCHECKED_CAST")
        return readJsonFile("shelf.json") { gson.fromJson<MutableList<ShelfBook>>(it, type) }
            as? MutableList<ShelfBook> ?: mutableListOf()
    }

    fun saveShelf(list: List<ShelfBook>) {
        writeJsonFile("shelf.json", gson.toJson(list))
    }

    fun addToShelf(book: ShelfBook) {
        val shelf = loadShelf().filter { it.bookUrl != book.bookUrl }.toMutableList()
        shelf.add(book)
        saveShelf(shelf)
    }

    fun removeFromShelf(bookUrl: String) {
        saveShelf(loadShelf().filter { it.bookUrl != bookUrl })
    }

    fun updateProgress(bookUrl: String, index: Int, count: Int) {
        val shelf = loadShelf()
        val book = shelf.find { it.bookUrl == bookUrl } ?: return
        book.chapterIndex = index
        book.chapterCount = count
        saveShelf(shelf)
    }

    // ---------- 目录缓存（bookUrl hash → 章节） ----------

    fun loadToc(bookUrl: String): List<Chapter> {
        val type = object : TypeToken<MutableMap<String, List<Chapter>>>() {}.type
        @Suppress("UNCHECKED_CAST")
        val map = readJsonFile("toc.json") {
            gson.fromJson<MutableMap<String, List<Chapter>>>(it, type)
        } as? Map<String, List<Chapter>> ?: return emptyList()
        return map[tocKey(bookUrl)] ?: emptyList()
    }

    fun saveToc(bookUrl: String, chapters: List<Chapter>) {
        val f = File(dir, "toc.json")
        val type = object : TypeToken<MutableMap<String, List<Chapter>>>() {}.type
        @Suppress("UNCHECKED_CAST")
        val map = (readJsonFile("toc.json") {
            gson.fromJson<MutableMap<String, List<Chapter>>>(it, type)
        } as? MutableMap<String, List<Chapter>>) ?: mutableMapOf()
        map[tocKey(bookUrl)] = chapters
        try {
            f.writeText(gson.toJson(map))
        } catch (_: Exception) { /* 写盘失败不致命 */ }
    }

    private fun tocKey(bookUrl: String): String =
        java.security.MessageDigest.getInstance("MD5").digest(bookUrl.toByteArray())
            .joinToString("") { "%02x".format(it) }
}
