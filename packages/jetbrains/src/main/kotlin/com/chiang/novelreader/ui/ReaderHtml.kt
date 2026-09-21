package com.chiang.novelreader.ui

import com.chiang.novelreader.reader.ReaderController
import com.chiang.novelreader.settings.AppSettings
import java.net.URLEncoder

/** 阅读面板 HTML 生成（对齐 VSCode reader-html.ts；JCEF 渲染，交互走 window.cefQuery） */
object ReaderHtml {

    fun escapeHtml(s: String): String = s
        .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    private fun fontFileUri(): String {
        val f = AppSettings.instance.fontFile.trim()
        if (f.isEmpty()) return ""
        val file = java.io.File(f)
        if (!file.exists()) return ""
        // JCEF 允许 file:// 加载本地字体
        return file.toURI().toString()
    }

    fun render(state: ReaderController.State, imgCache: Map<String, String> = emptyMap()): String {
        val s = AppSettings.instance
        val book = state.book
        val title = book?.name ?: "墨遥·阅山行"
        val chapterTitle = state.chapters.getOrNull(state.chapterIndex)?.title ?: ""

        val body = when {
            state.error != null -> """<div class="error">⚠ ${escapeHtml(state.error!!)}</div>"""
            state.loading && state.content.isEmpty() ->
                listOf(22, 96, 74, 88, 63, 91, 45).joinToString("") {
                    """<div class="skel" style="width:${it}%"></div>"""
                }
            book == null -> """<div class="placeholder">工具栏「搜索书籍」或展开书架选书</div>"""
            else -> {
                val head = if (chapterTitle.isNotEmpty())
                    """<h2 class="chapter-head">${escapeHtml(chapterTitle)}</h2>""" else ""
                head + state.lines.mapIndexed { i, line ->
                    val cls = "line${if (i == state.lineIndex) " cur" else ""}"
                    val m = Regex("^\\[\\[img:(https?://[^\\]]+)\\]\\]$").find(line)
                    when {
                        m != null -> {
                            val src = imgCache[m.groupValues[1]]
                            if (src != null)
                                """<p class="$cls" data-i="$i"><img class="review-img" src="$src" alt="段评"></p>"""
                            else """<p class="$cls" data-i="$i">💬</p>"""
                        }
                        else -> """<p class="$cls" data-i="$i">${escapeHtml(line)}</p>"""
                    }
                }.joinToString("\n")
            }
        }

        val familyName = s.fontFamily.replace(Regex("[';{}]"), "").trim()
        val fontFace = when {
            fontFileUri().isNotEmpty() ->
                """@font-face { font-family: 'nr-custom'; src: url('${fontFileUri()}'); }
  body { font-family: 'nr-custom', sans-serif; }"""
            familyName.isNotEmpty() -> """body { font-family: '$familyName', sans-serif; }"""
            else -> ""
        }
        val widthRule = if (s.contentWidth > 0) "#content { max-width: ${s.contentWidth}px; margin: 0 auto; }" else ""
        val isColor = { v: String -> Regex("^(#[0-9a-fA-F]{3,8}|rgba?\\([\\d.,\\s]+\\))$").matches(v.trim()) }
        val colorRule = if (isColor(s.backgroundColor) || isColor(s.foregroundColor))
            """body { ${if (isColor(s.backgroundColor)) "background-color: ${s.backgroundColor} !important;" else ""} ${if (isColor(s.foregroundColor)) "color: ${s.foregroundColor} !important;" else ""} }"""
        else ""

        return """
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8">
<style>
  body { margin: 0; padding: 8px 16px; font-size: ${s.fontSize}px; line-height: ${s.lineHeight};
         background: #f7f7f7; color: #1e1e1e; }
  @media (prefers-color-scheme: dark) { body { background: #1e1e1e; color: #d4d4d4; } }
  $fontFace
  $widthRule
  $colorRule
  header { display: flex; align-items: center; gap: 8px; position: sticky; top: 0;
           padding: 4px 0 8px; border-bottom: 1px solid rgba(128,128,128,.35);
           background: inherit; z-index: 10; }
  header .chapter { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header .progress { opacity: .6; font-size: 12px; }
  button { border: none; background: rgba(128,128,128,.15); border-radius: 4px;
           padding: 4px 12px; cursor: pointer; }
  #content p { margin: .4em 0; text-indent: 2em; }
  #content p.line.cur { background: rgba(128,128,128,.18); border-left: 3px solid #4b9edd;
                        text-indent: calc(2em - 3px); }
  .review-img { max-width: 100%; border-radius: 6px; }
  .chapter-head { font-size: ${s.fontSize + 4}px; font-weight: 700; text-align: center; margin: .2em 0 .9em; }
  .skel { height: 1em; margin: .9em 0; border-radius: 4px; background: rgba(128,128,128,.16);
          animation: breathe 1.4s ease-in-out infinite; }
  @keyframes breathe { 0%,100% { opacity:.45 } 50% { opacity:1 } }
  .loadbar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; overflow: hidden; }
  .loadbar i { display: block; height: 100%; width: 34%; background: #4b9edd;
               animation: loadbar 1.1s ease-in-out infinite; }
  @keyframes loadbar { 0% { transform: translateX(-120%) } 100% { transform: translateX(400%) } }
  .placeholder { opacity: .6; padding: 2em 0; text-align: center; }
  .error { color: #e55; padding: 1em 0; }
</style></head>
<body>
<header>
  <button onclick="q('prev')">←</button>
  <span class="chapter" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
  <span class="progress">${if (state.chapters.isNotEmpty()) "${state.chapterIndex + 1} / ${state.chapters.size}" else ""}</span>
  <button onclick="q('next')">→</button>
  ${if (state.loading && state.content.isNotEmpty()) """<div class="loadbar"><i></i></div>""" else ""}
</header>
<div id="content">$body</div>
<script>
  function q(cmd) {
    try { window.cefQuery({ request: cmd }) } catch (e) { /* no-op outside JCEF */ }
  }
  function setCur(i, dir) {
    document.querySelectorAll('.line.cur').forEach(n => n.classList.remove('cur'))
    const el = document.querySelector('.line[data-i="' + i + '"]')
    if (el) { el.classList.add('cur'); el.scrollIntoView({ block: dir === 'up' ? 'end' : 'start' }) }
  }
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowDown') q('nextLine')
    if (e.altKey && e.key === 'ArrowUp') q('prevLine')
    if (e.altKey && e.key === 'ArrowRight') q('next')
    if (e.altKey && e.key === 'ArrowLeft') q('prev')
  })
  const cur0 = document.querySelector('.line.cur')
  if (cur0) cur0.scrollIntoView({ block: 'start' })
</script>
</body></html>"""
    }
}
