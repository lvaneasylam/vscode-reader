# IDE 小说阅读插件 · 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 legado 书源 JSON 机制移植为 VSCode 插件：导入书源 → 搜索 → 目录 → 底部阅读（面板/状态栏双模式）。

**Architecture:** Monorepo 两包。`packages/engine` 为平台无关书源引擎（规则解析/URL构造/四步流程，零 vscode 依赖，可独立测试）；`packages/vscode-ext` 为扩展 UI（WebView 面板、状态栏、QuickPick、TreeView）。后续 Kotlin 版按 engine 的接口契约重写。

**Tech Stack:** TypeScript · Vitest · cheerio · jsonpath-plus · node:vm（JS 沙盒）· 原生 fetch · VSCode Extension API

**约束:** 按用户全局规则，本计划不包含任何 git commit/branch 步骤，由用户自行决定提交时机。

---

## 阶段 0：脚手架

### Task 1: Monorepo 脚手架

**Files:**
- Create: `package.json`（workspaces 根）
- Create: `packages/engine/package.json`、`packages/engine/tsconfig.json`、`packages/engine/vitest.config.ts`
- Create: `packages/engine/src/index.ts`
- Test: `packages/engine/tests/smoke.test.ts`

**Step 1:** 根 `package.json` 配 workspaces：`["packages/*"]`，scripts：`test` → `vitest run`。
**Step 2:** engine 包：`"name": "book-source-engine"`、`"type": "module"`、`"main": "dist/index.js"`，deps：cheerio、jsonpath-plus；devDeps：typescript、vitest。
**Step 3:** 冒烟测试：

```ts
import { describe, it, expect } from 'vitest'
describe('engine smoke', () => {
  it('loads', async () => {
    const engine = await import('../src/index.js')
    expect(engine).toBeTruthy()
  })
})
```

**Step 4:** `npm install && npm test` → PASS。

---

## 阶段 1：engine 核心

### Task 2: 书源类型模型 + 解析校验

**Files:**
- Create: `packages/engine/src/types.ts`（BookSource/SearchRule/BookInfoRule/TocRule/ContentRule 完整类型，字段名与 legado JSON 一致）
- Create: `packages/engine/src/source-loader.ts`（`parseBookSource(json: string): { source: BookSource; warnings: string[] } | { error: string }`、`checkUnsupported(source): string[]`）
- Test: `packages/engine/tests/source-loader.test.ts`

**测试用例（核心断言）：**

```ts
// 1. 合法书源：解析出 searchUrl/ruleSearch.bookList/ruleToc.chapterList
// 2. 缺 bookSourceUrl → error
// 3. bookSourceType=1（音频）→ warnings 含 '不支持的书源类型'
// 4. 规则含 @XPath: → warnings 含 'XPath 第一版不支持'
// 5. 规则含 <js> → warnings 含 '<js> 书源第一版不支持'
// 6. JSON 数组输入（书源合集）→ 单独函数 parseBookSources 返回数组
```

**实现要点:** 类型字段从 `/tmp/legado-E/app/src/main/java/io/legado/app/data/entities/` 对照。不支持的检测扫描所有规则字符串字段。SearchRule 等需兼容「JSON 字符串形式的规则」（legado 的 JsonDeserializer 允许规则是字符串化的 JSON）——第一版遇字符串形式给 warning 并跳过。

### Task 3: RuleAnalyzer 规则切分

**Files:**
- Create: `packages/engine/src/rule/rule-analyzer.ts`
- Test: `packages/engine/tests/rule/rule-analyzer.test.ts`

职责：把规则字符串按顶层 `||`、`&&`、`%%` 切分（跳过 `{{...}}` 内部与引号内），提取 `##正则##替换` 尾部净化。

**测试用例：**

```ts
splitTopLevel('a@text||b@text', '||')        // ['a@text','b@text']
splitTopLevel('a@text&&b@text', '&&')        // ['a@text','b@text']
splitTopLevel('{{java.ajax("x||y")}}||b', '||') // ['{{java.ajax("x||y")}}','b']
splitPurify('content##广告##')               // { rule:'content', pattern:'广告', replacement:'' }
splitPurify('content##\\d+##[NUM]')          // { rule:'content', pattern:'\\d+', replacement:'[NUM]' }
```

