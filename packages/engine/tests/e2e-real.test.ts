/**
 * 真实书源端到端验证（不进 CI）：node --experimental-strip-types 不适用，
 * 用 vitest 单文件运行：npx vitest run tests/e2e-real.test.ts
 * 使用根目录「聚合书源.txt」跑 搜索→详情→目录→正文 全链路。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseBookSources, WebBook } from '../src/index.js'

const KEY = process.env.E2E_KEY ?? '剑来'

describe('真实书源端到端（聚合书源）', { timeout: 120000 }, () => {
  it('搜索 → 详情 → 目录 → 正文', async () => {
    const raw = readFileSync('/Users/c.hiang/code/reader/聚合书源.txt', 'utf-8')
    const sources = parseBookSources(raw)
    expect(sources.length).toBeGreaterThan(0)
    const wb = new WebBook(sources[0], { timeoutMs: 30000 })

    const books = await wb.searchBooks(KEY)
    console.log(`搜索结果: ${books.length} 本`)
    for (const b of books.slice(0, 5)) console.log(`  - ${b.name} / ${b.author} / ${b.lastChapter ?? ''}`)
    expect(books.length).toBeGreaterThan(0)

    const info = await wb.getBookInfo(books[0].bookUrl)
    console.log('详情:', JSON.stringify({ ...info, intro: (info.intro ?? '').slice(0, 50) }))

    const chapters = await wb.getChapterList(info.tocUrl)
    console.log(`目录: ${chapters.length} 章，首章: ${chapters[0]?.title}`)
    expect(chapters.length).toBeGreaterThan(0)

    const content = await wb.getContent(chapters[0].url)
    console.log(`正文预览: ${content.slice(0, 100).replace(/\n/g, '⏎')}`)
    expect(content.trim().length).toBeGreaterThan(0)
  })
})
