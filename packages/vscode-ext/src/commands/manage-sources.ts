import * as vscode from 'vscode'
import type { BookSource } from 'book-source-engine'
import type { Store } from '../store.js'

/** 管理书源：列表 → 启用/禁用/登录/编辑/置顶/删除 */
export async function manageSources(
  store: Store,
  onEdit: (source: import('book-source-engine').BookSource) => Promise<void>,
  onLogin: (source: import('book-source-engine').BookSource) => Promise<void>
): Promise<void> {
  const sources = store.getSources()
  if (sources.length === 0) {
    void vscode.window.showInformationMessage('还没有书源，请先导入')
    return
  }
  const pick = await vscode.window.showQuickPick(
    sources.map(s => ({
      label: `${s.enabled === false ? '$(circle-slash)' : '$(check)'} ${s.bookSourceName}`,
      description: s.bookSourceGroup,
      detail: s.bookSourceUrl,
      source: s
    })),
    { placeHolder: '选择书源进行管理' }
  )
  if (!pick) return
  const action = await vscode.window.showQuickPick(
    [
      { label: '$(play)' + ' 启用/禁用', action: 'toggle' as const },
      { label: '$(key)' + ' 登录（书源表单）', action: 'login' as const },
      { label: '$(edit)' + ' 编辑（保存后生效）', action: 'edit' as const },
      { label: '$(arrow-up)' + ' 置顶', action: 'top' as const },
      { label: '$(trash)' + ' 删除', action: 'remove' as const }
    ],
    { placeHolder: pick.source.bookSourceName }
  )
  if (!action) return

  if (action.action === 'edit') {
    await onEdit(pick.source)
    return
  }

  if (action.action === 'login') {
    await onLogin(pick.source)
    return
  }

  if (action.action === 'top') {
    const rest = sources.filter(s => s.bookSourceUrl !== pick.source.bookSourceUrl)
    await store.saveSources([pick.source, ...rest])
    void vscode.window.showInformationMessage(`已置顶 ${pick.source.bookSourceName}`)
    return
  }

  if (action.action === 'toggle') {
    const next = sources.map(s =>
      s.bookSourceUrl === pick.source.bookSourceUrl
        ? ({ ...s, enabled: s.enabled === false } as BookSource)
        : s
    )
    await store.saveSources(next)
    void vscode.window.showInformationMessage(
      `${pick.source.bookSourceName} 已${pick.source.enabled === false ? '启用' : '禁用'}`
    )
  } else {
    const confirm = await vscode.window.showWarningMessage(
      `删除书源 ${pick.source.bookSourceName}？`,
      { modal: true },
      '删除'
    )
    if (confirm === '删除') {
      await store.saveSources(sources.filter(s => s.bookSourceUrl !== pick.source.bookSourceUrl))
    }
  }
}