**实现要点:** 单趟扫描 + 引号/大括号深度计数（对照 legado RuleAnalyzer 的 chompCodeBalanced 思路）。

### Task 4: 默认 jsoup 规则语法（选择器链）

**Files:**
- Create: `packages/engine/src/rule/query-jsoup.ts`（`queryJsoup(root: CheerioAPI, rule: string): string | string[]`）
- Test: `packages/engine/tests/rule/query-jsoup.test.ts`

语法（对齐 legado AnalyzeByJSoup 默认语法）：

```
class.xxx / id.xxx / tag.xxx [.索引]  → 选择器
@ 数字                                → 子元素索引（负数从后取）
@ text / textNodes / ownText / html / all / texts → 终止符
@ 其他字符串                           → 属性名（如 src/href）
多个 @ 层级链式执行；无前缀直接以 tag 处理
```

**测试用例（构造固定 HTML）：**

```ts
// html: <div class="content"><p>甲</p><p>乙</p></div>
queryJsoup(html, 'class.content@tag.p@text')      // '甲\n乙'
queryJsoup(html, 'class.content@tag.p.0@text')    // '甲'
queryJsoup(html, 'class.content@children.1@text') // '乙'
// 属性：<img src="a.jpg"/> → 'tag.img@src' === 'a.jpg'
// textNodes 取直接文本节点；html 返回内部 HTML
```

**实现要点:** cheerio load → 按段迭代。'甲\n乙' 用 `\n` join（legado 的 getString 列表以 \n 连接）。

### Task 5: @CSS: 与 @json: 规则支持 + 规则统一入口

**Files:**
- Create: `packages/engine/src/rule/query-css.ts`、`packages/engine/src/rule/query-json.ts`
- Create: `packages/engine/src/rule/analyze-rule.ts`（统一入口 `getString(content, rule)` / `getElements(content, rule)`）
- Test: 对应 tests

**测试用例：**

```ts
// @CSS:.content p::text / @CSS:.content@p（legado 把 @ 当后代选择器）
// @json:$.data.books[*].name → 字符串或数组
// getElements('class.item', html) 返回元素数组供逐项再解析
// 组合: 'a@text||b@text' 第一个非空生效；'&&' 拼接；'%%' 交错（列表场景）
```

**实现要点:** 入口职责：判前缀（@CSS:/@json:/@XPath:→报错/默认 jsoup）→ 切组合符 → 执行 → 净化后处理 → {{}} 替换在 Task 6 注入。`%%` 仅 getElements 场景实现交错。

### Task 6: JS 沙盒 + JsExtensions 基础

**Files:**
- Create: `packages/engine/src/js/js-runtime.ts`（`evalJs(code, ctx)`，node:vm，注入 `java` 对象与 `result` 协议）
- Create: `packages/engine/src/js/js-extensions.ts`（java.ajax/get/base64Encode/base64Decode/md5Encode/md5Encode16/encodeURI/decodeURI/log/timeFormat）
- Test: `packages/engine/tests/js/js-runtime.test.ts`

**测试用例：**

```ts
evalJs('result = java.base64Encode("hi")')        // 'aGk='
evalJs('result = java.md5Encode("abc")')          // '900150983cd24fb0d6963f7d28e17f72'
evalJs('1 + 1', { asExpr: true })                 // 2（{{}} 场景按表达式求值）
// {{java.encodeURI("我的")}} 替换进 URL 场景
```

**实现要点:** `new vm.Script` + `vm.createContext`；`java.ajax` 用回调式包装成同步（vm 内同步语义）——第一版 ajax 直接同步 fetch 会阻塞事件循环，改为：预执行扫描 + 文档标注「ajax 在 {{}} URL 模板中同步可用」；实现时用 `child_process` 不行——**采用声明式方案：{{}} 求值在 async 函数内 await 所有 java.ajax（把 java.ajax 实现为 Promise，vm 上下文里 await 通过顶层 await 包装脚本）**。engine 暴露 `evalJsAsync`。

