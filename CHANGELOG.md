# 墨遥·阅山行（novel-reader）变更记录

> VSCode 扩展：把 legado（阅读）的自定义书源机制移植到 VSCode，在编辑器里看小说。

## 2026-09-21

### 稳定性
- **修复扩展宿主 TLS 全挂**：`DEFAULT@SECLEVEL=0` 是 Debian 专有 OpenSSL 语法，VSCode 扩展宿主（Electron OpenSSL）不识别导致所有 https 请求 `INVALID_COMMAND`；改为 `rejectUnauthorized:false + minVersion:'TLSv1'`（终端与扩展宿主双兼容）
- **修复激活崩溃**：`removeShelfBook` 被注册两次 → `command already exists` → 扩展激活失败、所有命令 not found
- 激活时机改为 `onStartupFinished`（设置页命令链接等所有入口均可用）
- 排障基建：请求失败告警 + `java.ajax` 失败经 log 桥 + `debugLog` 落盘 `os.tmpdir()/novel-reader-debug.log`（扩展宿主 console.* 不落盘）

### 阅读体验
- 面板/侧边栏：当前行高亮 + 翻行滚动跟随（向下滚段首、向上滚段尾，修复长段居中截断的"内容缺失"错觉）；翻行仅 postMessage 移动高亮不整页重绘
- 状态栏：长行按显示宽度切段（`statusBarWidth` 可配），Alt+↓ 逐段读完，段尾 `…` 提示
- 加载反馈：切章保留旧内容 + header 底部流动进度条（两段式渲染，不被段评图代理阻塞）；首开骨架屏
- 正文净化：段评 `data:image` → 💬、base64 载荷行隐藏、`URL+,{"type":…}` 段评图请求 → 代理拉图真渲染（webview 无登录态，由扩展宿主带 token 拉 SVG 转 data URI）
- header：书名居中；正文最前章节名（配置字号+4 加粗居中）
- 活动栏图标更换（用户提供的书本 SVG，currentColor 自适应主题）

### 功能
- **配置中心**（设置页 `novelReader.*`）：字号/行高/正文宽度/字体名/字体文件（命令选择 .ttf/.otf 即时生效）/背景色/文字色/章末自动翻章/状态栏宽度/章节缓存数/**向后预加载章节数**（LRU 保护在读章节）
- **侧边栏阅读模式**：readLocation 三态（底部面板/侧边栏/状态栏），切换命令轮换，点书/章节自动 reveal 对应视图
- **目录缓存**：打开书拉到目录落盘 globalState（md5 键），书架树离线可浏览任何书的章节；刷新目录按钮（标题栏=当前书，行内=指定书）
- 章节树：已缓存正文 🗄 标记、正在读 🔖；删书功能补全（确认框 + 关闭在读幽灵书）
- **设置栏**（容器顶部树视图）：导入书源/管理书源/书源登录/插件设置直达
- 扩展更名「墨遥·阅山行」（ID 与配置键不变，数据无损）

## 2026-09-20

### 登录链路修复（聚合书源等 token 型书源）
- **R1**：`js-runtime` 四处 acorn parse 缺 `allowReturnOutsideFunction` → 顶层 return 的登录脚本（`return login.apply(this)`）静默降级正则 fallback，await 注入与 jsLib 全局导出全失效（"💔登录失败，服务器错误"、`this.BaseUrl is not a function` 的根因）
- **R2**：沙盒 `cookie` 补 `setCookie/getCookie/removeCookie`（qysg/legado 新版 API 名）
- **R3**：`WebBook` 支持 `cookieJar/sourceVariables` 注入；`SourceStateStore` 按源共享 + globalState（`novelReader.sourceState`）防抖持久化——登录态/线路/云端配置跨实例、跨会话保持
- **token 直登**：书源登录菜单「Cookie 管理 / token 直登」，优先复用书源 `setAllCookies` 写全线路域名，成功后清 headerMap.Cookie 防遮蔽
- 实测结论：example.com（字节系 WAF）HTTP/1.1 + 有效 token 即可访问；h2 或空/无效 token 一律 502

### 重 JS 书源规则引擎（七项兼容修复）
- 段切分 trim（`</js>\n$.data` 尾段空白绕过 JSON 规则判定）
- `jsonGetElements` 展平数组值（`$.data` 返回嵌套数组）
- `getString` wholeJs 贪婪正则重构：多 `{{}}` 拼接规则（`{{$.a}},{{$.b}}`）逐块求值，修复 `Unexpected token '}'` 炸搜索
- `{{$.field}}` 内嵌 JSONPath 分流（此前被当 JS 执行抛 `$ is not defined`）
- JS 段 `result` 保留原始类型（对象不再字符串化，`result.book_id` 可用）
- 末尾 `if/else` 的 Rhino eval 语义（`returnifyBranches` 各分支末表达式 return 化）
- 沙盒绑定补齐：`java.put/get`（单参缓存读/URL 形态仍 HTTP）、`book`/`chapter` Proxy（方法长尾 no-op 兜底）、`cache.putMemory/getMemory`

### 验证
- engine 134 用例全绿（含聚合同构最小复制品的登录/搜索/状态共享回归）
- 真网四步全链路（搜索 246 本 → 详情 → 目录 553 章 → 正文 10 万字）打通
