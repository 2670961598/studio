/**
 * 契约自证：meta 域（docs/25-§二 / CASES.md）
 * 证明 runner 机制本身成立（匹配语义/哨兵/err 通道），契约数据先自证再服务他域。
 */
import { describe, expect, it } from 'vitest'
import { runCases, type SubjectFn } from '../src/index.ts'
import manifest from '../cases.json'

const metaSubject: SubjectFn = (input) => {
  const i = input as Record<string, unknown>
  if ('boom' in i) {
    const e = new Error('meta boom') as Error & { category: string; subcause: string }
    e.category = 'CONFIG_INVALID'
    e.subcause = 'meta-boom'
    throw e
  }
  return i['echo']
}

describe('契约 runner 自证（meta 域）', () => {
  it('清单合法且 3 条 meta case 全绿', async () => {
    const r = await runCases(manifest, { meta: metaSubject }, { domains: ['meta'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(3)
    expect(r.passed).toBe(3)
  })

  it('匹配语义反证：改坏期望必红（防 runner 恒真）', async () => {
    const bad = structuredClone(manifest) as { version: number; cases: unknown[] }
    const first = bad.cases[0] as { expected: { out: { a: number } } }
    first.expected.out.a = 999
    const r = await runCases(bad, { meta: metaSubject }, { domains: ['meta'] })
    expect(r.passed).toBe(2)
    expect(r.failed[0]?.id).toBe('C-meta-001')
  })
})
