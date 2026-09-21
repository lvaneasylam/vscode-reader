import * as vscode from 'vscode'

/** 选择本地字体文件 → 写入 novelReader.fontFile 配置（面板经 @font-face 加载） */
export async function selectFontFile(): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: '使用此字体',
    filters: { '字体文件': ['ttf', 'otf', 'woff', 'woff2'] }
  })
  const file = picked?.[0]
  if (!file) return
  await vscode.workspace.getConfiguration('novelReader').update('fontFile', file.fsPath, vscode.ConfigurationTarget.Global)
  void vscode.window.showInformationMessage(`正文字体已切换（${file.path.split('/').pop()}），阅读面板即时生效`)
}
