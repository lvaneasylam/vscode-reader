/**
 * engine-sidecar：engine 的行协议 JSON-RPC 服务（stdin/stdout，每行一个 JSON）。
 * Kotlin 宿主以子进程方式驱动；书源 JS 沙盒（node:vm）与 undici 网络都在本进程。
 *
 * 请求行：{"id":1,"method":"searchBooks","params":{...}}
 * 响应行：{"id":1,"ok":true,"result":...} | {"id":1,"ok":false,"error":"..."}
 * 事件行：{"event":"toast","data":"..."}
 *
 * 每 cookieJar / 源变量按 bookSourceUrl 隔离，持久化到 --data-dir/state.json（1s 防抖），
 * 语义对齐 VSCode 版 SourceStateStore。
 */
import { createInterface } from 'node:readline'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  WebBook,
  parseBookSources,
  checkUnsupported,
  readEpubMeta,
  readEpubChapter,
  type BookSource
} from '../../engine/src/index.js'

// ---------- data-dir 与运行态持久化 ----------

let dataDir = ''
const stateFile = () => path.join(dataDir, 'state.json')
/** bookSourceUrl -> { cookies: Record<host,string>, variables: Record<string,string> } */
let state: Record<string, { cookies: Record<string, string>; variables: Record<string, string> }> = {}
let flushTimer: NodeJS.Timeout | undefined

function loadState(): void {
  try {
    state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'))
  } catch {
    state = {}
  }
}

function scheduleFlush(): void {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = undefined
    try {
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(stateFile(), JSON.stringify(state))
    } catch {
      /* 写盘失败不致命（内存态仍有效） */
    }
  }, 1000)
}

// ---------- WebBook 实例池（登录态共享） ----------

const webbooks = new Map<string, WebBook>()

/** 运行时网络选项（宿主 setOption 可改；改动后清空实例池重建生效） */
const globalOpts = { insecureTLS: true, timeoutMs: 20000 }

function webbookOf(source: BookSource): WebBook {
  const hit = webbooks.get(source.bookSourceUrl)
  if (hit) return hit
  const key = source.bookSourceUrl
  const saved = state[key] ?? { cookies: {}, variables: {} }
  const cookies = new Map(Object.entries(saved.cookies))
  const variables = new Map(Object.entries(saved.variables))
  const wb = new WebBook(source, {
    cookieJar: cookies,
    sourceVariables: variables,
    insecureTLS: globalOpts.insecureTLS,
    timeoutMs: globalOpts.timeoutMs,
    toast: (msg: string) => emit('toast', msg),
    log: (msg: string) => emit('log', msg)
  })
  webbooks.set(key, wb)
  // 桥接到持久化：轮询合并（Map 无法观察原生 set——WebBook 持引用原地改，收尾 flush 快照）
  scheduleFlush()
  return wb
}

/** 方法收尾统一快照（cookie/变量写回 state 并防抖落盘） */
function snapshot(source: BookSource): void {
  const wb = webbooks.get(source.bookSourceUrl)
  if (!wb) return
  const saved = state[source.bookSourceUrl] ?? { cookies: {}, variables: {} }
  saved.cookies = Object.fromEntries(wbCookieJar(wb))
  saved.variables = Object.fromEntries(wbVariables(wb))
  state[source.bookSourceUrl] = saved
  scheduleFlush()
}

// WebBook 私有字段读取（同一进程内白盒访问，避免为持久化改 engine API）
function wbCookieJar(wb: WebBook): Map<string, string> {
  return (wb as unknown as { cookieJar: Map<string, string> }).cookieJar
}
function wbVariables(wb: WebBook): Map<string, string> {
  return (wb as unknown as { sourceVariables: Map<string, string> }).sourceVariables
}

// ---------- 协议 ----------

type Req = { id: number; method: string; params: Record<string, unknown> }

function send(line: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(line) + '\n')
}

function emit(event: string, data: unknown): void {
  send({ event, data: typeof data === 'string' ? data : JSON.stringify(data) })
}