### Task 7: AnalyzeUrl（URL 构造与请求）

**Files:**
- Create: `packages/engine/src/analyze-url.ts`（`class AnalyzeUrl { constructor(urlRule, ctx: { key?, page?, source }) ; url; method; headers; body; charset; build(): Promise<RequestSpec>`））
- Test: `packages/engine/tests/analyze-url.test.ts`

**测试用例：**

```ts
// '{{key}}' 替换 + URL 编码：'https://x.com/s?q={{key}}' + key='我的' → q=%E6%88%91%E7%9A%84
// '{{page}}' 页码替换
// 选项块：'https://x.com,{"method":"POST","body":"k={{key}}","charset":"gbk"}'
//   → method=POST, body=k=%..., charset=gbk
// POST body JSON（{ 开头）→ application/json；否则 form
// headers 合并：source.header(JSON) + 选项块 headers 覆盖
// webView:true → 抛 UnsupportedError
// retry / concurrentRate 解析（行为：retry ≤2 次）
```

**实现要点:** `,\s*\{` 定位选项块（从末尾找平衡大括号）；{{}} 用 Task 6 evalJsAsync；GBK 解码：fetch → arrayBuffer → `new TextDecoder(charset)`（Node full-icu）。默认 UA：桌面 Chrome UA（很多站点拒绝默认 UA）。

### Task 8: HTML 格式化净化

**Files:**
- Create: `packages/engine/src/html-formatter.ts`（`formatContent(html: string): string`）
- Test: `packages/engine/tests/html-formatter.test.ts`

**测试用例：**

```ts
formatContent('<p>段1</p><p>段2</p>')      // '段1\n段2'
formatContent('<br/>换行')                  // 保留换行
formatContent('&amp;&lt;')                  // '&、<'（HTML 实体反转义）
formatContent('<div>&nbsp;&nbsp;缩进</div>')// 全角空格保留
```

**实现要点:** 对照 legado HtmlFormatter.formatKeepImg：块级标签转 \n、去 script/style、实体反转义、连续空行压缩、段落首保留全角空格。图片 `<img src>` 保留为 URL 行（面板后续可用）。

### Task 9: WebBook 四步流程

**Files:**
- Create: `packages/engine/src/webbook.ts`（`searchBooks(source, key)` / `getBookInfo(source, book)` / `getChapterList(source, book)` / `getContent(source, book, chapter)`）
- Create: `packages/engine/src/http.ts`（fetch 封装：AnalyzeUrl spec → 响应文本，含 charset/重试/超时/cookie 简单 jar）
- Test: `packages/engine/tests/webbook.test.ts`（fetch stub 注入）

**测试用例（stub 掉 http 层）：**

```ts
// searchBooks: 给定书源 JSON + stub HTML → [{name, author, bookUrl, intro?}]
// getBookInfo: 详情页 → tocUrl 回退 bookUrl
// getChapterList: 目录页 + nextTocUrl 翻页（stub 第二页）→ 合并章节列表
// getContent: 正文页 + nextContentUrl 翻页 → 拼接正文；正文为空 → ContentEmptyError
// bookUrlPattern 命中 → 搜索结果按详情页解析（对齐 BookList.getInfoItem 分支）
```

**实现要点:** 相对 URL 用 `new URL(rel, baseUrl).href`；上下文对象贯穿（book 变量、chapter 变量供 {{}} 使用）；getElements 列表项→ AnalyzeRule 复用（legado 同一 analyzeRule 逐项 setContent）。

### Task 10: engine 导出与真实书源回归

**Files:**
- Modify: `packages/engine/src/index.ts`（导出全部公共 API）
- Test: `packages/engine/tests/regression.test.ts` + `tests/fixtures/*.json`（2-3 个脱敏真实书源 + 对应 stub HTML）

**验证:** `npm test` 全绿；手动 `node` 脚本跑一个公网可访问书源（可选，需用户网络）。

---

## 阶段 2：vscode-ext

