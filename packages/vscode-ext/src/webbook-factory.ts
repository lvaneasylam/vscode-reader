import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { WebBook, type BookSource } from 'book-source-engine'
import { sourceStateOf } from './source-state.js'

/** 诊断日志通道（输出面板 → 墨遥·阅山行；java.log 与引擎告警汇入此处） */
let logChannel: vscode.OutputChannel | undefined
export function getLogChannel(): vscode.OutputChannel {
  if (!logChannel) logChannel = vscode.window.createOutputChannel('墨遥·阅山行')
  return logChannel
}

const DEBUG_FILE = path.join(os.tmpdir(), 'novel-reader-debug.log')
/** 调试日志：落盘 /tmp/novel-reader-debug.log（console.* 在扩展宿主不落盘，排障用） */
export function debugLog(msg: string): void {
  const line = `${new Date().toISOString().slice(11, 23)} ${msg}\n`
  try {
    fs.appendFileSync(DEBUG_FILE, line)
  } catch {
    /* 磁盘异常忽略，不影响功能 */
  }
}

/** 统一从插件配置构造 WebBook（超时 / TLS / 桌面端 UI 桥；注入跨实例共享的 cookie/源变量） */
export function createWebBook(source: BookSource, overrides: { timeoutMs?: number } = {}): WebBook {
  const cfg = vscode.workspace.getConfiguration('novelReader')
  const state = sourceStateOf(source)
  return new WebBook(source, {
    timeoutMs: overrides.timeoutMs ?? cfg.get<number>('requestTimeoutMs') ?? 15000,
    insecureTLS: cfg.get<boolean>('insecureTLS') ?? true,
    cookieJar: state.cookieJar,
    sourceVariables: state.variables,
    // 双写：输出面板（用户可见）+ 落盘文件（排障，console.* 在扩展宿主不落盘）
    log: msg => {
      getLogChannel().appendLine(msg)
      debugLog(msg)
    },
    // java.toast/longToast → IDE 通知（fire-and-forget，不阻塞书源脚本）
    toast: (msg, _long) => {
      void vscode.window.showInformationMessage(
        msg.length > 300 ? `${msg.slice(0, 300)}…` : msg,
        '复制全文'
      ).then(choice => {
        if (choice === '复制全文') void vscode.env.clipboard.writeText(msg)
      })
    },
    // java.startBrowser(Await) → 系统浏览器；data: URL（书源生成的设置页/验证页）落临时文件后打开
    openExternal: url => {
      void openUrlSmart(url)
    }
  })
}

async function openUrlSmart(url: string): Promise<void> {
  if (url.startsWith('data:')) {
    try {
      const m = /^data:([^;,]*)?[^,]*,(.*)$/s.exec(url)
      const isBase64 = /;base64/i.test(url)
      const mime = m?.[1] || 'text/html'
      const ext = mime.includes('html') ? '.html' : mime.includes('png') ? '.png' : '.txt'
      const raw = m?.[2] ?? ''
      const content = isBase64 ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw), 'utf-8')
      const { writeFile } = await import('node:fs/promises')
      const os = await import('node:os')
      const path = await import('node:path')
      const file = path.join(os.tmpdir(), `novel-reader-${Date.now()}${ext}`)
      await writeFile(file, content)
      await vscode.env.openExternal(vscode.Uri.file(file))
    } catch {
      void vscode.window.showWarningMessage('书源页面打开失败（data URL 内容无法解析）')
    }
    return
  }
  await vscode.env.openExternal(vscode.Uri.parse(url))
}
