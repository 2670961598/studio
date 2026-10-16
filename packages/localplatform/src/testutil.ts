/**
 * 测试工具 —— 临时根目录 / 固定时钟 / 错误断言（测试专用，不入公共导出面）
 * 临时目录用 os.tmpdir() + mkdtemp，用后清理，不碰任何生产路径。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect } from 'vitest'
import type { ErrorCategory } from '@studio-next/contract'
import { LocalPlatformError } from './errors.ts'

export function tmpRoot(label: string): string {
  return mkdtempSync(join(tmpdir(), `localplatform-${label}-`))
}

/** 固定步进时钟：2026-01-01T00:00:00.000Z 起，每次调用 +1s（确定性回放用） */
export function fixedClock(): () => string {
  let n = 0
  return () => new Date(Date.UTC(2026, 0, 1) + n++ * 1000).toISOString()
}

/** 同步断言：抛 LocalPlatformError 且 category/subcause 匹配 */
export function expectLocalError(fn: () => unknown, category: ErrorCategory, subcause: string): void {
  let caught: unknown = null
  try {
    fn()
  } catch (err) {
    caught = err
  }
  expect(caught, '应当抛出 LocalPlatformError').toBeInstanceOf(LocalPlatformError)
  const err = caught as LocalPlatformError
  expect(err.category).toBe(category)
  expect(err.subcause).toBe(subcause)
}

/** 异步断言：reject LocalPlatformError 且 category/subcause 匹配 */
export async function expectLocalReject(fn: () => Promise<unknown>, category: ErrorCategory, subcause: string): Promise<void> {
  let caught: unknown = null
  try {
    await fn()
  } catch (err) {
    caught = err
  }
  expect(caught, '应当抛出 LocalPlatformError').toBeInstanceOf(LocalPlatformError)
  const err = caught as LocalPlatformError
  expect(err.category).toBe(category)
  expect(err.subcause).toBe(subcause)
}
