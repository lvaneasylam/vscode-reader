import { describe, it, expect } from 'vitest'
import { WebBook } from '../src/webbook.js'
import { parseBookSource } from '../src/source-loader.js'

const SOURCE_JSON = JSON.stringify({
  bookSourceUrl: 'https://t.com',
  bookSourceName: 'source绑定测试',
  jsLib: `
    function readSourceInfo() {
      return source.bookSourceName + '|' + source.getVariable('线路') + '|' + JSON.stringify(source.getLoginInfoMap()['账号'] ?? '')
    }
  `,
  searchUrl: 'https://t.com/s?q={{key}}',
  ruleSearch: { bookList: 'class.item', name: 'tag.h3@text', bookUrl: 'tag.a@href' },
  ruleToc: { chapterList: 'class.c@tag.li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
  ruleContent: { content: 'id.c@text' }
})

describe('沙盒 source 对象绑定', () => {
  it('source 属性与变量存取可用', async () => {
    const r = parseBookSource(SOURCE_JSON)
    if (!r.ok) throw new Error(r.error)
    const wb = new WebBook(r.source)
    expect(await wb.runJs("source.setVariable('线路', 'v2')")).toBeNull()
    expect(await wb.runJs('readSourceInfo()')).toBe('source绑定测试|v2|""')
  })

  it('runLogin 后 getLoginInfoMap 返回表单数据', async () => {
    const r = parseBookSource(
      JSON.stringify({
        ...JSON.parse(SOURCE_JSON),
        loginUrl: 'function login() { source.setVariable("登录后", "ok") }'
      })
    )
    if (!r.ok) throw new Error(r.error)
    const wb = new WebBook(r.source)
    await wb.runLogin({ 账号: 'user', 密码: 'pw' })
    expect(await wb.runJs("JSON.stringify(source.getLoginInfoMap())")).toBe(
      JSON.stringify({ 账号: 'user', 密码: 'pw' })
    )
    expect(await wb.runJs('source.getLoginInfo()')).toBe(JSON.stringify({ 账号: 'user', 密码: 'pw' }))
  })

  it('putLoginInfoMap / removeLoginInfo', async () => {
    const r = parseBookSource(SOURCE_JSON)
    if (!r.ok) throw new Error(r.error)
    const wb = new WebBook(r.source)
    await wb.runJs("source.putLoginInfoMap({k: 'v'})")
    expect(await wb.runJs('source.getLoginInfo()')).toBe(JSON.stringify({ k: 'v' }))
    await wb.runJs('source.removeLoginInfo()')
    expect(await wb.runJs('source.getLoginInfo()')).toBe('')
  })

  it('runButtonAction 执行 loginUrl 库 + 按钮 action', async () => {
    const r = parseBookSource(
      JSON.stringify({
        ...JSON.parse(SOURCE_JSON),
        loginUrl: `function switchLine(line) { source.setVariable('线路', line); return '已切换到' + line }`
      })
    )
    if (!r.ok) throw new Error(r.error)
    const wb = new WebBook(r.source)
    const out = await wb.runButtonAction(`switchLine('v3')`, {})
    expect(out).toBe('已切换到v3')
    expect(await wb.runJs("source.getVariable('线路')")).toBe('v3')
  })
})
