/**
 * EPUB 本地书解析：zip(fflate) → container.xml → OPF(spine/manifest/metadata) → XHTML 转纯文本。
 * 目录（toc）懒解析单章，供书架/阅读链路按需取正文。
 */
import { readFile } from 'node:fs/promises'
import { unzipSync, strFromU8 } from 'fflate'
import { load } from 'cheerio'

export interface EpubMeta {
  name: string
  author: string
  /** 阅读顺序目录（href 为 OPF 包内相对路径，title 取自 nav/toc 或文档标题） */
  toc: Array<{ title: string; href: string }>
  /** OPF 相对根（拼 href 用） */
  baseDir: string
}

/** 解析 EPUB：读元数据与目录（不展开全部正文，章节懒读取） */
export async function readEpubMeta(filePath: string): Promise<EpubMeta> {
  const buf = await readFile(filePath)
  const files = unzipSync(new Uint8Array(buf))
  const text = (name: string): string => {
    const f = files[name]
    return f ? strFromU8(f) : ''
  }

  // container.xml → OPF 路径
  const container = text('META-INF/container.xml')
  const opfPath = /full-path="([^"]+)"/.exec(container)?.[1]
  if (!opfPath) throw new Error('EPUB 结构异常：缺少 container.xml/OPF')
  const opf = text(opfPath)
  if (!opf) throw new Error(`EPUB 结构异常：OPF ${opfPath} 不存在`)
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const $ = load(opf)

  const name = ($('metadata dc\\:title').first().text() || $('metadata title').first().text() || filePath.split('/').pop() || '未命名').trim()
  const author = ($('metadata dc\\:creator').first().text() || '佚名').trim()

  // manifest：id → href
  const manifest = new Map<string, string>()
  $('manifest item').each((_, el) => {
    const id = $(el).attr('id')
    const href = $(el).attr('href')
    if (id && href) manifest.set(id, href)
  })
  // spine：阅读顺序
  const spineHrefs: string[] = []
  $('spine itemref').each((_, el) => {
    const idref = $(el).attr('idref')
    const href = idref ? manifest.get(idref) : undefined
    if (href) spineHrefs.push(decodeURIComponent(href))
  })
  if (spineHrefs.length === 0) throw new Error('EPUB 结构异常：spine 为空')

  // 目录标题：nav(epub:type=toc) 或 toc.ncx，按 href 对齐；缺失回退文档标题/序号
  const titles = new Map<string, string>()
  const navId = $('manifest item[properties~="nav"]').attr('id')
  const navHref = navId ? manifest.get(navId) : undefined
  if (navHref) {
    const nav = load(text(baseDir + decodeURIComponent(navHref)))
    nav('nav a, .toc a').each((_, el) => {
      const a = nav(el)
      const href = a.attr('href')?.split('#')[0]
      if (href && !titles.has(decodeURIComponent(href))) {
        titles.set(decodeURIComponent(href), a.text().trim())
      }
    })
  } else {
    const ncxId = $('spine').attr('toc')
    const ncxHref = ncxId ? manifest.get(ncxId) : undefined
    if (ncxHref) {
      const ncx = load(text(baseDir + decodeURIComponent(ncxHref)))
      ncx('navPoint').each((_, el) => {
        const src = ncx(el).find('content').attr('src')?.split('#')[0]
        const label = ncx(el).find('text').first().text().trim()
        if (src && label) {
          const href = decodeURIComponent(src)
          if (!titles.has(href)) titles.set(href, label)
        }
      })
    }
  }

  const toc = spineHrefs.map((href, i) => {
    let title = titles.get(href)
    if (!title) {
      // 惰性标题回退：文档内 <title> 或 <h1>；取不到用序号
      const doc = load(text(baseDir + href))
      title = (doc('title').text() || doc('h1').first().text() || `第 ${i + 1} 节`).trim()
    }
    return { title, href: baseDir + href }
  })
  return { name, author, toc, baseDir }
}

/** 读取 EPUB 单章正文（XHTML → 段落纯文本，块级元素分行） */
export async function readEpubChapter(filePath: string, baseDir: string, href: string): Promise<string> {
  const buf = await readFile(filePath)
  const files = unzipSync(new Uint8Array(buf))
  const entry = files[baseDir + href] ?? files[href]
  if (!entry) throw new Error(`EPUB 章节不存在：${href}`)
  const $ = load(strFromU8(entry))
  // 常见 EPUB 阅读语义：body 下块级元素各成段
  const parts: string[] = []
  $('body p, body h1, body h2, body h3, body h4, body h5, body h6, body blockquote, body li')
    .each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim()
      if (t) parts.push(t)
    })
  if (parts.length === 0) {
    const whole = $('body').text().replace(/\n{2,}/g, '\n').trim()
    if (whole) parts.push(whole)
  }
  return parts.join('\n')
}
