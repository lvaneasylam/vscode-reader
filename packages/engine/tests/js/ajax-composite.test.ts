import { describe, it, expect } from 'vitest'
import { evalJsAsync } from '../../src/js/js-runtime.js'

describe('java.ajax 复合参数（legado URL 规则）', () => {
  it('"url,{...option}" 形态：POST + body + charset 走完整管线', async () => {
    let seen: { url: string; method?: string; body?: string; headers?: Record<string, string> } | undefined
    const fakeFetch: typeof fetch = async (input, init) => {
      seen = {
        url: String(input),
        method: init?.method,
        body: typeof init?.body === 'string' ? init.body : undefined,
        headers: init?.headers as Record<string, string>
      }
      return new Response('{"ok":1}', { status: 200 }) as Response
    }
    const code = `
      const resp = java.ajax('https://a.com/login,{"method":"POST","body":"u={{key}}","charset":"utf-8"}')
      JSON.parse(resp).ok
    `
    expect(await evalJsAsync(code, { key: 'x' }, { fetchFn: fakeFetch as never })).toBe('1')
    expect(seen!.method).toBe('POST')
    expect(seen!.body).toBe('u=x')
    expect(seen!.url).toBe('https://a.com/login')
    expect(seen!.headers['Content-Type']).toContain('form')
  })

  it('对象参数形态：java.ajax({url, method, headers, body})', async () => {
    let seen: { url: string; method?: string; body?: string } | undefined
    const fakeFetch: typeof fetch = async (input, init) => {
      seen = { url: String(input), method: init?.method, body: init?.body as string }
      return new Response('ok', { status: 200 }) as Response
    }
    const code = `
      java.ajax({url: 'https://a.com/api', method: 'POST', body: '{"k":1}', headers: {'Content-Type': 'application/json'}})
    `
    expect(await evalJsAsync(code, {}, { fetchFn: fakeFetch as never })).toBe('ok')
    expect(seen!.method).toBe('POST')
    expect(seen!.body).toBe('{"k":1}')
  })

  it('纯 URL 形态仍带默认请求头', async () => {
    let headers: Record<string, string> | undefined
    const fakeFetch: typeof fetch = async (_u, init) => {
      headers = init?.headers as Record<string, string>
      return new Response('plain', { status: 200 }) as Response
    }
    expect(await evalJsAsync('java.get("https://a.com/p")', {}, { fetchFn: fakeFetch as never })).toBe('plain')
    expect(headers!['User-Agent']).toContain('Windows NT 10.0')
    expect(headers!['Accept-Language']).toContain('zh-CN')
  })
})
