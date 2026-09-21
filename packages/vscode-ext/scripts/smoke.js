/**
 * 扩展装配冒烟测试（无 GUI）：
 * 注入 vscode stub 后 require 编译产物并执行 activate，验证装配无异常、命令注册齐全。
 * 运行：node scripts/smoke.js
 */
const Module = require('module')
const path = require('path')

const registered = []
class StubEmitter {
  constructor() { this.event = () => ({ dispose() {} }) }
  fire() {}
  dispose() {}
}
class StubMarkdownString {
  constructor(value) { this.value = value }
}

const vscodeStub = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ConfigurationTarget: { Global: 1 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ProgressLocation: { Notification: 15 },
  EventEmitter: StubEmitter,
  MarkdownString: StubMarkdownString,
  TreeItem: class { constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState } },
  window: {
    createStatusBarItem: () => ({ text: '', tooltip: '', name: '', command: '', show() {}, hide() {}, dispose() {} }),
    registerTreeDataProvider() { return { dispose() {} } },
    registerWebviewViewProvider() { return { dispose() {} } },
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    showOpenDialog: async () => undefined,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
    showErrorMessage: async () => undefined,
    withProgress: async (_opts, fn) => fn()
  },
  workspace: {
    getConfiguration: () => ({ get: (_k, d) => d, update: async () => {} }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
    onDidSaveTextDocument: () => ({ dispose() {} }),
    fs: {}
  },
  commands: {
    registerCommand: id => { registered.push(id); return { dispose() {} } },
    executeCommand: async () => {}
  },
  env: { clipboard: { readText: async () => '' } },
  Uri: {
    file: p => ({ path: p, fsPath: p }),
    joinPath: (base, ...segs) => ({ path: [base.path, ...segs].join('/'), fsPath: [base.path, ...segs].join('/') })
  }
}

const stubPath = path.join(__dirname, 'vscode-stub.js')
require('fs').writeFileSync(stubPath, `module.exports = globalThis.__VSCODE_STUB`)
globalThis.__VSCODE_STUB = vscodeStub

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') return stubPath
  return origResolve.call(this, request, ...args)
}

const memory = new Map()
const ctx = {
  subscriptions: [],
  globalState: {
    get: k => memory.get(k),
    update: async (k, v) => { memory.set(k, v) }
  },
  globalStorageUri: vscodeStub.Uri.file('/tmp/novel-reader-storage')
}

const { activate } = require(path.join(__dirname, '..', 'out', 'extension.js'))

async function main() {
  activate(ctx)
  const expected = [
    'novelReader.searchBook',
    'novelReader.openChapter',
    'novelReader.openShelfBook',
    'novelReader.removeShelfBook',
    'novelReader.selectChapter',
    'novelReader.nextChapter',
    'novelReader.prevChapter',
    'novelReader.nextLine',
    'novelReader.prevLine',
    'novelReader.switchLocation',
    'novelReader.importSourceFromFile',
    'novelReader.importSourceFromUrl',
    'novelReader.importSourceFromClipboard',
    'novelReader.manageSources',
    'novelReader.checkSources',
    'novelReader.sourceLogin',
    'novelReader.setSourceCookie',
    'novelReader.exportSources'
  ]
  const missing = expected.filter(id => !registered.includes(id))
  if (missing.length > 0) {
    console.error('FAIL 缺少命令注册:', missing.join(', '))
    process.exit(1)
  }
  console.log(`OK activate 无异常，${registered.length} 个命令全部注册`)
}

main().catch(e => {
  console.error('FAIL activate 抛错:', e)
  process.exit(1)
})
