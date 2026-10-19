/**
 * deps 域契约收口（DEV-26；契约语料 packages/contract/cases.json 的 C-deps-001..017）
 *
 * 分工（CASES.md，同 dir 域先例）：契约 case 断言语义（解析/绑定求值/版本判定/决策纯面/
 * 指纹）；IO 面（隔离根落位/registry/log/confirm/failOnMissing/热重载不落用户目录）由
 * dependencies.test.ts 承载——契约对实现细节零知识（docs/25-§二）。
 */
import { describe, expect, it } from 'vitest'
import { runCases } from '@studio-next/contract'
import { depsSubject } from '../src/index.ts'
import manifest from '../../contract/cases.json'
import { planPluginInstalls, parseDependencies } from '../src/index.ts'

describe('deps 域契约（语义——docs/43-§四/§十5-8）', () => {
  it('17 条 deps case 全绿', async () => {
    const r = await runCases(manifest, { deps: depsSubject }, { domains: ['deps'] })
    expect(r.failed).toEqual([])
    expect(r.total).toBe(17)
    expect(r.passed).toBe(17)
  })

  it('匹配语义反证：改坏一条 case 的期望必红（防全绿假象）', async () => {
    const mutated = structuredClone(manifest)
    const target = mutated.cases.find((c) => c.id === 'C-deps-014')
    expect(target).toBeDefined()
    const items = (target?.expected as { out: { action: string }[] }).out
    items[0]!.action = 'install' // conflict 被改坏成 install——51-D-2「不装错版本」的红线面
    const r = await runCases(mutated, { deps: depsSubject }, { domains: ['deps'] })
    expect(r.passed).toBe(16)
    expect(r.failed.map((f) => f.id)).toEqual(['C-deps-014'])
  })

  it('决策纯面直证：plan 路由与 planPluginInstalls 同一实现（契约面=实现面）', () => {
    const deps = parseDependencies('schema: studio-next/dependencies@1\nbindings:\n  - when:\n      attr: role\n      is: 工程负责人\n    plugins:\n      - name: dsh-p\n        version: "^1.0"\n')
    const person = { id: 'AGENT-1', dept: 'departments/工程部', level: 2, role: '工程负责人' }
    const input = { deps, persons: [person], installed: {}, sources: { 'dsh-p': { origin: 'package' as const, version: '1.2.0' } } }
    expect(depsSubject({ plan: input })).toEqual(planPluginInstalls(input))
  })
})
