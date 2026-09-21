# novel-reader — 在 IDE 里用 legado 书源看小说

把 [legado（阅读）](https://github.com/Luoyacheng/legado-E) 的自定义书源机制移植到 VSCode：导入书源 JSON → 搜索第三方平台 → 在编辑器底部阅读。摸鱼专用。

## 功能

- **书源管理**：本地文件 / URL / 剪贴板导入 legado 书源 JSON（合集），启用/禁用/删除
- **搜索选书**：选书源 → 输关键字 → 搜索结果选书 → 自动进书架
- **双模式阅读**（`novelReader.readLocation` 可选，随时切换）：
  - `panel`：底部面板 WebView，多行正文、上/下章按钮
  - `statusBar`：状态栏单行正文，`Alt+↓/↑` 翻行，章末自动翻章（最隐蔽）
- **状态栏导航**：`📖 书名 · n/N`，点击弹出章节选择器（支持过滤跳章）
- **侧边栏书架**：活动栏书本图标 → 书架 → 章节树，点击章节直达
- **阅读进度**：跨工作区持久化，重启 VSCode 自动恢复上次阅读
- **快捷键**：`Alt+→/←` 下一章/上一章，`Alt+↓/↑` 翻行（可自定义）

## 支持的书源规则（第一版）

| 语法 | 示例 |
|---|---|
| legado 默认 jsoup 语法 | `class.read-content@tag.p@text` |
| 强制 CSS | `@CSS:.content p@text` |
| JSONPath | `@json:$.data.books[*].name` |
| 组合符 | `\|\|`（备选）`&&`（拼接）`%%`（交错） |
| 内嵌 JS | `{{java.md5Encode(key)}}`（vm 沙盒 + ajax/base64/md5 等 java.* 扩展） |
| 净化 | `##正则##替换` |
| 分页 | nextTocUrl / nextContentUrl |
| URL 选项块 | `,{"method":"POST","body":...,"charset":"gbk"}` |

**不支持**（导入时会给警告）：`@XPath:`、`<js></js>` 重 JS 书源、登录/验证码/WebView 渲染型、音频/视频/图片源。

## 开发

```bash
npm install
npm test            # engine 全部测试（87 个用例）
npm run smoke:ext   # 编译 + 扩展装配冒烟
cd packages/vscode-ext && npx vsce package --no-dependencies   # 打包 .vsix
```

F5（Extension Development Host）手动验证清单见 `docs/manual-test.md`。

## 结构

```
packages/engine      平台无关书源引擎（零 vscode 依赖，可独立复用/测试）
  ├ source-loader    书源 JSON 解析校验 + 兼容性检测
  ├ rule/            规则引擎（切分/jsoup 语法/CSS/JSONPath/{{}}JS/净化）
  ├ analyze-url      URL 构造（占位符/POST/charset/选项块）
  ├ http             fetch 封装（超时/重试/GBK 解码/Cookie Jar）
  └ webbook          四步流程：搜索→详情→目录→正文
packages/vscode-ext  VSCode 扩展（命令/书架树/面板/状态栏/状态机）
```

JetBrains 版规划：按 `packages/engine` 的公共接口用 Kotlin 重写引擎，UI 层对接 IntelliJ Platform。

## 许可

GPL-3.0（延续 legado）
