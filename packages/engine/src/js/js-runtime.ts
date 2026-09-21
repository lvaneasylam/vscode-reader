/**
 * {{...}} 内嵌 JS / @js: / <js></js> 书源脚本沙盒执行（node:vm + acorn）。
 *
 * 书源 JS 是 Rhino 同步风格，java.ajax/get/post 在 Node 是异步实现，做三类 AST 变换：
 * 1. 网络调用点注入 await（java.ajax/get/post 调用与已 async 化函数的调用点）
 * 2. 含上述调用的函数自动 async 化（函数名引用链向上传播），并返回值语义对齐 Rhino eval
 *    （最后一个顶层表达式语句的值）
 * 3. 跨行 tagged template 断句（`expr\n\`tpl\`` 在 ES 中会连成标签模板调用）
 * 沙盒不暴露 Node API；jsLib 与主脚本同作用域执行；源变量经 getVariable/setVariable 读写。
 */
import vm from 'node:vm'
import { parse } from 'acorn'
import { createJavaExtensions, type FetchLike, type CookieStore } from './js-extensions.js'

export interface JsEvalOptions {
  fetchFn?: FetchLike
  log?: (msg: string) => void
  timeoutMs?: number
  /** 书源 jsLib 预执行代码（函数库定义） */
  prelude?: string
  /** 源变量存储（getVariable/setVariable） */
  variables?: {
    get(key: string): string | undefined
    set(key: string, value: string): void
    keys?(): string[]
  }
  /** Cookie 存储（java.setCookie/getCookie 与 cookie.put/get） */
  cookies?: CookieStore
  /** 书源 KV 缓存（java.put/get 单参形态） */
  cache?: { put(key: string, value: string): void; get(key: string): string | undefined }
  /** 弹窗提示桥（java.toast/longToast → IDE 通知） */
  toast?: (msg: string, long?: boolean) => void
  /** 系统浏览器打开桥（java.startBrowserAwait） */
  openExternal?: (url: string) => void
}

const NET_METHODS = new Set(['ajax', 'get', 'post'])

/** 共享解析选项：书源脚本常含顶层 return（Rhino eval 语义），需放开才能走 AST 变换而非静默降级 */
const ACORN_OPTS = {
  ecmaVersion: 'latest',
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true
} as const

type AcornNode = Record<string, unknown> & { type?: string }

