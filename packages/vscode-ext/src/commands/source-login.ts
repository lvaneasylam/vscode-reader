import * as vscode from 'vscode'
import type { BookSource } from 'book-source-engine'
import { createWebBook } from '../webbook-factory.js'
import { flushSourceState } from '../source-state.js'
import type { Store } from '../store.js'

interface LoginRow {
  name: string
  type?: string
  value?: string
  default?: string
  holder?: string
  option?: Array<{ value: string; name?: string }>
  action?: string
}

/** 独立命令入口：选源 → loginUi 表单登录 */
export async function pickAndLogin(store: Store): Promise<void> {
  const target = await pickSource(store)
  if (target) await sourceLogin(target, store)
}

/**
 * 书源登录（对齐 legado SourceLoginDialog）：直接渲染书源 loginUi 表单，
 * 提交执行 loginUrl 定义的 login()，登录态经 java.setCookie 进入请求 cookieJar。
 */
export async function sourceLogin(source: BookSource, store?: Store): Promise<void> {
  if (typeof source.loginUi !== 'string' || !source.loginUi.trim()) {
    void vscode.window.showInformationMessage(
      `书源 ${source.bookSourceName} 未提供登录表单（loginUi）`,
      'Cookie 管理'
    ).then(c => {
      if (c === 'Cookie 管理') void vscode.commands.executeCommand('novelReader.setSourceCookie')
    })
    return
  }
  await formLogin(source, store)
}

/** Cookie 管理（无 loginUi 源的兜底工具：粘贴/浏览器辅助/清除） */
export async function setSourceCookie(store: Store, source?: BookSource): Promise<void> {
  const target = source ?? (await pickSource(store))
  if (!target) return

  const actions: Array<{ label: string; action: 'set' | 'token' | 'open' | 'clear' }> = [
    { label: '$(key) 设置 Cookie（从浏览器复制粘贴）', action: 'set' },
    { label: '$(plug) 输入 token 登录（字段名可配，适用 token 型书源）', action: 'token' }
  ]
  if (target.loginUrl && /^https?:\/\//i.test(target.loginUrl.trim())) {
    actions.push({ label: '$(link) 打开登录页（浏览器）', action: 'open' })
  }
  actions.push({ label: '$(clear-all) 清除 Cookie', action: 'clear' })

  const pick = await vscode.window.showQuickPick(actions, {
    placeHolder: `${target.bookSourceName} Cookie 管理（当前：${target.headerMap.Cookie ? '已设置' : '未设置'}）`
  })
  if (!pick) return

  if (pick.action === 'token') {
    await tokenLogin(store, target)
    return
  }
  if (pick.action === 'open') {
    const url = toHttpUrl(String(target.loginUrl), target.bookSourceUrl)
    await vscode.env.openExternal(vscode.Uri.parse(url))
    return
  }
  if (pick.action === 'clear') {
    await updateCookie(store, target, undefined)
    void vscode.window.showInformationMessage(`已清除 ${target.bookSourceName} 的 Cookie`)
    return
  }

  const cookie = await vscode.window.showInputBox({
    prompt: '粘贴浏览器复制的 Cookie（整行 Cookie 请求头的值）',
    placeHolder: '例：uid=123; token=abcdef; session=...',
    ignoreFocusOut: true
  })
  if (cookie === undefined) return
  await updateCookie(store, target, cookie.trim() || undefined)
  void vscode.window.showInformationMessage(
    cookie.trim() ? `${target.bookSourceName} Cookie 已保存，后续请求将携带登录态` : '输入为空，Cookie 未修改'
  )
}

/**
 * token 直接登录（适用 token 型书源）：
 * cookie 字段名取自配置 novelReader.tokenFieldName（默认 token），输入 "字段名=值" 可临时覆盖。
 * 首选复用书源自己的 setAllCookies（它知道所有线路域名）；无此函数时兜底写源根域。
 * 成功后清除 headerMap.Cookie —— http 层已有 Cookie 会完全遮蔽 cookieJar（http.ts）。
 */
