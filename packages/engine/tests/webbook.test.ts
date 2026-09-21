import { describe, it, expect } from 'vitest'
import { WebBook, ContentEmptyError } from '../src/webbook.js'
import { parseBookSource } from '../src/source-loader.js'

const SOURCE_JSON = JSON.stringify({
  bookSourceUrl: 'https://t.com',
  bookSourceName: '测试源',
  searchUrl: 'https://t.com/search?q={{key}}',
  ruleSearch: {
    bookList: 'class.item',
    name: 'tag.h3@text',
    author: 'class.au@text',
    bookUrl: 'tag.a@href'
  },
  ruleBookInfo: {
    name: 'tag.h1@text',
    tocUrl: 'id.catalog@tag.a@href'
  },
  ruleToc: {
    chapterList: 'class.chapters@tag.li',
    chapterName: 'tag.a@text',
    chapterUrl: 'tag.a@href',
    nextTocUrl: 'class.next-page@href'
  },
  ruleContent: {
    content: 'id.content@tag.p@text',
    nextContentUrl: 'class.next@href'
  }
})

/** 假站点：搜索 → 详情 → 目录（2页） → 正文（2页） */
const PAGES: Record<string, string> = {
  'https://t.com/search?q=剑': `
    <div class="list">
      <div class="item"><h3>剑来</h3><span class="au">烽火</span><a href="/book/1.html">详情</a></div>
      <div class="item"><h3>剑域</h3><span class="au">别人</span><a href="/book/2.html">详情</a></div>
    </div>`,
  'https://t.com/book/1.html': `
    <h1>剑来</h1><span>烽火</span>
    <div id="catalog"><a href="/toc/1.html">目录</a></div>`,
  'https://t.com/toc/1.html': `
    <ul class="chapters">
      <li><a href="/ch/1-1.html">第一章</a></li>
      <li><a href="/ch/1-2.html">第二章</a></li>
    </ul>
    <a class="next-page" href="/toc/1.html?p=2">下一页</a>`,
  'https://t.com/toc/1.html?p=2': `
    <ul class="chapters">
      <li><a href="/ch/1-3.html">第三章</a></li>
      <li><a href="/ch/1-4.html">第四章</a></li>
    </ul>`,
  'https://t.com/ch/1-1.html': `
    <div id="content"><p>一段。</p><p>二段。</p></div>
    <a class="next" href="/ch/1-1_2.html">下一页</a>`,
  'https://t.com/ch/1-1_2.html': `
    <div id="content"><p>三段。</p></div>`,
  'https://t.com/ch/1-9.html': `<div id="content"></div>`
}

const fakeFetch: typeof fetch = async (input: RequestInfo | URL) => {
  // new URL 会将非 ASCII（如中文 key）percent-encode，解码后再匹配
  let url = String(input)
  try {
    url = decodeURIComponent(url)
  } catch {
    /* 保留原样 */
  }
  const body = PAGES[url]
  if (body === undefined) return new Response('404', { status: 404 }) as Response
  return new Response(body, { status: 200 }) as Response
}

function makeBook(): WebBook {
  const r = parseBookSource(SOURCE_JSON)
  if (!r.ok) throw new Error(r.error)
  return new WebBook(r.source, { fetchFn: fakeFetch as never })
}

describe('WebBook 四步流程', () => {
  it('搜索：提取书名/作者/详情链接', async () => {
    const books = await makeBook().searchBooks('剑')
    expect(books).toHaveLength(2)
    expect(books[0]).toMatchObject({
      name: '剑来',
      author: '烽火',
      bookUrl: 'https://t.com/book/1.html',
      origin: 'https://t.com',
      originName: '测试源'
    })
  })

  it('详情：提取 tocUrl 并绝对化', async () => {
    const info = await makeBook().getBookInfo('https://t.com/book/1.html')
    expect(info.name).toBe('剑来')
    expect(info.tocUrl).toBe('https://t.com/toc/1.html')
  })

  it('目录：nextTocUrl 分页合并', async () => {
    const chapters = await makeBook().getChapterList('https://t.com/toc/1.html')
    expect(chapters.map(c => c.title)).toEqual(['第一章', '第二章', '第三章', '第四章'])
    expect(chapters[3].url).toBe('https://t.com/ch/1-4.html')
    expect(chapters[3].index).toBe(3)
  })

  it('正文：nextContentUrl 分页拼接 + HTML 净化', async () => {
    const content = await makeBook().getContent('https://t.com/ch/1-1.html', {
      nextChapterUrl: 'https://t.com/ch/1-2.html'
    })
    expect(content).toBe('一段。\n二段。\n三段。')
  })

  it('正文为空抛 ContentEmptyError', async () => {
    await expect(makeBook().getContent('https://t.com/ch/1-9.html')).rejects.toBeInstanceOf(
      ContentEmptyError
    )
  })
})

describe('WebBook 配置缺失', () => {
  it('searchUrl 未配置时报错', async () => {
    const r = parseBookSource(JSON.stringify({ bookSourceUrl: 'https://t.com' }))
    if (!r.ok) throw new Error(r.error)
    await expect(new WebBook(r.source, { fetchFn: fakeFetch as never }).searchBooks('x')).rejects.toThrow(
      'searchUrl'
    )
  })
})