### Task 11: 扩展脚手架 + 书架存储

**Files:**
- Create: `packages/vscode-ext/package.json`（name: novel-reader、main、engines.vscode ^1.80、commands、views、viewsContainers、configuration、keybindings 内嵌声明）
- Create: `packages/vscode-ext/src/extension.ts`（activate/deactivate）
- Create: `packages/vscode-ext/src/store.ts`（globalState 封装：书源列表/书架/进度，类型复用 engine）

**验证:** `F5` Extension Development Host 启动无报错；`novelReader.hello` 测试命令出现在命令面板（验证后删除）。

### Task 12: 书源导入与管理

**Files:**
- Create: `packages/vscode-ext/src/commands/import-source.ts`（三个入口：本地文件选择 / URL 下载 / 剪贴板粘贴）
- Create: `packages/vscode-ext/src/commands/manage-sources.ts`（QuickPick 列表：启用/禁用/删除/查看）
- Modify: `extension.ts` 注册

**验证:** F5 中执行导入文件 → 提示导入 N 个书源、M 个含不支持特性警告；manage 列表可启停。

### Task 13: 搜索选书 → 书架 → 目录

**Files:**
- Create: `packages/vscode-ext/src/commands/search-book.ts`（选书源（默认全部并发，可先选单个）→ 输入关键字 QuickPick input → 结果列表选书）
- Create: `packages/vscode-ext/src/bookshelf.ts`（加入书架、加载目录、进度读写）
- Test: `packages/vscode-ext/src/bookshelf.test.ts`（纯逻辑部分，engine mock）

**验证:** F5 中搜索 → 选书 → 状态栏出现 `📖 书名`。

### Task 14: 侧边栏章节树

**Files:**
- Create: `packages/vscode-ext/src/tree/chapters-tree.ts`（TreeDataProvider：书架 → 章节两层）
- Modify: `package.json`（viewsContainers.activitybar + views.explorer）

**验证:** F5 中侧边栏出现阅读图标，书籍可展开章节，点击章节触发阅读。

### Task 15: 面板模式阅读（WebView）

**Files:**
- Create: `packages/vscode-ext/src/ui/reader-panel.ts`（BottomPanel webview view，`resolveWebviewView`）
- Create: `packages/vscode-ext/src/ui/reader-html.ts`（模板：标题 + 正文段落 + 上/下章按钮 + 错误条 + 简易加载态）
- Create: `packages/vscode-ext/src/reader-controller.ts`（核心状态机：当前书/章/翻章/缓存 LRU 20 章）

**验证:** F5 中点章节 → 底部面板显示正文；上/下章按钮工作；断网/规则失败显示错误条。

### Task 16: 状态栏模式 + 导航条

**Files:**
- Create: `packages/vscode-ext/src/ui/status-reader.ts`（单行模式：StatusBarItem 显示当前行，`novelReader.nextLine/prevLine` 翻行，章末自动翻章）
- Create: `packages/vscode-ext/src/ui/status-nav.ts`（导航条：`📖 书名 · N/M章`，点击 → QuickPick 章节过滤跳转）
- Modify: `package.json` keybindings：下一章（默认 `Alt+→`）/ 上一章（`Alt+←`）/ 下一行（`Alt+↓`）/ 上一行（`Alt+↑`）

**验证:** F5 中切换 `novelReader.readLocation` 设置（panel/statusBar）即时生效；状态栏翻行、点击选章均工作。

### Task 17: 打包与端到端清单

**Files:**
- Create: `packages/vscode-ext/.vscode-test.mjs`（若做集成测试）或手动清单文档 `docs/manual-test.md`

**手动清单：** 导入书源合集 → 搜索 → 加书架 → 面板读 → 切状态栏读 → 翻章/跳章 → 重启 VSCode 进度保留。
**打包:** `vsce package`（devDependency @vscode/vsce）。

---

## 验证命令汇总

```bash
npm test                    # 根：全部 vitest
npm run -w book-source-engine test
cd packages/vscode-ext && npm run compile   # tsc -p .
# F5 手动验证（清单见 docs/manual-test.md）
```