export async function evalJsAsync(
  code: string,
  ctx: Record<string, unknown> = {},
  opts: JsEvalOptions = {}
): Promise<string | null> {
  // jsLib 先变换：其 async 化函数名传递给主代码变换（跨层调用点注入 await）
  let preludeTransformed = ''
  let preludeAsyncNames = new Set<string>()
  if (opts.prelude?.trim()) {
    const r = transformNetworkCalls(fixCrossLineTaggedTemplates(opts.prelude))
    preludeTransformed = `${r.code}\n;`
    preludeAsyncNames = r.asyncNames
  }
  const mainTransformed = transformNetworkCalls(code, preludeAsyncNames)
  const rewritten = fixCrossLineTaggedTemplates(mainTransformed.code)
  const java = createJavaExtensions({
    fetchFn: opts.fetchFn,
    log: opts.log,
    cookies: opts.cookies,
    cache: opts.cache,
    toast: opts.toast,
    openExternal: opts.openExternal,
    // java.ajax 的 {{...}} 求值递归走完整沙盒（携带外层 ctx 变量如 key/result）
    evalJs: (code: string) => evalJsAsync(code, ctx, opts)
  })
  const sandbox: Record<string, unknown> = {
    java,
    cookie: {
      get: (url?: string) => (url ? (opts.cookies?.get(url) ?? '') : ''),
      put: (url: string, cookieStr: string) => opts.cookies?.set(url, cookieStr),
      set: (url: string, cookieStr: string) => opts.cookies?.set(url, cookieStr),
      remove: (url: string) => opts.cookies?.set(url, ''),
      // qysg/legado 新版方法名（setAllCookies/getToken 等书源惯用）
      setCookie: (url: string, cookieStr: string) => opts.cookies?.set(url, cookieStr),
      getCookie: (url?: string) => (url ? (opts.cookies?.get(url) ?? '') : ''),
      removeCookie: (url: string) => opts.cookies?.set(url, '')
    },
    // 对齐 Rhino 宽松语义：未初始化变量返回空串；JSON 值自动解析为对象（书源按对象访问）
    getVariable: (key?: string) =>
      key === undefined || key === ''
        ? JSON.stringify(Object.fromEntries((opts.variables?.keys?.() ?? []).map(k => [k, opts.variables!.get(k) ?? ''])))
        : parseIfJson(opts.variables?.get(key)),
    setVariable: (key: string, value: unknown) =>
      void opts.variables?.set(key, typeof value === 'string' ? value : JSON.stringify(value)),
    // ctx 在最后展开：result 等入参变量（如规则场景的当前内容）可覆盖默认值
    ...ctx
  }
  const context = vm.createContext(sandbox)

  // jsLib 与主脚本在同一作用域执行（函数库定义对脚本可见）
  const preludeCode = preludeTransformed
  // 顶层具名函数导出到沙盒全局：书源惯用 this.fn() 调用（Rhino 中函数声明挂在全局）；
  // 与沙盒注入 API 同名的函数不导出（保持原生语义，避免书源包装函数递归覆盖）
  const globalExports = topLevelFunctionExports(`${preludeCode}${rewritten}`, Object.keys(sandbox))
  // 普通函数包装 + call(sandbox)：书源全局函数内的 this 恒指向沙盒全局（对齐 Rhino）
  const script = new vm.Script(
    `(async function(){\n${preludeCode}${globalExports}\n${transformTailExpression(rewritten)}\n})`
  )
  const runner = script.runInContext(context, {
    timeout: opts.timeoutMs ?? 5000
  }) as (this: unknown) => Promise<unknown>
  const ret = await runner.call(sandbox)
  if (ret === undefined || ret === null) return null
  if (typeof ret === 'string') return ret
  return JSON.stringify(ret)
}

// ---------- AST 变换 ----------

/** 深度遍历 AST 节点（跳过位置属性） */
function visitNodes(root: unknown, fn: (node: AcornNode) => void): void {
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const n of node) walk(n)
      return
    }
    const n = node as AcornNode
    if (typeof n.type !== 'string') return
    fn(n)
    for (const [key, value] of Object.entries(n)) {
      if (key === 'type' || key === 'loc' || key === 'start' || key === 'end') continue
      walk(value)
    }
  }
  walk(root)
}

interface FnInfo {
  start: number
  end: number
  keywordAt: number
  isAsync: boolean
  needAsync: boolean
  name?: string
}

/**
 * 同步网络调用 → 异步：调用点注入 await，所在函数自动 async 化。
 * 函数名引用链向上传播（调用已 async 化函数的函数同样需要 async 化）。
 * 解析失败时退化为正则重写（顶层调用场景仍可用）。
 */
