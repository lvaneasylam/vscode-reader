import * as vscode from 'vscode'
import type { Store } from '../store.js'

/** 导出当前启用的书源为 legado 兼容 JSON（分享/备份） */
export async function exportSources(store: Store): Promise<void> {
  const enabled = store.getSources().filter(s => s.enabled !== false)
  if (enabled.length === 0) {
    void vscode.window.showInformationMessage('没有启用的书源可导出')
    return
  }
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file('bookSources.json'),
    filters: { '书源 JSON': ['json'] }
  })
  if (!uri) return
  // 剥离引擎内部字段（headerMap），保留 legado 原生字段
  const clean = enabled.map(({ headerMap: _internal, ...rest }) => {
    void _internal
    return rest
  })
  await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(clean, null, 2), 'utf-8'))
  void vscode.window.showInformationMessage(`已导出 ${clean.length} 个书源 → ${uri.fsPath}`)
}
