import * as vscode from 'vscode'

/** 设置栏条目（点击执行命令） */
class ToolItem extends vscode.TreeItem {
  constructor(label: string, cmd: string, tooltip: string) {
    super(label)
    this.tooltip = tooltip
    this.command = { command: cmd, title: label }
  }
}

/**
 * 容器顶部「设置栏」：插件级操作直达（原生树视图，高度自适应无 webview 空白）。
 */
export class ToolbarView implements vscode.TreeDataProvider<ToolItem> {
  private static readonly ITEMS: Array<[string, string, string]> = [
    ['📥 导入书源', 'novelReader.importSourceFromFile', '导入书源（本地文件 / URL / 剪贴板）'],
    ['📚 管理书源', 'novelReader.manageSources', '管理书源（启禁 / 删除 / 编辑）'],
    ['👤 书源登录', 'novelReader.sourceLogin', '书源登录（表单 / token 直登）'],
    ['⚙️ 插件设置', 'novelReader.openSettings', '插件设置（外观 / 字体 / 行为 / 登录）']
  ]

  getTreeItem(element: ToolItem): vscode.TreeItem {
    return element
  }

  getChildren(): ToolItem[] {
    return ToolbarView.ITEMS.map(([label, cmd, tip]) => new ToolItem(label, cmd, tip))
  }
}
