import * as vscode from 'vscode'
import type { BookSource } from 'book-source-engine'

/** 某一书源的跨实例共享状态（登录 cookie + 源变量，如线路/云端配置） */
export interface SourceState {
  cookieJar: Map<string, string>
  variables: Map<string, string>
}

const KEY_SOURCE_STATE = 'novelReader.sourceState'
const FLUSH_DELAY_MS = 2000

/** 可观察 Map：engine 原地 set/delete 时触发防抖落盘 */
class PersistentStringMap extends Map<string, string> {
  constructor(private readonly onDirty: () => void) {
    super()
  }

  override set(key: string, value: string): this {
    super.set(key, value)
    this.onDirty()
    return this
  }

  override delete(key: string): boolean {
    const removed = super.delete(key)
    if (removed) this.onDirty()
    return removed
  }
}

interface SerializedState {
  cookies: Record<string, string>
  variables: Record<string, string>
}

/**
 * 源状态存储：按 bookSourceUrl 隔离，内存为权威态 + globalState 持久化（防抖）。
 * WebBook 各实例注入同一 Map 后，登录态/线路切换即跨实例、跨会话保持。
 */
class SourceStateStore {
  private readonly cache = new Map<string, SourceState>()
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** 取（或懒加载）某源的共享状态；首次访问后 cache 为权威，不再回读 globalState */
  of(source: BookSource): SourceState {
    const key = source.bookSourceUrl
    const hit = this.cache.get(key)
    if (hit) return hit
    const disk = this.ctx.globalState.get<Record<string, SerializedState>>(KEY_SOURCE_STATE) ?? {}
    const saved = disk[key]
    const state: SourceState = {
      cookieJar: new PersistentStringMap(() => this.scheduleFlush()),
      variables: new PersistentStringMap(() => this.scheduleFlush())
    }
    if (saved) {
      for (const [k, v] of Object.entries(saved.cookies ?? {})) state.cookieJar.set(k, v)
      for (const [k, v] of Object.entries(saved.variables ?? {})) state.variables.set(k, v)
    }
    this.cache.set(key, state)
    return state
  }

  /** 立即落盘（登录流程收尾调用，规避防抖窗口丢数据） */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    const snapshot: Record<string, SerializedState> = {}
    for (const [url, s] of this.cache) {
      snapshot[url] = {
        cookies: Object.fromEntries(s.cookieJar),
        variables: Object.fromEntries(s.variables)
      }
    }
    await this.ctx.globalState.update(KEY_SOURCE_STATE, snapshot)
  }

  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flushNow()
    }, FLUSH_DELAY_MS)
  }
}

// 模块级单例：createWebBook 各调用点零参数注入（未 init 时回退纯内存，保证不崩）
let shared: SourceStateStore | undefined

export function initSourceState(ctx: vscode.ExtensionContext): void {
  shared = new SourceStateStore(ctx)
}

export function sourceStateOf(source: BookSource): SourceState {
  if (!shared) return { cookieJar: new Map(), variables: new Map() }
  return shared.of(source)
}

/** 登录等关键流程收尾立即持久化 */
export function flushSourceState(): Promise<void> {
  return shared ? shared.flushNow() : Promise.resolve()
}