function transformNetworkCalls(
  code: string,
  knownAsyncNames: Set<string> = new Set()
): { code: string; asyncNames: Set<string> } {
  let ast: unknown
  try {
    ast = parse(code, ACORN_OPTS)
  } catch (e) {
    // 静默降级会让自定义异步函数的调用点丢失 await（书源登录等场景难排查），此处显式告警
    console.warn(
      `[book-source-engine] 网络 AST 变换解析失败，降级正则重写: ${(e as Error).message} → ${code.slice(0, 80)}`
    )
    return { code: rewriteAwaitFallback(code), asyncNames: knownAsyncNames }
  }

  const fns: FnInfo[] = []
  const netCalls: number[] = []
  const existingAwaits: number[] = []
  const namedCalls = new Map<number, string>() // 调用点 -> 函数名

  visitNodes(ast, node => {
    const start = node.start as number
    const end = node.end as number
    const async_ = node.async as boolean | undefined
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      const info: FnInfo = {
        start,
        end,
        keywordAt: start,
        isAsync: async_ === true,
        needAsync: false,
        name: (node.id as { name?: string } | null)?.name
      }
      fns.push(info)
      ;(node as unknown as { __fn: FnInfo }).__fn = info
    }
    // 对象 get/set 的值函数不能 async 化（书源罕见，防御性移除）
    if (node.type === 'Property' && (node.kind === 'get' || node.kind === 'set')) {
      const v = node.value as AcornNode | undefined
      const info = v && (v as unknown as { __fn?: FnInfo }).__fn
      if (info) fns.splice(fns.indexOf(info), 1)
    }
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee as AcornNode | undefined
      if (
        callee?.type === 'MemberExpression' &&
        (callee.object as AcornNode)?.type === 'Identifier' &&
        (callee.object as unknown as { name: string }).name === 'java' &&
        !callee.computed &&
        ((callee.property as unknown as { name?: string }).name
          ? NET_METHODS.has((callee.property as unknown as { name: string }).name)
          : false)
      ) {
        netCalls.push(start)
      } else if (callee?.type === 'Identifier') {
        const name = (callee as unknown as { name: string }).name
        if (name !== 'java') namedCalls.set(start, name)
      } else if (callee?.type === 'MemberExpression' && !callee.computed) {
        // this.fn() / obj.fn() 形态的成员调用（书源惯用 this.request(url)）
        const pname = (callee.property as unknown as { name?: string }).name
        if (pname && pname !== 'java') namedCalls.set(start, pname)
      }
    }
    // 书源 JS 自带的 await（legado 新语法）：所在函数同样需要 async 化（无需再插 await 前缀）
    if (node.type === 'AwaitExpression') {
      existingAwaits.push(start)
    }
  })

  // 内层函数优先（区间最小）
  const innermostFn = (pos: number): FnInfo | undefined =>
    fns
      .filter(f => f.start <= pos && pos < f.end)
      .sort((a, b) => a.end - a.start - (b.end - b.start))[0]

  const asyncNames = new Set(knownAsyncNames)
  const markAsync = (pos: number): void => {
    const fn = innermostFn(pos)
    if (!fn || fn.isAsync) return
    fn.needAsync = true
    if (fn.name) asyncNames.add(fn.name)
  }
  for (const p of netCalls) markAsync(p)
  for (const p of existingAwaits) markAsync(p)

  // 引用链传播：调用 async 化函数的调用点也需要 await，其所在函数继续 async 化
  let changed = true
  while (changed) {
    changed = false
    for (const [pos, name] of namedCalls) {
      if (asyncNames.has(name)) {
        markAsync(pos)
        netCalls.push(pos)
        namedCalls.delete(pos)
        changed = true
      }
    }
  }

  // 汇总插入点（从后往前应用避免偏移失效）
  const inserts: Array<{ offset: number; text: string }> = []
  for (const fn of fns) {
    if (fn.needAsync) inserts.push({ offset: fn.keywordAt, text: 'async ' })
  }
  const awaitedPositions = new Set(existingAwaits)
  for (const p of netCalls) {
    // 已有 await 前缀则跳过（书源自写 await 的调用点）
    const before = code.slice(Math.max(0, p - 20), p)
    if (/(^|[^.\w])await\s*$/.test(before)) continue
    if (awaitedPositions.has(p)) continue
    inserts.push({ offset: p, text: 'await ' })
  }
  inserts.sort((a, b) => b.offset - a.offset)
  let out = code
  for (const { offset, text } of inserts) {
    out = out.slice(0, offset) + text + out.slice(offset)
  }
  return { code: out, asyncNames }
}

/** JSON 字符串自动解析（书源 getVariable 后按对象使用） */
function parseIfJson(v: string | undefined): string | unknown {
  if (v === undefined || v === '') return ''
  const t = v.trim()
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return JSON.parse(t)
    } catch {
      return v
    }
  }
  return v
}

/** 顶层具名函数导出语句（书源用 this.fn() 全局态调用；跳过沙盒保留名） */
function topLevelFunctionExports(code: string, reserved: string[]): string {
  const reservedSet = new Set(reserved)
  try {
    const ast = parse(code, ACORN_OPTS) as unknown as {
      body: Array<{ type: string; id?: { name?: string } | null }>
    }
    return ast.body
      .filter(
        n =>
          n.type === 'FunctionDeclaration' &&
          n.id?.name &&
          !reservedSet.has(n.id.name) &&
          /^[A-Za-z_$][\w$]*$/.test(n.id.name)
      )
      // 绑定全局 this 的包装（回调/引用传递场景下 this 仍指向沙盒全局）
      .map(
        n =>
          `;try{const __f_${n.id!.name}=${n.id!.name};globalThis.${n.id!.name}=function(){return __f_${n.id!.name}.apply(globalThis,arguments)}}catch(_){}`
      )
      .join('')
  } catch {
    return ''
  }
}

