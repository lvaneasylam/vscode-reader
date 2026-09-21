package com.chiang.novelreader.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/** 插件设置（外观/行为/登录字段/node 路径），持久化 IDE 全局 */
@State(name = "NovelReaderSettings", storages = [Storage("novel-reader.xml")])
class AppSettings : PersistentStateComponent<AppSettings> {

    var nodePath: String = ""
    var fontSize: Int = 15
    var lineHeight: Double = 1.9
    var contentWidth: Int = 0
    var fontFamily: String = ""
    var fontFile: String = ""
    var backgroundColor: String = ""
    var foregroundColor: String = ""
    var tokenFieldName: String = "token"
    var autoNextChapter: Boolean = true
    var statusBarWidth: Int = 80
    var contentCacheSize: Int = 20
    var preloadChapters: Int = 3
    var requestTimeoutMs: Int = 15000
    /** 按书源名分组的登录凭据（loginUi 表单字段） */
    var loginInfo: MutableMap<String, MutableMap<String, String>> = mutableMapOf()

    override fun getState(): AppSettings = this
    override fun loadState(state: AppSettings) {
        nodePath = state.nodePath
        fontSize = state.fontSize
        lineHeight = state.lineHeight
        contentWidth = state.contentWidth
        fontFamily = state.fontFamily
        fontFile = state.fontFile
        backgroundColor = state.backgroundColor
        foregroundColor = state.foregroundColor
        tokenFieldName = state.tokenFieldName
        autoNextChapter = state.autoNextChapter
        statusBarWidth = state.statusBarWidth
        contentCacheSize = state.contentCacheSize
        preloadChapters = state.preloadChapters
        requestTimeoutMs = state.requestTimeoutMs
        loginInfo = state.loginInfo
    }

    companion object {
        val instance: AppSettings
            get() = ApplicationManager.getApplication().getService(AppSettings::class.java)
    }
}
