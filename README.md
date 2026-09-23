# 墨遥·阅山行

在编辑器里用 [legado（阅读）](https://github.com/Luoyacheng/legado-E) 书源看小说的摸鱼插件，**双平台**：

- **VSCode 扩展**（主线）：侧边栏 / 底部面板 / 状态栏单行三种阅读模式，最隐蔽
- **JetBrains 插件**：IntelliJ / PhpStorm / GoLand 等 IDE 通用，同引擎同体验

两版共享同一个书源引擎（TypeScript，规则解析 / JS 沙盒 / 登录态 / 网络层），书源一次导入全平台通用。

**核心特性**：重 JS 书源 · 表单 / 多字段凭据 / Cookie 三种登录 · EPUB 本地书 · 章节缓存与预加载 · 逐行阅读 · 老板键一键隐藏

## 下载安装

| 平台 | 方式 |
|---|---|
| VSCode | [Releases](../../releases) 下载 `.vsix` → 扩展面板 ⋯ → 「从 VSIX 安装」 |
| JetBrains | [Releases](../../releases) 下载 `.zip` → `Settings → Plugins → ⚙️ → Install Plugin from Disk`（需本机已装 Node.js） |

## 快速上手（VSCode）

1. **导入书源**：左侧活动栏书本图标 → 设置栏 → **📥 导入书源**（本地 JSON 文件 / URL / 剪贴板，支持书源合集）
2. **搜索**：书架标题栏 **🔍 搜索** → 选书源 → 输入书名 → 结果中选书 → 自动加入书架并开始阅读
3. **阅读**：`Alt+→` / `Alt+←` 翻章，`Alt+↓` / `Alt+↑` 翻行；单击正文某行可把「当前行」定位过去（页面不滚动）
4. **摸鱼被发现了？** 按 **`Ctrl+Alt+B`**（Mac `⌘⌥B`）老板键，全部阅读界面瞬间消失，再按恢复原样

## 使用方法

### 导入书源

- **文件**：设置栏 → 导入书源 → 选择本地 `.json`（支持多个书源的合集）
- **URL**：命令面板（`⇧⌘P`）→ 「导入书源（URL）」→ 粘贴书源 JSON 地址
- **剪贴板**：复制书源 JSON 后执行「导入书源（剪贴板）」
- 导入后可 **📚 管理书源**（启用/禁用/编辑/删除），或 **校验书源** 批量检测可用性

### 登录（需认证的书源）

设置栏 → **👤 书源登录**，三种方式：

| 方式 | 适用 |
|---|---|
| **表单登录** | 书源提供了 loginUi 表单（账号密码首次输入后自动保存，之后全自动） |
| **凭据直登** | 从浏览器 F12 → Cookie 或其他设备复制凭据粘贴；**支持多字段**：`token=…; uid=…; session=…` 分号分隔一次配齐，不带字段名的值写入设置 `tokenFieldName` 配置的默认字段 |
| **手动 Cookie** | 从浏览器复制整行 Cookie 粘贴 |

登录态、线路选择、书源设置**跨窗口重启持久保存**。书源限流/登录接口不可用时，凭据直登是最可靠的通道。

### 三种阅读模式（VSCode）

设置 → 「章节正文的展示位置」，或命令「切换阅读位置」轮换：

| 模式 | 位置 | 特点 |
|---|---|---|
| 侧边栏 | 左侧活动栏 → 阅读 | 边写代码边看，推荐 |
| 底部面板 | 底部「墨遥·阅山行」面板 | 半屏沉浸 |
| 状态栏 | 状态栏单行正文 | 最隐蔽；长行自动分段，`Alt+↓` 逐段读 |

### 书架

- 点击书 → 恢复到上次阅读进度；展开书 → 点击章节直达
- **🗄** = 正文已缓存（读过的/预加载的，免请求）；**🔖** = 正在读
- **🔄 刷新目录**：追更时手动拉最新章节列表（书架标题栏刷新当前书；书行悬停 🔄 刷新指定书）
- **✕ 从书架移除**：悬停书行或右键（有确认框，进度一并清除）
- 目录跨会话缓存：重启 VSCode 后书架仍可离线浏览章节

### 导入 EPUB 本地书

书架标题栏 **📄 导入 EPUB** → 选择 `.epub` 文件（支持多选）→ 自动解析书名/作者/目录 → 与在线书完全同链路阅读。完全离线，正文按章懒加载不吃内存。

### 发现页

侧边栏 **发现** 视图：展示书源提供的分类书单（支持 `<js>` 动态生成分类的书源），瀑布流自动翻页，选书即入书架。

### 外观自定义

设置搜 `novelReader`（JetBrains 版：`Settings → Tools → 墨遥·阅山行`）：

- **字号 / 行高 / 书页宽度**（设宽度后正文居中，仿纸质书排版）
- **字体**：本机字体名，或命令「选择正文字体文件…」直接用本地 `.ttf/.otf/.woff2`（无需安装到系统）
- **背景色 / 文字色**：如 `#f5f0e1` 米黄护眼；留空跟随编辑器主题深浅色

### 阅读效率

- **向后预加载章节数**（建议 3~5）：读当前章时后台预取后面几章，翻章零等待；章节树 🗄 实时亮起
- **章节缓存数**（默认 20）：已读章节免重复请求
- **章末自动翻章**：`Alt+↓` 到章末自动进下一章（可关）
- 段评图自动代理渲染（需登录态的书源自动带凭据拉取）

## 快捷键

| 键 | 功能 |
|---|---|
| `Alt+→` / `Alt+←` | 下一章 / 上一章 |
| `Alt+↓` / `Alt+↑` | 下一行 / 上一行（状态栏模式长行逐段） |
| `Ctrl+Alt+B`（Mac `⌘⌥B`） | **老板键**：一键隐藏/恢复阅读 |

快捷键均可在编辑器的快捷键设置中自定义。

## JetBrains 版（IntelliJ / PhpStorm / GoLand…）

同引擎的 IDE 移植版，功能与 VSCode 版对齐（书架章节树、阅读当前行高亮、发现页、老板键、EPUB、多字段凭据登录等）。

- **安装**：[Releases](../../releases) 下载 `.zip` → `Settings → Plugins → ⚙️ → Install Plugin from Disk`
- **设置入口**：`Settings (⌘,) → Tools → 墨遥·阅山行`，或搜索「墨遥」
- **运行要求**：本机需安装 Node.js（自动探测 homebrew/volta/nvm 等，也可在设置里指定路径）
- 详细文档见 [packages/jetbrains/README.md](./packages/jetbrains/README.md)

## 常见问题

- **搜索报「书源返回空数据」**：先在书源登录菜单「查看登录状态」；多为登录过期（重新凭据直登）或线路不可用（登录菜单切换线路）
- **登录提示限流**：服务器按 IP 限流（一般 2 小时），期间用凭据直登不受影响
- **翻章变慢**：设置里调大「向后预加载章节数」并确保「章节缓存数」≥ 预载数 + 10
- **JetBrains 版找不到设置**：`Settings → Tools` 组拉到最底，或搜索「墨遥」
- **JetBrains 版排查**：`idea.log` 搜 `[sidecar]` 可见全部引擎请求日志；数据目录 `~/Library/Application Support/JetBrains/<IDE>/novel-reader/`

## 支持的书源规则

legado 默认 jsoup 语法、`@CSS:`、`@json:` JSONPath、`||`/`&&`/`%%` 组合符、
`##正则##` 净化、URL 选项块（POST/charset）、`{{}}` 内嵌 JS（vm 沙盒 + java.* 扩展）、
`<js></js>` 规则链与 jsLib、loginUi 表单登录、Cookie Jar。
不支持：`@XPath:`、音频/视频源。

## 项目结构

```
packages/
├── engine/          # 书源引擎（平台无关 TypeScript：规则解析/JS 沙盒/网络/登录）
├── vscode-ext/      # VSCode 扩展（主线）
└── jetbrains/       # JetBrains 插件（Node sidecar 复用 engine）
```

## 开发

```bash
npm install
npm test                      # engine 全部测试
npm run smoke:ext             # 编译 + 扩展装配冒烟
cd packages/vscode-ext
npm run vsce:install          # typecheck + compile + 打包 + 安装到本机 VSCode
```

JetBrains 版构建（需系统 gradle + JDK 21）：

```bash
cd packages/jetbrains
gradle buildPlugin            # 产物在 build/distributions/
```

## 许可

[GPL-3.0](./LICENSE)

GPL-3.0 © C.Hiang
