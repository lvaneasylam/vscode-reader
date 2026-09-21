import { describe, it, expect } from 'vitest'
import { WebBook } from '../src/webbook.js'
import { parseBookSource } from '../src/source-loader.js'
import { analyzeUrl } from '../src/analyze-url.js'
import { requestText } from '../src/http.js'
import { evalJsAsync } from '../src/js/js-runtime.js'

const evalJs = (code: string, ctx: Record<string, unknown>) => evalJsAsync(code, ctx)

describe('聚合搜索源（gysearch 型）', () => {
  const SEARCH_JS = `<js>
    let gysearch = { key: key, tab: '小说', page: page }
    gysearch = java.base64Encode(JSON.stringify(gysearch))
    \`data:;base64,\${gysearch},{"type":"gysearch"}\`
  </js>`

  const SOURCE = {
    bookSourceUrl: 'https://gy.example.com',
    bookSourceName: '聚合源',
    searchUrl: SEARCH_JS,
    // 聚合逻辑：解 hex 载荷 → 由 jsLib 的聚合函数返回 JSON 书籍列表
    ruleSearch: {
      bookList:
        "<js>\nconst params = JSON.parse(java.hexDecodeToString(result));\nreturn gySearch(params.key);\n</js>",
      name: '$.name',
      author: '$.author',
      bookUrl: '$.bookUrl'
    }
  }

  it('analyzeUrl: <js> searchUrl 生成 data URL + type 选项', async () => {
    const built = await analyzeUrl(SEARCH_JS, { key: '剑来', page: 1 }, evalJs)
    expect(built.url).toMatch(/^data:;base64,/)
    expect(built.dataBody).toBeDefined()
    expect(built.hexBody).toBeUndefined()
    // dataBody 是 hex 编码载荷
    const payload = Buffer.from(built.dataBody!, 'hex').toString('utf-8')
    expect(JSON.parse(payload)).toEqual({ key: '剑来', tab: '小说', page: 1 })
  })

  it('requestText: data URL 直通（无网络请求）', async () => {
    let fetched = 0
    const fake: typeof fetch = async () => {
      fetched++
      return new Response('x', { status: 200 }) as Response
    }
    const built = await analyzeUrl(SEARCH_JS, { key: 'k', page: 1 }, evalJs)
    const res = await requestText(built, { fetchFn: fake as never })
    expect(fetched).toBe(0)
    expect(Buffer.from(res.body, 'hex').toString('utf-8')).toBe(JSON.stringify({ key: 'k', tab: '小说', page: 1 }))
  })

  it('WebBook 完整聚合搜索链路（jsLib + @js 规则 + JSON 列表项）', async () => {
    const full = {
      ...SOURCE,
      jsLib: `function gySearch(key) {
        return JSON.stringify([
          { name: key + '之书', author: '作者甲', bookUrl: 'https://real.com/b1' },
          { name: key + '外传', author: '作者乙', bookUrl: 'https://real.com/b2' }
        ])
      }`
    }
    const r = parseBookSource(JSON.stringify(full))
    if (!r.ok) throw new Error(r.error)
    const books = await new WebBook(r.source, {
      fetchFn: (async () => new Response('', { status: 200 })) as never
    }).searchBooks('剑来')
    expect(books).toHaveLength(2)
    expect(books[0]).toMatchObject({
      name: '剑来之书',
      author: '作者甲',
      bookUrl: 'https://real.com/b1',
      originName: '聚合源'
    })
  })
})
