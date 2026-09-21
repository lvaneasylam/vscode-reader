package com.chiang.novelreader.data

import com.google.gson.JsonObject

/** UI 侧轻模型；书源对象以 JsonObject 透明传递给 sidecar（结构由 engine 定义） */
data class ShelfBook(
    var bookUrl: String = "",
    var name: String = "",
    var author: String = "佚名",
    var tocUrl: String = "",
    /** 书源地址；本地 EPUB 为 "local"（bookUrl = epub://绝对路径） */
    var origin: String = "",
    var originName: String = "",
    var chapterIndex: Int = 0,
    var chapterCount: Int = 0
)

data class Chapter(val title: String, val url: String, val index: Int)

data class SearchHit(
    val name: String,
    val author: String,
    val bookUrl: String,
    val intro: String = "",
    val kind: String = "",
    val lastChapter: String = "",
    val origin: String = "",
    val originName: String = ""
)

/** 侧栏书源条目（保留原 JsonObject 便于回传 sidecar） */
data class SourceEntry(val json: JsonObject) {
    val url: String get() = json.getAsJsonPrimitive("bookSourceUrl")?.asString ?: ""
    val name: String get() = json.getAsJsonPrimitive("bookSourceName")?.asString ?: url
    val enabled: Boolean get() = json.getAsJsonPrimitive("enabled")?.asBoolean ?: true
    val loginUi: String get() = json.getAsJsonPrimitive("loginUi")?.takeIf { it.isString }?.asString ?: ""
}
