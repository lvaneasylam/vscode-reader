# IDE 小说阅读插件 · 设计文档

日期：2026-09-20
状态：已确认

## 目标

将 legado（阅读）的书源机制移植为 IDE 插件：导入自定义书源 JSON → 调用第三方平台 → 在 IDE 内阅读小说。

- 第一版：VSCode 扩展（TypeScript）
- 后续：Kotlin 重写引擎出 JetBrains 版（共享设计，不共享代码）
- 后续增强：快捷键、字体自定义、字号（VSCode 端大部分免费获得）

## 总体架构

```
┌─ VSCode 扩展层（UI）──────────────────┐
│ Panel WebView 正文 / 状态栏 / QuickPick / 命令 │
├─ 适配层 ────────────────────────┤
│ globalState 存储 / 生命周期 / 事件            │
├─ 引擎核心 book-source-engine（零 vscode 依赖）┤
│  ├ 书源模型：BookSource JSON 解析校验          │
│  ├ AnalyzeUrl：URL 构造 + HTTP 请求           │
│  ├ 规则引擎：CSS/JSONPath/{{}}JS 解析提取       │
│  └ WebBook：搜索→详情→目录→正文 四步流程        │
└─────────────────────────────────────┘
```

- Monorepo：`packages/engine`（纯 TS 库）+ `packages/vscode-ext`
- engine 禁止 `import vscode`；JS 沙盒等宿主能力通过接口注入
- DOM 解析 cheerio；JSONPath jsonpath-plus；HTTP 原生 fetch；{{}} JS 用 node:vm

## UI 设计（双模式，可切换）

- **面板模式**：底部 Panel WebView，多行正文、高度可调、一键折叠
- **状态栏模式**：单行文字 + 快捷键翻行 + 章末自动翻章
- 设置项 `novelReader.readLocation`（panel / statusBar）+ 切换命令
- 状态栏导航：`📖 书名 · 章节进度`，点击弹 QuickPick 选章（支持过滤）
- 侧边栏 TreeView：书架 → 章节

## 书源兼容范围

支持：

| 语法 | 示例 |
|---|---|
| 默认 jsoup 语法 | `class.read-content@tag.p@text` |
| 强制 CSS | `@CSS:.content p@text` |
| JSONPath | `@json:$.data.books[*].name` |
| 组合符 | `\|\|` 备选、`&&` 拼接、`%%` 交错 |
| 内嵌 JS | `{{java.md5Encode(key)}}`（vm 沙盒 + 常用 JsExtensions） |
| 净化替换 | `##正则##替换` |
| 分页 | nextTocUrl / nextContentUrl |

不支持（检测到给清晰错误）：`@XPath:`、`<js></js>` 重 JS 书源、登录/验证码/WebView 型、非文本源（bookSourceType != 0）。

## 四步流程（对齐 legado WebBook）

1. 搜索：searchUrl（{{key}}/{{page}}、POST body、charset）→ ruleSearch.bookList → name/author/bookUrl
2. 详情：bookUrl → ruleBookInfo → tocUrl
3. 目录：tocUrl → ruleToc.chapterList → chapterName/chapterUrl，nextTocUrl 翻页
4. 正文：chapterUrl → ruleContent.content，nextContentUrl 翻页，HTML 净化格式化

## 数据与持久化

- 书源列表、书架、阅读进度存 VSCode globalState（全局跨工作区）
- 书架条目：{ bookUrl, name, author, tocUrl, origin, chapterIndex }
- 章节正文内存缓存（LRU，如 20 章）+ 可选磁盘缓存（后置）

## 错误处理

- 书源校验：导入时结构校验 + 不支持特性标记（enabled=false + 原因）
- 请求失败：超时/重试（AnalyzeUrl 的 retry 选项）→ 面板内错误条展示
- 规则失败：明确指出哪个规则字段解析失败，方便修书源
- 内容为空：ContentEmptyException 对应提示

## 测试策略

- engine 纯库，Vitest 单测：规则引擎逐语法用例、AnalyzeUrl 构造用例
- WebBook 流程：HTTP 层 mock（msw 或 fetch stub）做集成测试
- 用真实书源 JSON 样本做回归（脱敏）
- vscode-ext：手动验证清单（VSCode Extension Development Host）

## 非目标（第一版）

发现页（exploreUrl）、替换净化全局规则、本地 TXT/EPUB、音频视频源、登录、代理、WebDAV 同步。
