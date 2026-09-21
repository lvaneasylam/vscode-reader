import { describe, it, expect } from 'vitest'
import { WebBook } from '../src/webbook.js'
import { parseBookSource } from '../src/source-loader.js'

describe('loginUi 表单登录（对齐 SourceLoginDialog）', () => {
  const SOURCE_JSON = JSON.stringify({
    bookSourceUrl: 'https://t.com',
    bookSourceName: '登录测试源',
    loginUrl: `
      function login() {
        java.setCookie('https://t.com', 'uid=' + result['账号'] + '; token=' + java.md5Encode(result['密码']))
      }
    `,
    loginUi: JSON.stringify([
      { name: '账号', type: 'text', holder: '手机号/邮箱' },
      { name: '密码', type: 'password' }
    ]),
    searchUrl: 'https://t.com/search?q={{key}}',
    ruleSearch: { bookList: 'class.item', name: 'tag.h3@text', bookUrl: 'tag.a@href' },
    ruleToc: { chapterList: 'class.chapters@tag.li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: { content: 'id.content@text' }
  })

  it('runLogin 执行 login() 并把 setCookie 写入请求 cookieJar', async () => {
    const r = parseBookSource(SOURCE_JSON)
    if (!r.ok) throw new Error(r.error)
    const wb = new WebBook(r.source, { fetchFn: (async () => new Response('', { status: 200 })) as never })

    await wb.runLogin({ 账号: 'user01', 密码: 'abc' })

    // 表单数据经 result 变量可见 + cookie 落盘（通过后续请求携带验证）
    let sentCookie = ''
    const fakeFetch: typeof fetch = async (_u, init) => {
      sentCookie = (init!.headers as Record<string, string>)['Cookie'] ?? ''
      return new Response(
        '<div class="item"><h3>书</h3><a href="/b/1">x</a></div>',
        { status: 200 }
      ) as Response
    }
    const wb2 = new WebBook(r.source, { fetchFn: fakeFetch as never })
    await wb2.runLogin({ 账号: 'user01', 密码: 'abc' })
    await wb2.searchBooks('任意')
    expect(sentCookie).toContain('uid=user01')
    expect(sentCookie).toContain(`token=${MD5_OF_ABC}`)
  })

  it('未实现 login 函数时明确报错', async () => {
    const r = parseBookSource(
      JSON.stringify({ ...JSON.parse(SOURCE_JSON), loginUrl: 'var x = 1' })
    )
    if (!r.ok) throw new Error(r.error)
    await expect(new WebBook(r.source).runLogin({ a: 'b' })).rejects.toThrow('login not implements')
  })

  it('沙盒 cookie.put 与 java.getCookie 互通', async () => {
    const r = parseBookSource(
      JSON.stringify({
        ...JSON.parse(SOURCE_JSON),
        loginUrl: `
          function login() {
            cookie.put('https://t.com', 'sid=xyz')
          }
        `
      })
    )
    if (!r.ok) throw new Error(r.error)
    const wb = new WebBook(r.source)
    await wb.runLogin({})
    expect(await wb.runJs("result = java.getCookie('https://t.com')")).toBe('sid=xyz')
  })
})

/** 'abc' 的 MD5（与 java.md5Encode 实现一致） */
const MD5_OF_ABC = '900150983cd24fb0d6963f7d28e17f72'

/**
 * 聚合书源同构最小复制品：多线路 + cookie.setCookie(qysg API) + this.互调 + 顶层 return invoke。
 * 锁定三层根因回归：R1(顶层 return 不降级) R2(cookie 别名) R3(状态注入共享)。
 */
describe('聚合同构：多线路 token 登录', () => {
  const HOSTS = ['https://l1.t.com', 'https://l2.t.com']
  const GY_SOURCE = JSON.stringify({
    bookSourceUrl: 'https://l1.t.com',
    bookSourceName: '聚合同构源',
    jsLib: `
      var hosts = ${JSON.stringify(HOSTS)};
      function BaseUrl() { return hosts[0]; }
      function request(path, method, body) {
        const { java } = this;
        let urla = this.BaseUrl() + path;
        const options = { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
        urla = urla + ',' + JSON.stringify(options);
        return java.ajax(urla);
      }
      function getToken() {
        const { cookie } = this;
        for (let h of hosts) {
          let v = String(cookie.getCookie(h));
          for (let part of v.split(';')) {
            if (part.includes('token')) return part.split('=')[1];
          }
        }
        return '';
      }
      function setAllCookies(ck) {
        const { cookie } = this;
        for (let h of hosts) { cookie.setCookie(h, ck); }
      }
    `,
    loginUrl: `
      function login(flag) {
        let data = request('/login_api', 'POST', { email: result['邮箱'], pwd: result['密码'] });
        const response = JSON.parse(data);
        if (response.code == 0) {
          setAllCookies('token=' + response.key);
          return 'true';
        }
        throw 'login failed: ' + response.msg;
      }
    `,
    loginUi: JSON.stringify([{ name: '邮箱', type: 'text' }, { name: '密码', type: 'password' }]),
    searchUrl: 'https://l1.t.com/search?q={{key}}',
    ruleSearch: { bookList: 'class.item', name: 'tag.h3@text', bookUrl: 'tag.a@href' },
    ruleToc: { chapterList: 'class.chapters@tag.li', chapterName: 'tag.a@text', chapterUrl: 'tag.a@href' },
    ruleContent: { content: 'id.content@text' }
  })

  const loginOkFetch: typeof fetch = (async (u: RequestInfo | URL) => {
    if (String(u).includes('/login_api')) {
      return new Response(JSON.stringify({ code: 0, key: 'TOKEN_X_123456' }), { status: 200 })
    }
    return new Response('<div class="item"><h3>书</h3><a href="/b/1">x</a></div>', { status: 200 })
  }) as never

  function parse() {
    const r = parseBookSource(GY_SOURCE)
    if (!r.ok) throw new Error(r.error)
    return r.source
  }

  it('runLogin 全链路：request→setAllCookies→外部 jar 落有 token', async () => {
    const jar = new Map<string, string>()
    const vars = new Map<string, string>()
    const wb = new WebBook(parse(), {
      fetchFn: loginOkFetch,
      cookieJar: jar,
      sourceVariables: vars
    })
    await expect(wb.runLogin({ 邮箱: 'a@b.c', 密码: 'p' })).resolves.toBe('true')
    // 桥两端经 hostOf 归一化，键为裸 host
    for (const h of HOSTS) {
      expect(jar.get(new URL(h).host)).toBe('token=TOKEN_X_123456')
    }
  })

  it('状态跨实例：第二个 WebBook 注入同一 jar/vars 后 getToken 直接可读', async () => {
    const jar = new Map<string, string>()
    const vars = new Map<string, string>()
    const wb1 = new WebBook(parse(), { fetchFn: loginOkFetch, cookieJar: jar, sourceVariables: vars })
    await wb1.runLogin({ 邮箱: 'a@b.c', 密码: 'p' })

    const wb2 = new WebBook(parse(), { fetchFn: loginOkFetch, cookieJar: jar, sourceVariables: vars })
    expect(await wb2.runJs('String(getToken())')).toBe('TOKEN_X_123456')
  })

  it('搜索请求自动携带共享 jar 中的登录态', async () => {
    const jar = new Map<string, string>()
    const vars = new Map<string, string>()
    const wb1 = new WebBook(parse(), { fetchFn: loginOkFetch, cookieJar: jar, sourceVariables: vars })
    await wb1.runLogin({ 邮箱: 'a@b.c', 密码: 'p' })

    let sentCookie = ''
    const spyFetch: typeof fetch = (async (_u, init) => {
      sentCookie = (init!.headers as Record<string, string>)['Cookie'] ?? ''
      return new Response('<div class="item"><h3>书</h3><a href="/b/1">x</a></div>', { status: 200 })
    }) as never
    const wb2 = new WebBook(parse(), { fetchFn: spyFetch, cookieJar: jar, sourceVariables: vars })
    await wb2.searchBooks('任意')
    expect(sentCookie).toContain('token=TOKEN_X_123456')
  })
})
