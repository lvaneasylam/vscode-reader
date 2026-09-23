package com.chiang.novelreader.settings

import com.chiang.novelreader.NovelApp
import com.intellij.ui.components.JBTextField
import com.intellij.ui.dsl.builder.panel
import javax.swing.JComponent

/** 设置页：外观/行为/登录/运行时（文本字段手动绑定，apply 显式回写） */
class AppSettingsConfigurable : com.intellij.openapi.options.SearchableConfigurable {
    private val s = AppSettings.instance

    private val fontSize = JBTextField()
    private val lineHeight = JBTextField()
    private val contentWidth = JBTextField()
    private val fontFamily = JBTextField()
    private val fontFile = JBTextField()
    private val background = JBTextField()
    private val foreground = JBTextField()
    private val tokenField = JBTextField()
    private val statusBarWidth = JBTextField()
    private val cacheSize = JBTextField()
    private val preload = JBTextField()
    private val autoNext = com.intellij.ui.components.JBCheckBox()
    private val insecureTls = com.intellij.ui.components.JBCheckBox()
    private val timeoutMs = JBTextField()
    private val nodePath = JBTextField()

    override fun getId() = "com.chiang.novelreader.settings"
    override fun getDisplayName() = "墨遥·阅山行"

    override fun createComponent(): JComponent {
        // 装载当前值
        fontSize.text = s.fontSize.toString()
        lineHeight.text = s.lineHeight.toString()
        contentWidth.text = s.contentWidth.toString()
        fontFamily.text = s.fontFamily
        fontFile.text = s.fontFile
        background.text = s.backgroundColor
        foreground.text = s.foregroundColor
        tokenField.text = s.tokenFieldName
        statusBarWidth.text = s.statusBarWidth.toString()
        cacheSize.text = s.contentCacheSize.toString()
        preload.text = s.preloadChapters.toString()
        autoNext.isSelected = s.autoNextChapter
        insecureTls.isSelected = s.insecureTLS
        timeoutMs.text = s.requestTimeoutMs.toString()
        nodePath.text = s.nodePath

        return panel {
            group("阅读外观（工具窗）") {
                row("字号（px）：") { cell(fontSize) }
                row("行高（倍数，如 1.9）：") { cell(lineHeight) }
                row("正文宽度 px（0=撑满）：") { cell(contentWidth) }
                row("字体名（本机已装）：") { cell(fontFamily) }
                row("字体文件路径 .ttf/.otf/.woff2：") { cell(fontFile) }
                row("背景色（如 #f5f0e1，空=跟随主题）：") { cell(background) }
                row("文字色（空=跟随主题）：") { cell(foreground) }
            }
            group("阅读行为") {
                row("章末自动翻章：") { cell(autoNext) }
                row("状态栏显示宽度（半角字符数）：") { cell(statusBarWidth) }
                row("章节缓存数：") { cell(cacheSize) }
                row("向后预加载章节数（0=关）：") { cell(preload) }
            }
            group("登录与网络") {
                row("token 直登字段名：") { cell(tokenField) }
                row("书源请求超时（毫秒）：") { cell(timeoutMs) }
                row("信任所有 HTTPS 证书（兼容自签/旧 TLS 站点）：") { cell(insecureTls) }
            }
            group("运行时") {
                row("Node.js 路径（空=自动探测）：") { cell(nodePath) }
            }
        }
    }

    private fun txt(v: () -> String) = v().trim()

    override fun isModified(): Boolean =
        fontSize.text.trim() != s.fontSize.toString() ||
            lineHeight.text.trim() != s.lineHeight.toString() ||
            contentWidth.text.trim() != s.contentWidth.toString() ||
            fontFamily.text.trim() != s.fontFamily ||
            fontFile.text.trim() != s.fontFile ||
            background.text.trim() != s.backgroundColor ||
            foreground.text.trim() != s.foregroundColor ||
            tokenField.text.trim() != s.tokenFieldName ||
            statusBarWidth.text.trim() != s.statusBarWidth.toString() ||
            cacheSize.text.trim() != s.contentCacheSize.toString() ||
            preload.text.trim() != s.preloadChapters.toString() ||
            autoNext.isSelected != s.autoNextChapter ||
            insecureTls.isSelected != s.insecureTLS ||
            timeoutMs.text.trim() != s.requestTimeoutMs.toString() ||
            nodePath.text.trim() != s.nodePath

    override fun apply() {
        s.fontSize = fontSize.text.trim().toIntOrNull()?.coerceIn(10, 40) ?: s.fontSize
        s.lineHeight = lineHeight.text.trim().toDoubleOrNull()?.coerceIn(1.2, 3.0) ?: s.lineHeight
        s.contentWidth = contentWidth.text.trim().toIntOrNull()?.coerceAtLeast(0) ?: s.contentWidth
        s.fontFamily = fontFamily.text.trim()
        s.fontFile = fontFile.text.trim()
        s.backgroundColor = background.text.trim()
        s.foregroundColor = foreground.text.trim()
        s.tokenFieldName = tokenField.text.trim().ifEmpty { "token" }
        s.statusBarWidth = statusBarWidth.text.trim().toIntOrNull()?.coerceIn(20, 300) ?: s.statusBarWidth
        s.contentCacheSize = cacheSize.text.trim().toIntOrNull()?.coerceIn(1, 200) ?: s.contentCacheSize
        s.preloadChapters = preload.text.trim().toIntOrNull()?.coerceIn(0, 20) ?: s.preloadChapters
        s.autoNextChapter = autoNext.isSelected
        val tlsChanged = insecureTls.isSelected != s.insecureTLS
        val timeoutChanged = (timeoutMs.text.trim().toIntOrNull() ?: s.requestTimeoutMs) != s.requestTimeoutMs
        s.insecureTLS = insecureTls.isSelected
        s.requestTimeoutMs = timeoutMs.text.trim().toIntOrNull()?.coerceIn(3000, 180000) ?: s.requestTimeoutMs
        s.nodePath = nodePath.text.trim()
        // 网络选项变化：后台下发 sidecar（运行时即时生效，无需重启 IDE）
        if (tlsChanged || timeoutChanged) {
            NovelApp.instance.execute({}) {
                NovelApp.instance.rpc(
                    "setOption",
                    mapOf("insecureTLS" to s.insecureTLS, "timeoutMs" to s.requestTimeoutMs)
                )
                null
            }
        }
    }
}
