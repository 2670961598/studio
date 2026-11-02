/**
 * collect-cursor-loop —— studio-dev-409 回归③：采集相位游标回退环防护（engine 面）
 *
 * 缺陷：相位 1 翻页循环信任 nextCursor 单调前进（docs/17-§2 采集相位）；适配器把
 * nextCursor 拉回已见旧位置（Taiga 边界假不可达→全量重放）时，循环原地打转烧满
 * maxActivityPages=10 页/拍，kvSet 把环中值落库——断路自持（生产实证：游标
 * A→B→C→A 每拍一步轮转 12 天，boot-20261102m.log tick#157427-157430）。
 *
 * 修法：同值再现即环——停翻防打转，cursor 停在最后一个未重复值落库；上报
 * collect.cursorLoop 观测位，render 行追加 [cursor-loop] 标记。游标不透明
 * （docs/25-§3.2 铁律）：只认重复、不解释内容，端口契约零变更。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { ActivityPage, FlowPlatform } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createEngine,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
  type TickReport,
} from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

let root = ''
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'cursor-loop-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const CURSOR_KEY = 'activity.cursor'

/** 环形活动面：nextCursor 在 A/B/C 间循环（复现适配器回拉；items 恒空聚焦游标动力学） */
function loopingActivity(p: FlowPlatform): FlowPlatform {
  const cycle = ['A', 'B', 'C']
  let calls = 0
  return {
    ...p,
    activity: {
      since: async (_cursor: string | null): Promise<ActivityPage> => {
        calls += 1
        return { items: [], nextCursor: cycle[calls % 3] ?? 'A' }
      },
    },
  }
}

/** 健康面：nextCursor 单调前进 1→2→3 后置 null（翻到尾收口） */
function steppingActivity(p: FlowPlatform): FlowPlatform {
  let calls = 0
  return {
    ...p,
    activity: {
      since: async (_cursor: string | null): Promise<ActivityPage> => {
        calls += 1
        return calls < 4 ? { items: [], nextCursor: String(calls) } : { items: [], nextCursor: null }
      },
    },
  }
}

interface Stack {
  ledger: Ledger
  engine: Engine
}

/** 测试栈：每用例独立台账/平台/引擎（fake 全家桶 + tmp 库；对齐 stall-rescan-revival） */
function buildStack(id: string, decorate: (p: FlowPlatform) => FlowPlatform): Stack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  const clock = { now: (): number => Date.parse('2026-11-02T00:00:00.000Z') }
  const platform = decorate(createFakePlatform({ now: () => new Date(clock.now()).toISOString() }))
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
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
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: path.join(root, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 9999,
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { ledger, engine }
}

describe('studio-dev-409 回归③：采集相位游标回退环防护', () => {
  it('nextCursor 同值再现 → 停翻防打转，cursor 停在最后未重复值落库，cursorLoop=true', async () => {
    const s = buildStack('loop', loopingActivity)
    const report: TickReport = await s.engine.tick()
    expect(report.phases.collect.cursorLoop).toBe(true)
    expect(report.phases.collect.pages).toBe(4) // B,C,A 各翻一页 + 再现 B 即停（<10 页帽）
    expect(s.ledger.kvGet(CURSOR_KEY)).toBe('A') // 最后未重复值：不回零、不无限打转
  })

  it('健康单调翻页不受影响：cursorLoop=false，翻到尾收口', async () => {
    const s = buildStack('step', steppingActivity)
    const report: TickReport = await s.engine.tick()
    expect(report.phases.collect.cursorLoop).toBe(false)
    expect(report.phases.collect.pages).toBe(4)
    expect(s.ledger.kvGet(CURSOR_KEY)).toBe('3')
  })
})
