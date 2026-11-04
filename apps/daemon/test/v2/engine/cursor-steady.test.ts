/**
 * 790 v4：collect 稳态自游标守卫（profit 每拍 [cursor-loop] 回归修复）。
 *
 * 背景（只读诊断 /tmp/profit-cursor-loop）：790 v2 起 adapter 在无新活动时返回边界自身
 * canonical 作为 nextCursor（稳态，禁止回落裸 id）；collect 旧守卫把同值重复当回退环，
 * 导致 profit 每拍误报 `[cursor-loop]` + OBS REC-OBS-02 cursor_broken 假故障。
 * 本测试钉：稳态=1 次 activity 调用、cursorLoop=false、无 cursor-loop obsFailure；
 * 真回退环（重复 cursor 且页内有 items）仍报警。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ActivityPage, PlatformActivity } from '@studio-next/contract'
import { createRegistry } from '@studio-next/adapters'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import type { ObsTickInput, ObsTickOutcome, ObsTickReport } from '../../../src/engine/observe/types.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

const CURSOR_KEY = 'activity.cursor'

interface Harness {
  engine: Engine
  ledger: Ledger
  obsFailures: string[][]
}

function makeHarness(activitySince: (cursor: string | null) => Promise<ActivityPage>): Harness {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-cursor-steady-'))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const platform = createFakePlatform()
  platform.activity.since = activitySince
  const registry = createRegistry()
  registry.register(createFakeAdapter({ name: 'fake' }), { default: true })
  const obsFailures: string[][] = []
  const obs = {
    observe: (input: ObsTickInput): ObsTickOutcome => {
      obsFailures.push((input.failures ?? []).map((f) => f.source))
      return { report: {} as ObsTickReport, errors: [], logLines: [] }
    },
  }
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['true'],
      docRefs: ['docs/17-§2'],
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
    obs,
  })
  return { engine, ledger, obsFailures }
}

describe('790 v4 collect 稳态自游标', () => {
  it('profit 型：无新活动且 nextCursor=当前 canonical → 1 次 activity、cursorLoop=false、无 cursor-loop obsFailure', async () => {
    let calls = 0
    const { engine, ledger, obsFailures } = makeHarness(async (cursor): Promise<ActivityPage> => {
      calls += 1
      expect(cursor).toBe('CURSOR-A')
      return { items: [], nextCursor: 'CURSOR-A' }
    })
    ledger.kvSet(CURSOR_KEY, 'CURSOR-A')
    const report = await engine.tick()
    expect(calls).toBe(1) // 稳态不再翻第二页
    expect(report.phases.collect.cursorLoop).toBe(false)
    expect(report.errors).toEqual([])
    expect(obsFailures.flat()).not.toContain('cursor-loop')
    expect(ledger.kvGet(CURSOR_KEY)).toBe('CURSOR-A') // 游标保持原值
  })

  it('dev 型：有活动页（nextCursor 前进）后稳态自游标 → 不误报，游标推进', async () => {
    const item: PlatformActivity = { id: 'act-1', ts: '2026-11-04T22:28:42.707Z', issue: 'demo-1', kind: 'transitioned' }
    let calls = 0
    const { engine, ledger, obsFailures } = makeHarness(async (cursor): Promise<ActivityPage> => {
      calls += 1
      if (cursor === 'CURSOR-A') return { items: [item], nextCursor: 'CURSOR-B' }
      expect(cursor).toBe('CURSOR-B')
      return { items: [], nextCursor: 'CURSOR-B' } // 新边界稳态自游标
    })
    ledger.kvSet(CURSOR_KEY, 'CURSOR-A')
    const report = await engine.tick()
    expect(calls).toBe(2) // 活动页 + 稳态页
    expect(report.phases.collect.cursorLoop).toBe(false)
    expect(obsFailures.flat()).not.toContain('cursor-loop')
    expect(ledger.kvGet(CURSOR_KEY)).toBe('CURSOR-B')
  })

  it('真回退环：重复 nextCursor 且页内有 items → 仍 cursorLoop=true', async () => {
    const item: PlatformActivity = { id: 'act-loop', ts: '2026-11-04T22:28:42.707Z', issue: 'demo-1', kind: 'commented' }
    const { engine, ledger, obsFailures } = makeHarness(async (cursor): Promise<ActivityPage> => {
      if (cursor === 'CURSOR-A') return { items: [item], nextCursor: 'LOOP' }
      return { items: [item], nextCursor: 'LOOP' } // 真环：同值且每页有 items
    })
    ledger.kvSet(CURSOR_KEY, 'CURSOR-A')
    const report = await engine.tick()
    expect(report.phases.collect.cursorLoop).toBe(true)
    expect(obsFailures.flat()).toContain('cursor-loop')
  })
})