/** 正则回退：顶层 java.ajax 调用注入 await */
function rewriteAwaitFallback(code: string): string {
  let out = code
  for (const m of NET_METHODS) {
    out = out.replace(new RegExp(`(\\bawait\\s+)?java\\.${m}\\s*\\(`, 'g'), `await java.${m}(`)
  }
  return out
}

/** 最后一个顶层表达式语句改写为 return（对齐 Rhino eval 返回值语义） */
function transformTailExpression(code: string): string {
  try {
    const ast = parse(code, ACORN_OPTS)
    const body = (ast as { body: Array<{ type: string; start: number; end: number }> }).body
    const last = body[body.length - 1]
    if (last && last.type === 'ExpressionStatement') {
      // ExpressionStatement.end 含行尾显式分号（ASI 语法的一部分），需剥离再进 return 括号
      const tail = code.slice(last.start, last.end).replace(/[\s;]+$/, '')
      return `${code.slice(0, last.start)}\n;return (${tail});`
    }
    // 末尾是 if/else 链：各分支块内最后表达式语句 return 化（Rhino eval 取分支表达式值）
    if (last && last.type === 'IfStatement') {
      return returnifyBranches(last as unknown as AcornNode, code)
    }
  } catch {
    /* 语法解析失败按原始语句执行 */
  }
  return `${code}\n;return typeof result !== 'undefined' ? result : undefined;`
}

/** 末尾 if/else 链分支 return 化：块内最后表达式语句前插 return（已是 return 的分支不动） */
function returnifyBranches(rootIf: AcornNode, code: string): string {
  const spots: number[] = []
  const handleBranch = (b: AcornNode | undefined | null): void => {
    if (!b) return
    if (b.type === 'BlockStatement') {
      const body = (b.body as AcornNode[]) ?? []
      const last = body[body.length - 1]
      if (!last) return
      if (last.type === 'ExpressionStatement') spots.push(last.start as number)
      else if (last.type === 'IfStatement') walkIf(last)
    } else if (b.type === 'ExpressionStatement') {
      spots.push(b.start as number)
    } else if (b.type === 'IfStatement') {
      walkIf(b)
    }
  }
  const walkIf = (n: AcornNode): void => {
    handleBranch(n.consequent as AcornNode)
    handleBranch(n.alternate as AcornNode)
  }
  walkIf(rootIf)
  let out = code
  for (const offset of spots.sort((a, b) => b - a)) {
    out = out.slice(0, offset) + 'return ' + out.slice(offset)
  }
  return out
}

/**
 * 跨行 tagged template 断开（对齐 Rhino ASI 断句行为）。
 * `expr\n\`tpl\`` 在 ES 规范中是合法的 tagged template 调用（运行时报 "not a function"），
 * 而书源脚本的惯例是「模板字符串独占一行作为返回值/实参」。
 */
function fixCrossLineTaggedTemplates(code: string): string {
  let ast: unknown
  try {
    ast = parse(code, { ...ACORN_OPTS, locations: true })
  } catch {
    return code
  }
  const breaks: number[] = []
  visitNodes(ast, node => {
    if (node.type !== 'TaggedTemplateExpression') return
    const tag = node.tag as AcornNode | undefined
    const quasi = node.quasi as AcornNode | undefined
    const tagEndLine = (tag?.loc as { end?: { line?: number } } | undefined)?.end?.line
    const quasiStartLine = (quasi?.loc as { start?: { line?: number } } | undefined)?.start?.line
    if (
      typeof tagEndLine === 'number' &&
      typeof quasiStartLine === 'number' &&
      tagEndLine < quasiStartLine &&
      typeof quasi?.start === 'number'
    ) {
      breaks.push(quasi.start as number)
    }
  })
  for (const offset of breaks.sort((a, b) => b - a)) {
    code = `${code.slice(0, offset)};${code.slice(offset)}`
  }
  return code
}
