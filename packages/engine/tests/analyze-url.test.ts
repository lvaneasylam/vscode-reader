import { describe, it, expect } from 'vitest'
import { analyzeUrl } from '../src/analyze-url.js'
import { requestText } from '../src/http.js'
import { evalJsAsync } from '../src/js/js-runtime.js'
import type { BookSource } from '../src/types.js'

const evalJs = (code: string, ctx: Record<string, unknown>) => evalJsAsync(code, ctx)

const SOURCE: BookSource = {
  bookSourceUrl: 'https://www.example.com',
  bookSourceName: '示例',
  headerMap: { 'X-Src': 'legado' }
}

describe('analyzeUrl', () => {
  it('{{key}} 与 {{page}} 替换', async () => {
    const r = await analyzeUrl('https://a.com/s?q={{key}}&p={{page}}', { key: '我的', page: 2 }, evalJs)
    expect(r.url).toBe('https://a.com/s?q=我的&p=2')
    expect(r.method).toBe('GET')
  })

  it('相对地址基于书源地址绝对化', async () => {
    const r = await analyzeUrl('/book/1.html', { source: SOURCE }, evalJs)
    expect(r.url).toBe('https://www.example.com/book/1.html')
  })

  it('选项块：POST + body + charset', async () => {
    const r = await analyzeUrl(
      'https://a.com/s,{"method":"POST","body":"k={{key}}","charset":"gbk","retry":2}',
      { key: 'x' },
      evalJs
    )
    expect(r.method).toBe('POST')
    expect(r.body).toBe('k=x')
    expect(r.charset).toBe('gbk')
    expect(r.retry).toBe(2)
    expect(r.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  it('JSON body 设置 json Content-Type', async () => {
    const r = await analyzeUrl('https://a.com,{"method":"POST","body":"{\\"k\\":1}"}', {}, evalJs)
    expect(r.headers['Content-Type']).toBe('application/json')
  })

  it('选项块 headers 与书源 header 合并（选项优先）', async () => {
    const r = await analyzeUrl(
      'https://a.com,{"headers":{"X-Opt":"1","X-Src":"override"}}',
      { source: SOURCE },
      evalJs
    )
    expect(r.headers['X-Src']).toBe('override')
    expect(r.headers['X-Opt']).toBe('1')
  })

  it('@js: 前缀生成 URL', async () => {
    const r = await analyzeUrl('@js:"https://a.com/" + java.md5Encode("abc")', {}, evalJs)
    expect(r.url).toBe('https://a.com/900150983cd24fb0d6963f7d28e17f72')
  })

  it('{{}} 内 JS 表达式', async () => {
    const r = await analyzeUrl('https://a.com/s?sign={{java.md5Encode16("x")}}', {}, evalJs)
    expect(r.url).toContain('sign=')
    expect(r.url).not.toContain('{{')
  })

  it('useWebView 抛不支持', async () => {
    await expect(analyzeUrl('https://a.com,{"useWebView":true}', {}, evalJs)).rejects.toThrow(
      'WebView'
    )
  })

  it('形似选项块的非法 JSON 按普通 URL 处理', async () => {
    const r = await analyzeUrl('https://a.com/cb=?&d={bad', {}, evalJs)
    expect(r.url).toBe('https://a.com/cb=?&d={bad')
  })
})

describe('requestText', () => {
  it('GET 返回解码文本（stub 场景 URL 回退为请求地址）', async () => {
    const fake: typeof fetch = async () =>
      new Response('<p>hi</p>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      }) as Response
    const r = await requestText(
      { url: 'https://a.com', method: 'GET', headers: {}, retry: 0 },
      { fetchFn: fake }
    )
    expect(r.body).toBe('<p>hi</p>')
    expect(r.url).toBe('https://a.com')
  })

  it('charset 指定解码', async () => {
    const bytes = new TextEncoder().encode('中文内容')
    const fake: typeof fetch = async () => new Response(bytes, { status: 200 }) as Response
    const r = await requestText(
      { url: 'https://a.com', method: 'GET', headers: {}, charset: 'utf-8', retry: 0 },
      { fetchFn: fake }
    )
    expect(r.body).toBe('中文内容')
  })

  it('默认请求头与 Referer 注入（legado 对齐）', async () => {
    let seen: RequestInit | undefined
    const fake: typeof fetch = async (_u, init) => {
      seen = init
      return new Response('ok', { status: 200 }) as Response
    }
    await requestText({ url: 'https://a.com/x', method: 'GET', headers: {}, retry: 0 }, { fetchFn: fake })
    const h = seen!.headers as Record<string, string>
    expect(h['User-Agent']).toContain('Windows NT 10.0')
    expect(h['Accept']).toContain('text/html')
    expect(h['Accept-Language']).toContain('zh-CN')
    expect(h['Referer']).toBe('https://a.com/')
  })

  it('书源 headers 覆盖默认头', async () => {
    let seen: RequestInit | undefined
    const fake: typeof fetch = async (_u, init) => {
      seen = init
      return new Response('ok', { status: 200 }) as Response
    }
    await requestText(
      { url: 'https://a.com/x', method: 'GET', headers: { 'User-Agent': 'custom-ua' }, retry: 0 },
      { fetchFn: fake }
    )
    const h = seen!.headers as Record<string, string>
    expect(h['User-Agent']).toBe('custom-ua')
    expect(h['Accept-Language']).toContain('zh-CN')
  })

  it('错误信息展开 cause 链', async () => {
    const fake: typeof fetch = async () => {
      throw new Error('fetch failed', { cause: new Error('unable to verify the first certificate') })
    }
    await expect(
      requestText({ url: 'https://a.com/x', method: 'GET', headers: {}, retry: 0 }, { fetchFn: fake })
    ).rejects.toThrow('unable to verify the first certificate')
  })

  it('失败重试后成功', async () => {
    let calls = 0
    const fake: typeof fetch = async () => {
      calls++
      if (calls < 3) throw new Error('net down')
      return new Response('ok', { status: 200 }) as Response
    }
    const r = await requestText(
      { url: 'https://a.com', method: 'GET', headers: {}, retry: 2 },
      { fetchFn: fake }
    )
    expect(r.body).toBe('ok')
    expect(calls).toBe(3)
  })

  it('cookie jar 读取与写入', async () => {
    const jar = new Map<string, string>([['a.com', 'sid=1']])
    let sentCookie = ''
    const fake: typeof fetch = async (u, init) => {
      sentCookie = (init!.headers as Record<string, string>)['Cookie'] ?? ''
      return new Response('ok', {
        status: 200,
        headers: { 'set-cookie': 'token=abc; Path=/; HttpOnly' }
      }) as Response
    }
    await requestText({ url: 'https://a.com/x', method: 'GET', headers: {}, retry: 0 }, { fetchFn: fake, cookieJar: jar })
    expect(sentCookie).toBe('sid=1')
    expect(jar.get('a.com')).toContain('token=abc')
    expect(jar.get('a.com')).toContain('sid=1')
  })
})
