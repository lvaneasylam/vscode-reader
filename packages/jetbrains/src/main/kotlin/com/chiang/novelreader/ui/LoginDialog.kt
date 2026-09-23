package com.chiang.novelreader.ui

import com.chiang.novelreader.NovelApp
import com.chiang.novelreader.settings.AppSettings
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBPasswordField
import com.intellij.ui.components.JBTextField
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.GridLayout
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JComponent
import javax.swing.JTabbedPane

/**
 * 书源登录三通道（对齐 VSCode source-login）：
 * ① 账号表单（字段名按 loginUi 启发，凭据记忆） ② token 直登（字段名可配） ③ 手动 Cookie
 */
class LoginDialog(private val app: NovelApp, project: Project?) : DialogWrapper(project) {
    private val sources = app.store.loadSources()
    private val sourceBox = com.intellij.openapi.ui.ComboBox(sources.map { it.name }.toTypedArray())
    private val accountField = JBTextField()
    private val passwordField = JBPasswordField()
    private val tokenField = JBTextField()
    private val cookieField = JBTextField()
    private val gson = com.google.gson.Gson()

    init {
        title = "书源登录"
        init()
        if (sources.isEmpty()) {
            setErrorText("还没有书源")
            isOKActionEnabled = false
        }
    }

    private fun selectedSource() = sources.getOrNull(sourceBox.selectedIndex)

    override fun createCenterPanel(): JComponent = JPanel(BorderLayout(0, 8)).apply {
        preferredSize = Dimension(480, 280)
        add(sourceBox, BorderLayout.NORTH)
        val tabbed = JTabbedPane()
        tabbed.addTab("账号登录", JPanel(BorderLayout(6, 6)).apply {
            add(JPanel(GridLayout(2, 2, 6, 6)).apply {
                add(JLabel("账号（邮箱/用户名）：")); add(accountField)
                add(JLabel("密码：")); add(passwordField)
            }, BorderLayout.NORTH)
        })
        tabbed.addTab("凭据直登", JPanel(BorderLayout(6, 6)).apply {
            add(JPanel(BorderLayout(6, 6)).apply {
                add(JLabel("凭据（多字段分号分隔：token=…; uid=…; session=…）："), BorderLayout.NORTH)
                add(tokenField, BorderLayout.CENTER)
            }, BorderLayout.CENTER)
            add(JLabel("不带字段名的值写入默认字段 ${AppSettings.instance.tokenFieldName}=（设置可改）"), BorderLayout.SOUTH)
        })
        tabbed.addTab("Cookie", JPanel(BorderLayout(6, 6)).apply {
            add(JLabel("粘贴浏览器整行 Cookie："), BorderLayout.NORTH)
            add(cookieField, BorderLayout.CENTER)
        })
        add(tabbed, BorderLayout.CENTER)
        // 预填已存凭据
        selectedSource()?.name?.let { name ->
            AppSettings.instance.loginInfo[name]?.let { saved ->
                saved.entries.firstOrNull { it.key.contains("邮") || it.key.contains("账") || it.key.contains("user") }
                    ?.let { accountField.text = it.value }
            }
        }
    }

