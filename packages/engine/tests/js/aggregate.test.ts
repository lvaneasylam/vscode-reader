import { describe, it, expect } from 'vitest'
import { evalJsAsync } from '../../src/js/js-runtime.js'

describe('聚合源 JS 能力（Rhino 返回值语义对齐）', () => {
  it('多语句 + 尾随模板字符串返回值（用户报错场景复刻）', async () => {
    const code = `
      let tab = '小说'
      let gysearch = { key: key, tab: tab, page: page }
      gysearch = java.base64Encode(JSON.stringify(gysearch))
      \`data:;base64,\${gysearch},{"type":"gysearch"}\`
    `
    const v = await evalJsAsync(code, { key: '剑来', page: 1 })
    expect(v).toMatch(/^data:;base64,/)
    const payload = Buffer.from(v!.split(',')[1], 'base64').toString('utf-8')
    expect(JSON.parse(payload)).toEqual({ key: '剑来', tab: '小说', page: 1 })
  })

  it('prelude（jsLib）函数库先执行', async () => {
    const v = await evalJsAsync('buildUrl("x")', {}, { prelude: 'function buildUrl(k){ return "https://a.com/" + k }' })
    expect(v).toBe('https://a.com/x')
  })

  it('getVariable/setVariable 源变量（JSON 自动解析为对象）', async () => {
    const vars = new Map<string, string>()
    await evalJsAsync('setVariable("更多设置", JSON.stringify({搜索模式: "小说"}))', {}, {
      variables: { get: k => vars.get(k), set: (k, v) => void vars.set(k, v) }
    })
    const v = await evalJsAsync(
      `let s = getVariable('更多设置'); s ? s['搜索模式'] : '默认'`,
      {},
      {
        variables: { get: k => vars.get(k), set: (k, v) => void vars.set(k, v) }
      }
    )
    expect(v).toBe('小说')
  })

  it('hex 编解码工具', async () => {
    expect(await evalJsAsync('java.hexDecodeToString(java.hexEncodeToString("中文"))')).toBe('中文')
  })

  it('result 赋值语句仍生效（赋值即表达式）', async () => {
    expect(await evalJsAsync('result = java.base64Encode("hi")')).toBe('aGk=')
  })

  it('模板字符串作为跨行实参不误插分号（回归：Unexpected token）', async () => {
    const fakeFetch = async (url: string) => new Response(`ok:${url}`)
    const code = `
      const r = java.ajax(
\`https://a.com/x\`)
      r
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('ok:https://a.com/x')
  })

  it('同行 tagged template（如 String.raw）不受断句影响', async () => {
    expect(await evalJsAsync('String.raw`abc${1+1}`')).toBe('abc2')
  })

  it('尾随模板带显式分号仍正确返回（回归：return 括号内分号）', async () => {
    const code = `
      let x = java.base64Encode('hi')
      \`data:;base64,\${x}\`;
    `
    expect(await evalJsAsync(code)).toBe('data:;base64,aGk=')
  })

  it('全局函数内 this 指向沙盒全局（this.getVariable 可用）', async () => {
    const code = `
      function readVar() {
        return this.getVariable('测试键')
      }
      readVar()
    `
    expect(await evalJsAsync(code, {}, { variables: { get: k => (k === '测试键' ? '值' : ''), set: () => {} } })).toBe('值')
  })

  it('未初始化变量返回空串（宽松语义，书源兜底可用）', async () => {
    const code = `
      let conf = getVariable('云端配置')
      conf['hosts'] || '默认线路'
    `
    expect(await evalJsAsync(code)).toBe('默认线路')
  })

  it('setVariable 接受对象自动 JSON 化', async () => {
    const vars = new Map<string, string>()
    await evalJsAsync(`setVariable('设置', {模式: '小说'})`, {}, {
      variables: { get: k => vars.get(k), set: (k, v) => void vars.set(k, v) }
    })
    expect(JSON.parse(vars.get('设置')!)).toEqual({ 模式: '小说' })
  })
})
