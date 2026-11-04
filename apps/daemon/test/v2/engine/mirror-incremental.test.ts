/**
 * 790 v3：镜像增量 upsert + collect 并行的错误隔离（定向单测）。
 * 依据：790 票「syncMirror 766 行/拍全量浪费」与「activity.since 与 issues.list 并行」。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { IssueRecord } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createRegistry } from '@studio-next/adapters'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { syncMirrorsIncremental } from '../../../src/engine/runtime/events.ts'
import type { EngineRuntime } from '../../../src/engine/runtime/types.ts'

const roots: string[] = []
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots.length = 0
})

function makeLedger(): Ledger {
  const root = mkdtempSync(path.join(tmpdir(), 'sn-mirror-inc-'))
  roots.push(root)
  return openLedger(path.join(root, 'ledger.sqlite'))
}

function rtOf(ledger: Ledger): EngineRuntime {
  return {
    ledger,
    config: { company: 'co', deptFallback: 'departments/工程部' },
    writeActor: 'daemon',
    now: () => 1_800_000_000_000,
  } as unknown as EngineRuntime
}

function issue(i: number, over: Partial<IssueRecord> = {}): IssueRecord {
  return {
    id: `co-${String(i)}`,
    title: `单${String(i)}`,
    state: 'New',
    type: 'devtask',
    dept: 'departments/工程部',
    level: 1,
    assignee: 'AGENT-1',
    updated: '2026-11-05T00:00:00.000Z',
    ...over,
  }
}

describe('790 v3 镜像增量', () => {
  it('766 行首次全写 → 第二次 0 写；单行变更只写 1 行；行数不变', () => {
    const ledger = makeLedger()
    const rt = rtOf(ledger)
    const issues = Array.from({ length: 766 }, (_, i) => issue(i + 1))
    expect(syncMirrorsIncremental(rt, issues)).toBe(766)
    expect(ledger.listTicketMirrors()).toHaveLength(766)
    expect(syncMirrorsIncremental(rt, issues)).toBe(0) // 未变=0 写
    expect(syncMirrorsIncremental(rt, [issue(1, { state: 'In progress', updated: '2026-11-05T01:00:00.000Z' }), ...issues.slice(1)])).toBe(1)
    expect(ledger.listTicketMirrors()).toHaveLength(766)
  })
  it('增量不删残行（删除归 mirror GC）：平台列表少一行不产生写/删', () => {
    const ledger = makeLedger()
    const rt = rtOf(ledger)
    const issues = [issue(1), issue(2)]
    expect(syncMirrorsIncremental(rt, issues)).toBe(2)
    expect(syncMirrorsIncremental(rt, [issue(1)])).toBe(0)
    expect(ledger.listTicketMirrors()).toHaveLength(2) // 残行保留，由 GC 按活动集删
  })
})

describe('790 v3 collect 并行：错误隔离不炸拍', () => {
  function makeEngine(platform: ReturnType<typeof createFakePlatform>): { engine: Engine; ledger: Ledger } {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-collect-par-'))
    roots.push(root)
    const ledger = openLedger(path.join(root, 'ledger.sqlite'))
    const registry = createRegistry()
    registry.register(createFakeAdapter({ name: 'fake' }), { default: true })
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
    })
    return { engine, ledger }
  }

  it('issues.list 失败：activity 仍采集、错误按 mirror-list 登记、tick 不 reject', async () => {
    const platform = createFakePlatform()
    platform.issues.list = async () => {
      throw new Error('probe-list-down')
    }
    const { engine, ledger } = makeEngine(platform)
    const report = await engine.tick()
    expect(report.errors.some((e) => e.includes('镜像对账失败（issues.list）'))).toBe(true)
    expect(report.errors.some((e) => e.includes('probe-list-down'))).toBe(true)
    expect(ledger.listTicketMirrors()).toHaveLength(0)
  })
  it('activity.since 失败：issues.list 仍对账写镜像、错误按 activity 登记、tick 不 reject', async () => {
    const platform = createFakePlatform()
    await platform.issues.create({ title: '并行对账单' })
    platform.activity.since = async () => {
      throw new Error('probe-activity-down')
    }
    const { engine, ledger } = makeEngine(platform)
    const report = await engine.tick()
    expect(report.errors.some((e) => e.includes('采集相位失败'))).toBe(true)
    expect(report.errors.some((e) => e.includes('probe-activity-down'))).toBe(true)
    expect(ledger.listTicketMirrors().length).toBeGreaterThanOrEqual(1)
  })
})