async function tokenLogin(store: Store, source: BookSource): Promise<void> {
  const defaultField = vscode.workspace
    .getConfiguration('novelReader')
    .get<string>('tokenFieldName')?.trim() || 'token'
  const input = await vscode.window.showInputBox({
    prompt: `粘贴登录 token（默认写入字段 ${defaultField}=；也可输入完整 "字段名=值"，从浏览器 Cookie 或其他设备获取）`,
    placeHolder: `例：${defaultField}=eyJhbGciOi…`,
    ignoreFocusOut: true
  })
  if (input === undefined) return
  // 输入形态 "字段名=值" 优先，否则用配置的字段名
  const m = /^([A-Za-z_][A-Za-z0-9_-]*)=(.+)$/.exec(input.trim())
  const field = m ? m[1] : defaultField
  const token = (m ? m[2] : input.trim()).trim()
  // 校验：防 Cookie 头注入（; 分隔多个 cookie）与格式污染
  if (token.length < 8 || /[;,\s\x00-\x1f]/.test(token) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field)) {
    void vscode.window.showErrorMessage('token 格式不合法（长度 ≥8 且不含空格/分号/逗号/控制字符）')
    return
  }
  const pair = `${field}=${token}`

  const wb = createWebBook(source)
  const via = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `正在写入 token（${source.bookSourceName}）…` },
    async () => {
      // 书源知道全部线路域名 → 优先复用其逻辑写 cookieJar
      const probe = `typeof setAllCookies === 'function' ? (setAllCookies(${JSON.stringify(
        pair
      )}), 'ok') : 'nofn'`
      try {
        const out = await wb.runJs(probe)
        if (out === 'nofn') {
          // 兜底：写源根域 cookieJar + headerMap（无线路概念的普通源）
          await wb.runJs(
            `java.setCookie(${JSON.stringify(source.bookSourceUrl)}, ${JSON.stringify(pair)})`
          )
          await updateCookie(store, source, pair)
          return 'fallback'
        }
        return 'all-cookies'
      } catch (e) {
        void vscode.window.showErrorMessage(`写入 token 失败：${(e as Error).message}`)
        return 'error'
      }
    }
  )
  if (via === 'error') return

  if (via === 'all-cookies') {
    // 清除手动 Cookie，避免遮蔽 cookieJar 中新写入的登录态
    await updateCookie(store, source, undefined)
  }
  await flushSourceState()

  // 有 getToken 的源回读验证
  const check = await wb.runJs("typeof getToken === 'function' ? String(getToken()) : ''")
  if (check && check !== 'null' && check.trim().length > 0) {
    void vscode.window.showInformationMessage(`✅ token 已生效（${check.slice(0, 8)}…），搜索/阅读即带登录态`)
  } else {
    void vscode.window.showInformationMessage('token 已写入，可搜索一本书验证登录态是否生效')
  }
}

