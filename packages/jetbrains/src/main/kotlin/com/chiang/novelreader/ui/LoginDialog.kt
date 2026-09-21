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
        tabbed.addTab("token 直登", JPanel(BorderLayout(6, 6)).apply {
            add(JPanel(BorderLayout(6, 6)).apply {
                add(JLabel("token（可带 字段名= 前缀）："), BorderLayout.NORTH)
                add(tokenField, BorderLayout.CENTER)
            }, BorderLayout.CENTER)
            add(JLabel("默认写入字段 ${AppSettings.instance.tokenFieldName}=（设置可改）"), BorderLayout.SOUTH)
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

        app.execute(onDone = { res: Result<Pair<Boolean, String>> ->
            val (ok, msg) = res.getOrElse { false to (it.message ?: "失败") }
            done(ok, msg)
        }) {
            val srcJson = source.json
            // 通道判定：token > cookie > 账号表单
            when {
                token.isNotEmpty() -> {
                    val m = Regex("^([A-Za-z_][A-Za-z0-9_-]*)=(.+)$").find(token)
                    val field = m?.groupValues?.get(1) ?: AppSettings.instance.tokenFieldName
                    val value = m?.groupValues?.get(2) ?: token
                    val pair = "$field=$value"
                    val probe =
                        "typeof setAllCookies === 'function' ? (setAllCookies(${gson.toJson(pair)}), 'ok') : 'nofn'"
                    val out = app.rpc("runJs", mapOf("source" to srcJson, "code" to probe))
                        .getAsJsonPrimitive("result")?.takeIf { it.isString }?.asString
                    if (out == "ok") {
                        app.rpc("flush", mapOf("source" to srcJson))
                        true to "✅ token 已写入全部线路（字段 $field）"
                    } else {
                        // 兜底：写源根域 cookieJar
                        val url = srcJson.getAsJsonPrimitive("bookSourceUrl").asString
                        app.rpc(
                            "runJs",
                            mapOf("source" to srcJson, "code" to "java.setCookie(${gson.toJson(url)}, ${gson.toJson(pair)})")
                        )
                        app.rpc("flush", mapOf("source" to srcJson))
                        true to "token 已写入源根域（字段 $field）"
                    }
                }
                cookie.isNotEmpty() -> {
                    val url = srcJson.getAsJsonPrimitive("bookSourceUrl").asString
                    app.rpc(
                        "runJs",
                        mapOf("source" to srcJson, "code" to "java.setCookie(${gson.toJson(url)}, ${gson.toJson(cookie)})")
                    )
                    app.rpc("flush", mapOf("source" to srcJson))
                    true to "Cookie 已保存"
                }
                else -> {
                    if (account.isEmpty() || pwd.isEmpty()) {
                        return@execute false to "请输入账号密码（或用 token 直登）"
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
                    AppSettings.instance.loginInfo.getOrPut(source.name) { mutableMapOf() }[accKey] = account
                    (out == "true") to "登录返回：${(out ?: "").take(120)}"
                }
            }
        }
    }
}
