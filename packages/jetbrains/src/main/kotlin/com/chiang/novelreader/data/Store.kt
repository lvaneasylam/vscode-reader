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

    // ---------- 书源 ----------

    fun loadSources(): MutableList<SourceEntry> {
        val f = File(dir, "sources.json")
        if (!f.exists()) return mutableListOf()
        val text = f.readText()
        val arr = gson.fromJson(text, com.google.gson.JsonArray::class.java) ?: return mutableListOf()
        return arr.map { SourceEntry(it.asJsonObject) }.toMutableList()
    }

    fun saveSources(list: List<SourceEntry>) {
        val arr = com.google.gson.JsonArray()
        list.forEach { arr.add(it.json) }
        File(dir, "sources.json").writeText(gson.toJson(arr))
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

    // ---------- 书架 ----------

    fun loadShelf(): MutableList<ShelfBook> {
        val f = File(dir, "shelf.json")
        if (!f.exists()) return mutableListOf()
        val type = object : TypeToken<MutableList<ShelfBook>>() {}.type
        return gson.fromJson(f.readText(), type) ?: mutableListOf()
    }

    fun saveShelf(list: List<ShelfBook>) {
        File(dir, "shelf.json").writeText(gson.toJson(list))
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
        val f = File(dir, "toc.json")
        if (!f.exists()) return emptyList()
        val type = object : TypeToken<MutableMap<String, List<Chapter>>>() {}.type
        val map: MutableMap<String, List<Chapter>> = gson.fromJson(f.readText(), type) ?: return emptyList()
        return map[tocKey(bookUrl)] ?: emptyList()
    }

    fun saveToc(bookUrl: String, chapters: List<Chapter>) {
        val f = File(dir, "toc.json")
        val type = object : TypeToken<MutableMap<String, List<Chapter>>>() {}.type
        val map: MutableMap<String, List<Chapter>> =
            if (f.exists()) gson.fromJson(f.readText(), type) ?: mutableMapOf() else mutableMapOf()
        map[tocKey(bookUrl)] = chapters
        f.writeText(gson.toJson(map))
    }

    private fun tocKey(bookUrl: String): String =
        java.security.MessageDigest.getInstance("MD5").digest(bookUrl.toByteArray())
            .joinToString("") { "%02x".format(it) }
}