/** loginUi 表单登录：按钮在前；账号密码取 VSCode 配置（无则首次输入并保存），登录全自动 */
async function formLogin(source: BookSource, store?: Store): Promise<void> {
  const wb = createWebBook(source)
  const rows = await resolveLoginUi(wb, String(source.loginUi ?? ''))
  if (!rows || rows.length === 0) {
    void vscode.window.showErrorMessage('loginUi 解析失败（非合法 JSON 数组）')
    return
  }

  const inputRows: LoginRow[] = []
  const buttons: Array<{ label: string; action: string }> = []
  for (const row of rows) {
    if (!row.name) continue
    const type = (row.type ?? 'text').toLowerCase()
    if (type === 'button' && row.action) {
      buttons.push({ label: row.name, action: row.action })
    } else if (isCredentialRow(row)) {
      // 只收集账号凭据（密码 + 账号类字段）；「来源/设置」类字段留空走书源默认
      inputRows.push(row)
    }
  }

  // 登录凭据：VSCode 配置（novelReader.loginInfo，按书源名分组）优先
  const saved = readSavedCredentials(source.bookSourceName)

  const doLogin = async (): Promise<void> => {
    let data = saved
    if (!data || Object.keys(data).length === 0) {
      // 首次：输入一次并保存到配置（书源内部从 loginInfo 读取，之后全自动）
      data = await collectInputs(inputRows, {})
      if (!data) return
      await saveCredentials(source.bookSourceName, data)
    }
    const out = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `正在登录 ${source.bookSourceName}…` },
      () => wb.runLogin(data!)
    )
    // 登录态写入共享 jar/源变量后立即落盘（不等防抖）
    void flushSourceState()
    const v = (out ?? '').trim()
    if (v === 'true') {
      void vscode.window.showInformationMessage(`登录完成：${source.bookSourceName}（登录态已生效）`)
    } else if (v === '' || v === 'undefined' || v === 'null' || v === 'false') {
      void vscode.window.showInformationMessage('登录请求已提交，结果以书源通知为准（失败时会有 💔 提示）')
    } else {
      void vscode.window.showWarningMessage(`登录返回：${v.slice(0, 150)}`)
    }
  }

  // 无输入字段且无按钮：直接登录
  if (buttons.length === 0 && (saved && Object.keys(saved).length > 0)) {
    await doLogin()
    return
  }

  while (true) {
    const items: Array<{ label: string; run: () => Promise<void> }> = []
    // 登录状态检查（书源 jsLib 的 getToken：长度 >10 视为已登录）
    items.push({
      label: '$(person) 查看登录状态',
      run: async () => {
        const token = (await wb.runJs('String(getToken())')) ?? ''
        if (token.trim().length > 10) {
          void vscode.window.showInformationMessage(
            `✅ 已登录（token: ${token.slice(0, 8)}…）。如需换号请先退出登录`
          )
        } else {
          void vscode.window.showWarningMessage(
            '❌ 未登录或登录已过期（token 为空）。请登录，并确认书源服务器可用'
          )
        }
      }
    })
    for (const b of buttons) {
      items.push({
        label: `$(symbol-method) ${b.label}`,
        run: async () => {
          if (/^https?:\/\//i.test(b.action.trim())) {
            await vscode.env.openExternal(vscode.Uri.parse(b.action.trim()))
            return
          }
          const out = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: `执行「${b.label}」…` },
            () => wb.runButtonAction(b.action, {})
          )
          // 按钮动作可能切换线路/写源变量，立即落盘
          void flushSourceState()
          void vscode.window.showInformationMessage(
            `「${b.label}」执行完成${out ? `：${out.slice(0, 120)}` : ''}`
          )
        }
      })
    }
    const hasSaved = saved && Object.keys(saved).length > 0
    items.push({
      label: hasSaved
        ? `$(play) 登录（用已保存的账号密码）`
        : `$(play) 登录（首次需输入账号密码，之后自动）`
    , run: doLogin })
    // Cookie 管理（含 token 直登）：限流/无法走登录接口时的替代通道
    if (store) {
      items.push({
        label: '$(key) Cookie 管理 / token 直登',
        run: async () => { await setSourceCookie(store, source) }
      })
    }
    items.push({ label: '$(close) 退出', run: async () => {} })

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: `${source.bookSourceName}（选择操作；切换线路/设置无需账号密码）`,
      ignoreFocusOut: true
    })
    if (!pick || pick.label.includes('退出')) return
    await pick.run()
  }
}

/** 账号凭据字段判定：密码类 + 名字含账号关键词的文本类 */
function isCredentialRow(row: LoginRow): boolean {
  const type = (row.type ?? 'text').toLowerCase()
  if (type === 'password') return true
  if (type !== 'text') return false
  return /(邮|账|号|用户名|手机|user|account|email|mobile|login)/i.test(row.name)
}

/** 读取 VSCode 配置中该书源的登录凭据 */
function readSavedCredentials(sourceName: string): Record<string, string> | undefined {
  const all = vscode.workspace
    .getConfiguration('novelReader')
    .get<Record<string, Record<string, string>>>('loginInfo')
  return all?.[sourceName]
}

