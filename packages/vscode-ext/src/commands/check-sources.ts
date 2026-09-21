import * as vscode from 'vscode'
import { type BookSource } from 'book-source-engine'
import type { Store } from '../store.js'
import { createWebBook } from '../webbook-factory.js'

interface CheckResult {
  source: BookSource
  ok: boolean
  ms: number
  error?: string
}

const CONCURRENCY = 4
const CHECK_TIMEOUT_MS = 8000
/** 默认校验关键字（对齐 legado getCheckKeyword 的回退值） */
const DEFAULT_KEYWORD = '我的'

/**
 * 书源校验：对每个启用的书源执行一次真实搜索，
 * 汇总可用/失败结果，支持一键禁用失败书源。
 */
export async function checkSources(store: Store): Promise<void> {
  const enabled = store.getSources().filter(s => s.enabled !== false)
  if (enabled.length === 0) {
    void vscode.window.showInformationMessage('没有启用的书源可校验')
    return
  }

  const results: CheckResult[] = []
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '校验书源', cancellable: true },
    async (progress, token) => {
      let index = 0
      let done = 0
      const worker = async (): Promise<void> => {
        while (index < enabled.length && !token.isCancellationRequested) {
          const source = enabled[index++]
          const t0 = Date.now()
          try {
            const books = await createWebBook(source, { timeoutMs: CHECK_TIMEOUT_MS }).searchBooks(
              keywordOf(source)
            )
            results.push({
              source,
              ok: books.length > 0,
              ms: Date.now() - t0,
              error: books.length > 0 ? undefined : '搜索结果为空（规则可能失效）'
            })
          } catch (e) {
            results.push({ source, ok: false, ms: Date.now() - t0, error: (e as Error).message })
          }
          done++
          progress.report({
            message: `${done}/${enabled.length}`,
            increment: (1 / enabled.length) * 100
          })
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    }
  )

  const failed = results.filter(r => !r.ok)
  const okCount = results.length - failed.length

  if (results.length === 0) {
    void vscode.window.showInformationMessage('校验已取消')
    return
  }

  const summary = `校验完成：${okCount} 可用 · ${failed.length} 失败`
  if (failed.length === 0) {
    void vscode.window.showInformationMessage(summary)
    return
  }

  // 失败明细 + 批量操作
  const action = await vscode.window.showQuickPick(
    [
      {
        label: `$(circle-slash) 禁用全部失败书源（${failed.length} 个）`,
        action: 'disable' as const
      },
      ...failed.map(r => ({
        label: `$(error) ${r.source.bookSourceName}`,
        description: `${r.ms}ms`,
        detail: r.error ?? '',
        action: 'detail' as const
      }))
    ],
    { placeHolder: summary }
  )
  if (action?.action === 'disable') {
    const failedUrls = new Set(failed.map(r => r.source.bookSourceUrl))
    await store.saveSources(
      store.getSources().map(s =>
        failedUrls.has(s.bookSourceUrl) ? ({ ...s, enabled: false } as BookSource) : s
      )
    )
    void vscode.window.showInformationMessage(`已禁用 ${failed.length} 个失败书源`)
  }
}

function keywordOf(source: BookSource): string {
  const kw = source.ruleSearch?.checkKeyWord
  return kw && kw.trim() && !kw.includes('http') ? kw.trim() : DEFAULT_KEYWORD
}