async function dispatch(req: Req): Promise<unknown> {
  const p = req.params ?? {}
  const source = (p.source as BookSource | undefined) ?? null
  const wb = source ? webbookOf(source) : null
  switch (req.method) {
    case 'ping':
      return { pong: true, version: process.version }
    case 'parseSources':
      return parseBookSources(String(p.text ?? '')).map(s => ({
        source: s,
        unsupported: checkUnsupported(s)
      }))
    case 'searchBooks':
      return wb!.searchBooks(String(p.key ?? ''), Number(p.page ?? 1))
    case 'getBookInfo':
      return wb!.getBookInfo(String(p.bookUrl ?? ''))
    case 'getChapterList':
      return wb!.getChapterList(String(p.tocUrl ?? ''))
    case 'getContent':
      return wb!.getContent(String(p.chapterUrl ?? ''), {
        nextChapterUrl: p.nextChapterUrl ? String(p.nextChapterUrl) : undefined
      })
    case 'runLogin':
      return wb!.runLogin((p.data as Record<string, string>) ?? {})
    case 'runButtonAction':
      return wb!.runButtonAction(String(p.action ?? ''), (p.data as Record<string, string>) ?? {})
    case 'runJs':
      return wb!.runJs(String(p.code ?? ''))
    case 'getLoginUi':
      return source ? String(source.loginUi ?? '') : ''
    case 'parseExplore':
      // 必须走 WebBook.getExploreEntries()（沙盒执行 <js> 动态生成分类）——
      // 静态版 parseExploreEntries 对 <js> 形态会把整段 JS 原文当分类 URL 返回
      return wb ? wb.getExploreEntries() : []
    case 'exploreBooks':
      return wb!.exploreBooks(String(p.exploreUrl ?? ''), Number(p.page ?? 1))
    case 'readEpubMeta':
      return readEpubMeta(String(p.filePath ?? ''))
    case 'readEpubChapter':
      return readEpubChapter(String(p.filePath ?? ''), '', String(p.href ?? ''))
    case 'setOption':
      if (typeof p.insecureTLS === 'boolean') globalOpts.insecureTLS = p.insecureTLS
      if (typeof p.timeoutMs === 'number' && p.timeoutMs >= 3000) globalOpts.timeoutMs = Math.floor(p.timeoutMs)
      webbooks.clear() // 实例池按旧选项构造：清空后下次调用重建
      return true
    case 'flush':
      if (source) snapshot(source)
      try {
        fs.mkdirSync(dataDir, { recursive: true })
        fs.writeFileSync(stateFile(), JSON.stringify(state))
      } catch {
        /* 忽略 */
      }
      return true
    default:
      throw new Error(`未知方法: ${req.method}`)
  }
}

// ---------- main ----------

function main(): void {
  const idx = process.argv.indexOf('--data-dir')
  dataDir = idx >= 0 ? process.argv[idx + 1] : path.join(process.cwd(), 'novel-reader-data')
  // 启动参数携带的网络选项（宿主设置项初始值）
  const argBool = (name: string): boolean | undefined => {
    const i = process.argv.indexOf(name)
    return i >= 0 ? process.argv[i + 1] === '1' : undefined
  }
  const argNum = (name: string): number | undefined => {
    const i = process.argv.indexOf(name)
    const v = i >= 0 ? Number(process.argv[i + 1]) : NaN
    return Number.isFinite(v) ? v : undefined
  }
  const tls = argBool('--insecure-tls')
  if (tls !== undefined) globalOpts.insecureTLS = tls
  const tms = argNum('--timeout-ms')
  if (tms !== undefined && tms >= 3000) globalOpts.timeoutMs = tms
  loadState()

  const rl = createInterface({ input: process.stdin })
  rl.on('line', line => {
    line = line.trim()
    if (!line) return
    let req: Req
    try {
      req = JSON.parse(line)
    } catch {
      send({ id: -1, ok: false, error: `非法请求行: ${line.slice(0, 80)}` })
      return
    }
    void dispatch(req)
      .then(result => {
        // 网络方法可能改 cookie/变量：快照持久化
        if (req.method !== 'ping' && req.method !== 'parseSources' && req.method !== 'readEpubMeta') {
          if ((req.params as { source?: BookSource })?.source) {
            snapshot((req.params as { source: BookSource }).source)
          }
        }
        send({ id: req.id, ok: true, result })
      })
      .catch(e => {
        send({ id: req.id, ok: false, error: e instanceof Error ? e.message : String(e) })
      })
  })
  rl.on('close', () => process.exit(0))
  send({ event: 'ready', data: `data-dir=${dataDir}` })
}

main()
