# 墨遥·阅山行 — 在 IDE 里用 legado 书源看小说

把 [legado（阅读）](https://github.com/Luoyacheng/legado-E) 的自定义书源机制移植到 VSCode：导入书源 JSON → 搜索 → 编辑器里阅读。摸鱼专用。

## 功能

### 阅读
- **三种阅读位置**：左侧插件栏 / 底部面板 / 状态栏单行（最隐蔽），随时切换
- **老板键**（`Ctrl+Alt+B` / Mac `⌘⌥B`）：一键隐藏/恢复全部阅读界面，进度不丢
- 翻行高亮 + 滚动跟随；`Alt+→/←` 翻章，`Alt+↓/↑` 翻行（状态栏长行自动分段）
- 加载反馈：切章进度条 + 首开骨架屏；段评图代理渲染
- 正文净化：段评内联数据 → 💬、机器载荷隐藏

### 书源
- legado 书源 JSON 导入（文件/URL/剪贴板）、启禁/编辑/校验/导出
- **重 JS 书源支持**：jsLib、`<js>` 规则链、`{{}}` 内嵌 JSONPath、登录（loginUi 表单）
- **登录三通道**：表单登录、token 直登（Cookie 字段名可配）、手动 Cookie
- 登录态/线路/云端配置跨实例、跨会话持久化

### 书架
- 目录跨会话缓存（离线可浏览）、一键刷新
- 正文内存缓存（🗄 图标）+ **向后预加载 N 章**（LRU 保护在读章节）
- **导入 EPUB 本地书**（懒加载解析，完全离线）

### 配置（设置页搜 novelReader）
字号/行高/书页宽度、字体名/**字体文件上传**（.ttf/.otf）、背景/文字色、
章末自动翻章、状态栏宽度、缓存数、预加载数、token 字段名、请求超时、TLS 信任

## 开发

```bash
npm install
npm test                      # engine 全部测试（137 个用例）
npm run smoke:ext             # 编译 + 扩展装配冒烟
cd packages/vscode-ext
npm run vsce:install          # typecheck + compile + 打包 + 安装到本机 VSCode
```

## 结构

```
packages/engine      平台无关书源引擎（规则/js 沙盒/HTTP/EPUB，零 vscode 依赖）
packages/vscode-ext  VSCode 扩展（阅读 UI/书架/登录/配置）
```

GPL-3.0 © c-hiang
