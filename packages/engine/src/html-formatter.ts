/**
 * 正文 HTML 净化格式化。对齐 legado HtmlFormatter.formatKeepImg 的核心行为：
 * - 块级标签/br 转换行；script/style 移除；实体由 DOM 解码
 * - 图片保留为独立 URL 行（面板模式后续可渲染）
 * - 连续换行压为单换行（正文一段一行）；保留行首 NBSP/全角缩进
 */
import { load } from 'cheerio'
import type { AnyNode } from 'domhandler'

const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'li', 'ul', 'ol', 'table', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'section', 'article', 'header', 'footer', 'pre', 'hr', 'dl', 'dt', 'dd'
])

export function formatContent(html: string): string {
  const $ = load(`<div id="__root">${html}</div>`)
  $('#__root').find('script,style').remove()
  const out: string[] = []
  walk($('#__root')[0]!, out)
  return out
    .join('')
    .replace(/\n{2,}/g, '\n')
    .split('\n')
    .map(line => line.replace(/ +$/, ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
}

function walk(node: AnyNode, out: string[]): void {
  if (node.type === 'text') {
    out.push((node as unknown as { data: string }).data)
    return
  }
  if (node.type !== 'tag' && node.type !== 'root' && node.type !== 'script' && node.type !== 'style') {
    return
  }
  const tag = (node as unknown as { tagName?: string }).tagName ?? ''
  if (tag === 'img') {
    const src = (node as unknown as { attribs?: Record<string, string> }).attribs?.src ?? ''
    if (src) out.push(`\n${src}\n`)
    return
  }
  const children = (node as unknown as { children?: AnyNode[] }).children ?? []
  for (const child of children) walk(child, out)
  if (tag !== '' && BLOCK_TAGS.has(tag)) out.push('\n')
}
