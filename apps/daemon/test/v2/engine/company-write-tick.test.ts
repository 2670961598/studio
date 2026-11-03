/**
 * company-write-tick —— 引擎相位 7 尾消化接线（studio-dev-541）定向红→绿用例
 *
 * 依据（实现单引用）：
 *   - docs/17-§2（主循环七相位：挂单队列消化＝相位 7 尾步骤，不增删相位；同 hrSync 先例）；
 *   - docs/17-§6（证据契约：tick 返回结构化 actions/观测面，失败进 errors 不炸拍）；
 *   - docs/v2/05-§三 DOM-01（唯一写入者＝daemon）。
 *
 * 改前必红：`Engine.ingestCompanyUpdate` 与 `TickReport.phases.account.companyWrite`
 * 本单之前不存在（engine/runtime 零调用）——本文件类型面即红；改后绿。零 git。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import type { CompanyWriteFace, CompanyWriteOutcome } from '../../../src/engine/company-write/runtime.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function outcomeOf(orderId: string): CompanyWriteOutcome {
  return {
    ok: true,
    status: 'committed',
    orderId,
    commit: 'c'.repeat(40),
    digest: 'd'.repeat(64),
    paths: ['departments/综合部/department.yaml'],
    applied: true,
    rollback: 'none',
    subcause: null,
    detail: '',
    eventId: 'EVT-1',
  }
}

function makeEngine(companyWrite?: CompanyWriteFace): { engine: Engine; ledger: Ledger } {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-company-write-tick-'))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const registry = createRegistry()
  registry.register(createFakeAdapter({ name: 'fake' }), { default: true })
  const engine = createEngine({
    platform: createFakePlatform(),
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: () => Date.now(),
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: root,
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
    },
    people: DEMO_SNAPSHOT.people,
    ...(companyWrite !== undefined ? { companyWrite } : {}),
  })
  return { engine, ledger }
}

describe('engine 相位 7 尾·公司目录挂单队列（studio-dev-541）', () => {
  it('面关（未注入 companyWrite）：注入口 false 拒收、零队列、报告无 companyWrite 段', async () => {
    const { engine } = makeEngine()
    expect(engine.ingestCompanyUpdate({ orderId: 'ORG-2026-0001' })).toBe(false)
    expect(engine.pendingCompanyUpdates).toBe(0)
    const report = await engine.tick()
    expect(report.phases.account.companyWrite).toBeUndefined()
    await engine.dispose()
  })

  it('面开：ingest 入队 → 下一拍相位 7 尾消化恰一单 → 报告计数 → 队列清空不再重投', async () => {
    const seen: unknown[] = []
    const { engine } = makeEngine({
      submit: async (order: unknown): Promise<CompanyWriteOutcome> => {
        seen.push(order)
        return outcomeOf((order as { orderId: string }).orderId)
      },
    })
    const order = { orderId: 'ORG-2026-0002' }
    expect(engine.ingestCompanyUpdate(order)).toBe(true)
    expect(engine.pendingCompanyUpdates).toBe(1)
    const report = await engine.tick()
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(order)
    expect(engine.pendingCompanyUpdates).toBe(0)
    expect(report.phases.account.companyWrite?.drained).toBe(1)
    expect(report.phases.account.companyWrite?.committed).toBe(1)
    expect(report.phases.account.companyWrite?.applied).toBe(1)
    expect(report.phases.account.companyWrite?.orderIds).toEqual(['ORG-2026-0002'])
    const second = await engine.tick()
    expect(seen).toHaveLength(1)
    expect(second.phases.account.companyWrite?.drained).toBe(0)
    await engine.dispose()
  })

  it('写面抛错＝进 tick errors 不炸拍（fail-closed 不静默）', async () => {
    const { engine } = makeEngine({
      submit: async (): Promise<CompanyWriteOutcome> => {
        throw new Error('注入写面故障')
      },
    })
    engine.ingestCompanyUpdate({ orderId: 'ORG-2026-0003' })
    const report = await engine.tick()
    expect(report.errors.join('\n')).toContain('company-write drain 失败：注入写面故障')
    expect(engine.pendingCompanyUpdates).toBe(0)
    await engine.dispose()
  })
})