    override fun doOKAction() {
        val source = selectedSource() ?: return
        isOKActionEnabled = false
        setOKButtonText("执行中…")

        fun done(ok: Boolean, msg: String) {
            setOKButtonText("登录")
            isOKActionEnabled = true
            if (ok) {
                com.intellij.openapi.ui.Messages.showInfoMessage(msg, "墨遥·阅山行")
                close(OK_EXIT_CODE)
            } else setErrorText(msg)
        }

        val token = tokenField.text.trim()
        val cookie = cookieField.text.trim()
        val account = accountField.text.trim()
        val pwd = String(passwordField.password)

        app.execute(onDone = { res: Result<Triple<Boolean, String, String?>> ->
            val (ok, msg, accKey) = res.getOrElse { Triple(false, it.message ?: "失败", null) }
            // 凭据记忆回 EDT 写（PersistentStateComponent 不应在后台线程改）
            if (accKey != null) {
                AppSettings.instance.loginInfo.getOrPut(source.name) { mutableMapOf() }[accKey] = account
            }
            done(ok, msg)
        }) {
            val srcJson = source.json
            // 通道判定：token > cookie > 账号表单
            when {
                token.isNotEmpty() -> {
                    // 多字段凭据：分号分隔多组「字段名=值」，裸值写入配置的默认字段
                    val defaultField = AppSettings.instance.tokenFieldName
                    val pairs = token.split(';').map { it.trim() }.filter { it.isNotEmpty() }.mapNotNull { part ->
                        val m = Regex("^([A-Za-z_][A-Za-z0-9_-]*)=(.+)$").find(part)
                        val f = m?.groupValues?.get(1) ?: defaultField
                        val v = (m?.groupValues?.get(2) ?: part).trim()
                        if (v.length < 8 || Regex("[;,\\s\\x00-\\x1f]").containsMatchIn(v) ||
                            !Regex("^[A-Za-z_][A-Za-z0-9_-]*$").matches(f)
                        ) error("字段 $f 的值不合法（长度 ≥8 且不含空格/分号/逗号）")
                        f to v
                    }.distinctBy { it.first }
                    if (pairs.isEmpty()) return@execute Triple(false, "未解析到凭据字段", null)
                    val pair = pairs.joinToString("; ") { "${it.first}=${it.second}" }
                    val probe =
                        "typeof setAllCookies === 'function' ? (setAllCookies(${gson.toJson(pair)}), 'ok') : 'nofn'"
                    val out = app.rpc("runJs", mapOf("source" to srcJson, "code" to probe))
                        .getAsJsonPrimitive("result")?.takeIf { it.isString }?.asString
                    if (out == "ok") {
                        app.rpc("flush", mapOf("source" to srcJson))
                        Triple(true, "✅ 凭据已写入全部线路（${pairs.size} 个字段）", null)
                    } else {
                        // 兜底：写源根域 cookieJar
                        val url = srcJson.getAsJsonPrimitive("bookSourceUrl").asString
                        app.rpc(
                            "runJs",
                            mapOf("source" to srcJson, "code" to "java.setCookie(${gson.toJson(url)}, ${gson.toJson(pair)})")
                        )
                        app.rpc("flush", mapOf("source" to srcJson))
                        Triple(true, "凭据已写入源根域（${pairs.size} 个字段）", null)
                    }
                }
                cookie.isNotEmpty() -> {
                    val url = srcJson.getAsJsonPrimitive("bookSourceUrl").asString
                    app.rpc(
                        "runJs",
                        mapOf("source" to srcJson, "code" to "java.setCookie(${gson.toJson(url)}, ${gson.toJson(cookie)})")
                    )
                    app.rpc("flush", mapOf("source" to srcJson))
                    Triple(true, "Cookie 已保存", null)
                }
                else -> {
                    if (account.isEmpty() || pwd.isEmpty()) {
                        return@execute Triple(false, "请输入账号密码（或用 token 直登）", null)
                    }
                    // loginUi 字段名启发（邮箱/账号 → 账号键；密码 → 密码键）
                    val fields = app.rpc("getLoginUi", mapOf("source" to srcJson))
                        .getAsJsonPrimitive("result")?.takeIf { it.isString }?.asString ?: ""
                    val accKey = Regex("\"name\"\\s*:\\s*\"([^\"]*(?:邮|账|号|用户|user|email)[^\"]*)\"")
                        .find(fields)?.groupValues?.get(1) ?: "账号"
                    val pwdKey = Regex("\"name\"\\s*:\\s*\"([^\"]*(?:密码|pass)[^\"]*)\"")
                        .find(fields)?.groupValues?.get(1) ?: "密码"
                    val out = app.rpc(
                        "runLogin",
                        mapOf("source" to srcJson, "data" to mapOf(accKey to account, pwdKey to pwd))
                    ).getAsJsonPrimitive("result")?.takeIf { it.isString }?.asString
                    Triple(out == "true", "登录返回：${(out ?: "").take(120)}", accKey)
                }
            }
        }
    }
}
