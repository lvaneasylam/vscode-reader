import * as vscode from 'vscode'
import { parseBookSource, type BookSource } from 'book-source-engine'
import type { Store } from '../store.js'

/**
 * 书源编辑：将书源 JSON 落到扩展存储目录的可编辑文件，
 * 用户在编辑器里改完 Cmd+S 保存即回写生效（保存时校验，非法 JSON 拒绝生效）。
 */
export class SourceEditor {
  private readonly dir: vscode.Uri

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly store: Store
  ) {
    this.dir = vscode.Uri.joinPath(ctx.globalStorageUri, 'sources')
  }

  async open(source: BookSource): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir)
    const fileUri = vscode.Uri.joinPath(this.dir, `${safeFileName(source.bookSourceName)}.json`)
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(JSON.stringify(source, null, 2), 'utf-8'))
    const doc = await vscode.workspace.openTextDocument(fileUri)
    await vscode.window.showTextDocument(doc)
  }

  /** 统一挂到 workspace.onDidSaveTextDocument；仅处理本扩展目录下的书源文件 */
  async handleSaved(doc: vscode.TextDocument): Promise<void> {
    if (!doc.uri.path.startsWith(this.dir.path)) return
    const r = parseBookSource(doc.getText())
    if (!r.ok) {
      void vscode.window.showErrorMessage(`书源 JSON 未生效：${r.error}（修正后再保存）`)
      return
    }
    await this.store.mergeSources([r.source])
    void vscode.window.showInformationMessage(`书源已更新：${r.source.bookSourceName}`)
  }
}

function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '_')
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'source'
}
