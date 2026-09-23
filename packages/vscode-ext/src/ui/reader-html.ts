import type { ReaderState } from '../reader-controller.js'

/** 面板外观设置（读自插件配置；fontFileUri 为经 webview.asWebviewUri 转换的字体地址） */
export interface PanelAppearance {
  fontSize: number
  lineHeight: number
  contentWidth: number
  fontFamily: string
  fontFileUri?: string
  /** 自定义背景/文字色（空 = 跟随 VSCode 主题深浅色） */
  background: string
  foreground: string
}

/** 阅读面板 HTML（主题跟随 VSCode 变量；按钮经 postMessage 通知扩展） */
export function renderReaderHtml(
  state: ReaderState,
  look: PanelAppearance = { fontSize: 15, lineHeight: 1.9, contentWidth: 0, fontFamily: '', background: '', foreground: '' },
  imgCache: Record<string, string> = {}
): string {
  const title = state.book ? state.book.name : '墨遥·阅山行'
  const chapterTitle = state.chapters[state.chapterIndex]?.title ?? ''
  const progress =
    state.chapters.length > 0 ? `${state.chapterIndex + 1} / ${state.chapters.length}` : ''

  let body: string
  if (state.error) {
    body = `<div class="error">$(error) ${escapeHtml(state.error)}</div>`
  } else if (state.loading && !state.content) {
    // 首次打开/无旧内容：骨架屏示意加载
    body = [22, 96, 74, 88, 63, 91, 45]
      .map(w => `<div class="skel" style="width:${w}%"></div>`)
      .join('')
  } else if (!state.book) {
    body = '<div class="placeholder">从侧边栏书架选择书籍，或使用命令「墨遥·阅山行: 搜索书籍」</div>'
  } else {
    // 渲染与 controller.state.lines 同源（已含分段），行号/高亮严格对齐。
    // 章节名作为正文标题（配置字号 +4 加粗），不占行号
    const chapterHead = chapterTitle
      ? `<h2 class="chapter-head">${escapeHtml(chapterTitle)}</h2>`
      : ''
    body =
      chapterHead +
      state.lines
        .map((line, i) => {
        const cls = `class="line${i === state.lineIndex ? ' cur' : ''}"`
        const m = /^\[\[img:(https?:\/\/[^\]]+)\]\]$/.exec(line)
        if (m) {
          // 段评图：缓存命中直接渲染；未命中渲染 💬 占位（带 data-img），拉取完成后
          // 由 imgReady 消息局部替换占位——不整页重设 HTML，滚动位置不受影响
          const src = imgCache[m[1]]
          return src
            ? `<p ${cls} data-i="${i}"><img class="review-img" src="${src}" alt="段评" loading="lazy"></p>`
            : `<p ${cls} data-i="${i}" data-img="${escapeHtml(m[1])}">💬</p>`
        }
          return `<p ${cls} data-i="${i}">${escapeHtml(line)}</p>`
        })
        .join('\n')
  }

  // 字体优先级：字体文件（@font-face 注入）> 字体名 > VSCode 默认（字体名过滤防 CSS 注入）
  const familyName = look.fontFamily.replace(/[';{}]/g, '').trim()
  const fontFace = look.fontFileUri
    ? `@font-face { font-family: 'novel-reader-custom'; src: url('${look.fontFileUri}'); }
  body { font-family: 'novel-reader-custom', var(--vscode-font-family); }`
    : familyName
      ? `body { font-family: '${familyName}', var(--vscode-font-family); }`
      : ''
  const widthRule =
    look.contentWidth > 0
      ? `#content { max-width: ${look.contentWidth}px; margin: 0 auto; }`
      : ''
  // 配置色优先（校验为合法十六进制/rgb 值，防注入）；否则跟随 VSCode 主题
  const isColor = (v: string): boolean => /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s]+\))$/i.test(v.trim())
  const colorRule =
    isColor(look.background) || isColor(look.foreground)
      ? `body {
    ${isColor(look.background) ? `background-color: ${look.background.trim()} !important;` : ''}
    ${isColor(look.foreground) ? `color: ${look.foreground.trim()} !important;` : ''}
  }
  header { background: ${isColor(look.background) ? look.background.trim() : 'var(--vscode-panel-background)'} !important; }`
      : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background-color: var(--vscode-background, var(--vscode-panel-background));
    padding: 8px 16px;
    font-size: ${look.fontSize}px;
    line-height: ${look.lineHeight};
  }
  ${fontFace}
  ${widthRule}
  ${colorRule}
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--vscode-panel-border);
    padding-bottom: 6px;
    margin-bottom: 10px;
    position: sticky;
    top: 0;
    background: var(--vscode-panel-background);
  }
  header .book { font-weight: 600; }
  /* 章节名绝对定位真居中（flex 两侧按钮宽度不等，text-align 会偏），限宽防压按钮 */
  header .chapter {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    max-width: calc(100% - 170px);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  header .progress { opacity: 0.6; font-size: 12px; margin-left: auto; }
  /* 加载条贴 header 底边（不依赖滚动位置），3px + 光晕保证醒目 */
  .loadbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: transparent;
    overflow: hidden;
  }
  .loadbar i {
    display: block;
    height: 100%;
    width: 34%;
    background: var(--vscode-focusBorder, #4b9edd);
    box-shadow: 0 0 6px var(--vscode-focusBorder, #4b9edd);
    animation: loadbar 1.1s ease-in-out infinite;
  }
  @keyframes loadbar {
    0% { transform: translateX(-120%); }
    100% { transform: translateX(400%); }
  }
  .skel {
    height: 1em;
    margin: 0.9em 0;
    border-radius: 4px;
    background: var(--vscode-editorWidget-background, rgba(128, 128, 128, 0.16));
    animation: breathe 1.4s ease-in-out infinite;
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
  }
  button {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #content p { margin: 0.4em 0; text-indent: 2em; }
  #content p:first-child { font-weight: 600; }
  #content p.line.cur {
    background: var(--vscode-editor-lineHighlightBackground, rgba(128, 128, 128, 0.18));
    border-left: 3px solid var(--vscode-focusBorder, #4b9edd);
    text-indent: calc(2em - 3px);
  }
  #content .review-img {
    max-width: 100%;
    border-radius: 6px;
    margin: 0.4em 0;
    opacity: 0.92;
  }
  .chapter-head {
    font-size: ${look.fontSize + 4}px;
    font-weight: 700;
    margin: 0.2em 0 0.9em;
    line-height: 1.5;
    text-align: center;
  }
  .placeholder { opacity: 0.6; padding: 2em 0; text-align: center; }
  .error { color: var(--vscode-errorForeground); padding: 1em 0; }
  .loading { opacity: 0.6; }
</style>
</head>
<body>
  <header>
    <button id="btn-prev" title="上一章 (Alt+←)">←</button>
    <span class="chapter" title="${escapeHtml(chapterTitle || title)}">${escapeHtml(title)}</span>
    <span class="progress">${escapeHtml(progress)}</span>
    <button id="btn-next" title="下一章 (Alt+→)">→</button>
    ${state.loading && state.content ? '<div class="loadbar"><i></i></div>' : ''}
  </header>
  <div id="content" class="${state.loading ? 'loading' : ''}">${body}</div>
  <script>
    const vscode = acquireVsCodeApi()
    document.getElementById('btn-prev').onclick = () => vscode.postMessage({ type: 'prev' })
    document.getElementById('btn-next').onclick = () => vscode.postMessage({ type: 'next' })
    // 点击某行 → 该行成为当前行（进度锚点）。仅切高亮，页面不滚动。
    document.getElementById('content').addEventListener('click', e => {
      const p = e.target.closest('.line')
      if (p && p.dataset.i !== undefined) vscode.postMessage({ type: 'jumpLine', i: +p.dataset.i, noScroll: true })
    })
    // 翻行轻量更新：仅移动高亮并滚动跟随。长段（高于视口）向下翻滚到段首、
    // 向上翻滚到段尾——block:'center' 会让高段两头截断，产生"内容缺失"的错觉
    window.addEventListener('message', e => {
      const d = e.data
      const i = d?.type === 'setCur' ? d.i : -1
      if (i >= 0) {
        document.querySelectorAll('.line.cur').forEach(n => n.classList.remove('cur'))
        const el = document.querySelector('.line[data-i="' + i + '"]')
        if (el) {
          el.classList.add('cur')
          if (!d.noScroll) el.scrollIntoView({ block: d.dir === 'up' ? 'end' : 'start' })
        }
        return
      }
      // 段评图补图：只替换占位行内部 DOM，页面滚动位置不动
      if (d?.type === 'imgReady' && d.url && d.src) {
        const sel = '.line[data-img="' + String(d.url).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]'
        const el = document.querySelector(sel)
        if (el) {
          el.removeAttribute('data-img')
          el.innerHTML = '<img class="review-img" src="' + d.src + '" alt="段评" loading="lazy">'
        }
      }
    })
    // 整页渲染后恢复到当前行（从段首开始读）
    const cur0 = document.querySelector('.line.cur')
    if (cur0) cur0.scrollIntoView({ block: 'start' })
  </script>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
