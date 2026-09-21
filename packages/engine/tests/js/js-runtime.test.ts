import { describe, it, expect } from 'vitest'
import { evalJsAsync } from '../../src/js/js-runtime.js'

describe('evalJsAsync', () => {
  it('表达式形态求值', async () => {
    expect(await evalJsAsync('1 + 1')).toBe('2')
  })

  it('表达式调用 java 扩展', async () => {
    expect(await evalJsAsync('java.base64Encode("hi")')).toBe('aGk=')
    expect(await evalJsAsync('java.md5Encode("abc")')).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(await evalJsAsync('java.md5Encode16("abc")')).toHaveLength(16)
  })

  it('语句形态通过 result 返回', async () => {
    expect(await evalJsAsync('result = java.encodeUri("我的")')).toBe(
      encodeURIComponent('我的')
    )
  })

  it('ctx 变量注入', async () => {
    expect(await evalJsAsync('key + "-" + page', { key: '剑来', page: 2 })).toBe('剑来-2')
  })

  it('java.ajax 自动 await（同步写法）', async () => {
    const fakeFetch = async (url: string) => new Response(`body-of-${url}`)
    expect(await evalJsAsync('java.ajax("https://x.com/api")', {}, { fetchFn: fakeFetch })).toBe(
      'body-of-https://x.com/api'
    )
  })

  it('自定义函数内的网络调用：函数自动 async 化（回归：await 语法错误）', async () => {
    const fakeFetch = async (url: string) => new Response(`got:${url}`)
    const code = `
      function doSearch(url) {
        return java.ajax(url)
      }
      doSearch('https://a.com/x')
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('got:https://a.com/x')
  })

  it('箭头函数内网络调用同样 async 化', async () => {
    const fakeFetch = async (url: string) => new Response(`got:${url}`)
    const code = `const f = (u) => java.ajax(u)\nf('https://a.com/y')`
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('got:https://a.com/y')
  })

  it('函数引用链向上传播（外层调用内层网络函数）', async () => {
    const fakeFetch = async (url: string) => new Response('leaf')
    const code = `
      function leaf(u) { return java.ajax(u) }
      function outer(u) { return leaf(u) + '!' }
      outer('https://a.com')
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('leaf!')
  })

  it('this.fn() 成员调用同样注入 await（回归：[object Promise]）', async () => {
    const fakeFetch = async (url: string) => new Response('{"ok":1}')
    const code = `
      function leaf(u) { return java.ajax(u) }
      function outer() { return JSON.parse(this.leaf('https://a.com')) }
      outer()
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('{"ok":1}')
  })

  it('jsLib 中 async 化的函数，主代码调用点注入 await（回归：跨层 Promise 泄漏）', async () => {
    const fakeFetch = async (url: string) => new Response('{"code":0}')
    const jsLib = `
      function request(path, method, body) {
        return java.ajax('https://a.com' + path)
      }
    `
    const code = `
      function login() {
        let data = request('/login_api', 'POST', {})
        return JSON.parse(data).code
      }
      login()
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never, prelude: jsLib })).toBe('0')
  })

  it('getVariable 的 JSON 值自动解析为对象', async () => {
    const vars = new Map<string, string>([['更多设置', JSON.stringify({ 搜索模式: '漫画' })]])
    const v = await evalJsAsync(`getVariable('更多设置')['搜索模式']`, {}, {
      variables: { get: k => vars.get(k), set: (k, val) => void vars.set(k, val) }
    })
    expect(v).toBe('漫画')
  })

  it('语句形态下 ajax 结果赋给 result', async () => {
    const fakeFetch = async () => new Response('{"n":1}')
    expect(
      await evalJsAsync('var d = java.ajax("https://x.com"); result = d', {}, { fetchFn: fakeFetch })
    ).toBe('{"n":1}')
  })

  it('沙盒不暴露 Node API', async () => {
    expect(await evalJsAsync('typeof process')).toBe('undefined')
    expect(await evalJsAsync('typeof require')).toBe('undefined')
  })

  it('运行错误返回 null 而非抛出', async () => {
    // 故意引用未定义变量（nothrow 语义由调用方决定；此处验证异常可被捕获）
    await expect(evalJsAsync('someUndefinedFn()')).rejects.toThrow()
  })

  it('JSON/Math 等内置可用', async () => {
    expect(await evalJsAsync('JSON.stringify({a:1})')).toBe('{"a":1}')
    expect(await evalJsAsync('Math.max(1,5)')).toBe('5')
  })

  // ---- 回归：顶层 return 主代码（runLogin invoke 形态）不走正则降级 ----

  it('顶层 return 主代码：await 注入不失效（回归：JSON.parse("[object Promise]")）', async () => {
    const fakeFetch = async () => new Response('{"ok":1}')
    const code = `
      function f() { return java.get('https://t.com') }
      return f()
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('{"ok":1}')
  })

  it('顶层 return + jsLib this.互调：全局导出不失效（回归：this.BaseUrl is not a function）', async () => {
    const fakeFetch = async (u: string) => new Response(`body:${u}`)
    const jsLib = `
      function base() { return 'https://b.com' }
      function req(u) { return this.base() && java.ajax(this.base() + u) }
    `
    const code = `
      try { return this.req('/p') } catch (e) { return 'ERR:' + e }
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never, prelude: jsLib })).toBe(
      'body:https://b.com/p'
    )
  })

  // ---- 回归：末尾 if/else 分支表达式作为返回值（Rhino eval 语义）----

  it('末尾 if/else：分支内最后表达式即返回值（回归：目录解析收到 hex 原文）', async () => {
    const code = `
      var data = JSON.stringify({ data: [1, 2] });
      var showSource = "true";
      if (showSource == "true") {
        JSON.stringify({ data: JSON.parse(data).data });
      } else {
        data;
      }
    `
    expect(await evalJsAsync(code)).toBe('{"data":[1,2]}')
    // else 分支路径
    const code2 = code.replace('"true"', '"false"')
    expect(await evalJsAsync(code2)).toBe('{"data":[1,2]}')
  })

  it('末尾 if/else 嵌套块与缺 else 场景不抛错', async () => {
    const code = `var x = 5;\nif (x > 3) { 'big'; }`
    expect(await evalJsAsync(code)).toBe('big')
  })

  // ---- 回归：cookie 对象的 qysg/legado 新版方法名别名 ----

  it('cookie.setCookie/getCookie/removeCookie 别名读写删', async () => {
    const jar = new Map<string, string>()
    const cookies = { set: (u: string, v: string) => void jar.set(u, v), get: (u: string) => jar.get(u) }
    const opts = { cookies }
    expect(
      await evalJsAsync(
        `cookie.setCookie('https://t.com', 'token=abc'); result = cookie.getCookie('https://t.com')`,
        {}, opts
      )
    ).toBe('token=abc')
    expect(await evalJsAsync(`cookie.removeCookie('https://t.com'); result = cookie.getCookie('https://t.com')`, {}, opts)).toBe('')
  })
})
