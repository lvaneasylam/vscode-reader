import * as vscode from 'vscode'
import { parseBookSources, checkUnsupported } from 'book-source-engine'
import type { Store } from '../store.js'

/** 导入书源：file / url / clipboard 三入口共用落地逻辑 */
export async function importSource(ctx: vscode.ExtensionContext, store: Store, from: 'file' | 'url' | 'clipboard'): Promise<void> {
  let text: string | undefined
  if (from === 'file') {
    const picks = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { '书源 JSON': ['json', 'txt'] }
    })
    if (!picks?.length) return
    text = Buffer.from(await vscode.workspace.fs.readFile(picks[0])).toString('utf-8')
  } else if (from === 'url') {
    const url = await vscode.window.showInputBox({ prompt: '书源合集 URL', placeHolder: 'https://...json' })
    if (!url) return
    try {
      const res = await fetch(url)
      text = await res.text()
    } catch (e) {
      void vscode.window.showErrorMessage(`下载书源失败: ${(e as Error).message}`)
      return
    }
  } else {
    text = await vscode.env.clipboard.readText()
  }

  if (!text?.trim()) {
    void vscode.window.showWarningMessage('未获取到书源内容')
    return
  }

  const sources = parseBookSources(text)
  if (sources.length === 0) {
    void vscode.window.showErrorMessage('未解析到有效书源（缺少 bookSourceUrl 或 JSON 非法）')
    return
  }

  const { added, updated } = await store.mergeSources(sources)
  const warnings = sources.flatMap(checkUnsupported)
  const warnSummary = warnings.length
    ? `\n⚠ ${warnings.length} 条兼容性警告（XPath/<js>/非文本源等第一版不支持）`
    : ''
  void vscode.window
    .showInformationMessage(`导入完成：新增 ${added}、更新 ${updated} 个书源${warnSummary}`, '查看警告')
    .then(choice => {
      if (choice === '查看警告' && warnings.length > 0) {
        void vscode.window.showQuickPick(
          warnings.map(w => ({ label: '$(warning)' + ' ' + w })),
          { placeHolder: '兼容性警告（不影响其他书源使用）', canPickMany: false }
        )
      }
    })
}