/** 保存登录凭据到 VSCode 用户配置（settings.json，可手动编辑） */
async function saveCredentials(sourceName: string, data: Record<string, string>): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration('novelReader')
  const all = { ...(cfg.get<Record<string, Record<string, string>>>('loginInfo') ?? {}) }
  all[sourceName] = data
  try {
    await cfg.update('loginInfo', all, vscode.ConfigurationTarget.Global)
    void vscode.window.showInformationMessage(
      `登录信息已保存到 VSCode 设置（novelReader.loginInfo → ${sourceName}），下次登录自动使用`
    )
    return true
  } catch (e) {
    // 典型场景：扩展宿主未重载（旧版配置表无此项）。本次登录不受影响，提示重载
    void vscode.window.showWarningMessage(
      `登录信息暂存于本次会话（写入设置失败：${(e as Error).message}）。执行「开发者: 重新加载窗口」后再次登录即可永久保存`
    )
    return false
  }
}

/** 收集输入字段（预填上次值）；取消返回 undefined */
async function collectInputs(rows: LoginRow[], preset: Record<string, string>): Promise<Record<string, string> | undefined> {
  const data: Record<string, string> = {}
  for (const row of rows) {
    if (!row.name) continue
    const type = (row.type ?? 'text').toLowerCase()
    if (type === 'text' || type === 'password' || type === 'number') {
      const v = await vscode.window.showInputBox({
        prompt: row.name,
        value: preset[row.name] || row.value || row.default || '',
        placeHolder: row.holder ?? '',
        password: type === 'password',
        ignoreFocusOut: true
      })
      if (v === undefined) return undefined
      data[row.name] = v
    } else if (type === 'option' || type === 'selector') {
      const options = row.option ?? []
      if (options.length === 0) continue
      const pick = await vscode.window.showQuickPick(
        options.map(o => ({ label: o.name ?? o.value, value: o.value })),
        { placeHolder: row.name, ignoreFocusOut: true }
      )
      if (!pick) return undefined
      data[row.name] = pick.value
    }
  }
  return data
}

/** 解析 loginUi：JSON 数组字符串，或 @js:/<js> 动态生成 */
async function resolveLoginUi(wb: { runJs(code: string): Promise<string | null> }, loginUi: string): Promise<LoginRow[] | null> {
  const t = loginUi.trim()
  let json: string | null = null
  try {
    if (t.startsWith('@js:')) json = await wb.runJs(t.slice(4))
    else if (t.startsWith('<js>')) json = await wb.runJs(t.slice(4, t.lastIndexOf('<')))
    else json = t
  } catch {
    return null
  }
  if (!json) return null
  try {
    const rows: unknown = JSON.parse(json)
    return Array.isArray(rows) ? (rows as LoginRow[]) : null
  } catch {
    return null
  }
}

async function updateCookie(store: Store, source: BookSource, cookie: string | undefined): Promise<void> {
  const sources = store.getSources()
  const target = sources.find(s => s.bookSourceUrl === source.bookSourceUrl)
  if (!target) return
  if (cookie) target.headerMap = { ...target.headerMap, Cookie: cookie }
  else {
    const { Cookie: _drop, ...rest } = target.headerMap
    void _drop
    target.headerMap = rest
  }
  await store.saveSources(sources)
}

function toHttpUrl(loginUrl: string, baseUrl: string): string {
  try {
    return new URL(loginUrl, baseUrl).href
  } catch {
    return loginUrl
  }
}

async function pickSource(store: Store): Promise<BookSource | undefined> {
  const sources = store.getSources()
  if (sources.length === 0) {
    void vscode.window.showInformationMessage('还没有书源，请先导入')
    return undefined
  }
  const pick = await vscode.window.showQuickPick(
    sources.map(s => ({
      label: s.bookSourceName,
      detail: s.bookSourceUrl,
      source: s
    })),
    { placeHolder: '选择要管理登录的书源' }
  )
  return pick?.source
}
