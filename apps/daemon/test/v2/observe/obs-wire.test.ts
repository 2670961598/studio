/**
 * test/v2/observe/obs-wire —— 观察面 OBS 生产接线（assembly/observe/wire + 相位 1 尾拍内步骤）
 *
 * 依据：studio-dev-539（差距项 #13：只读投影生产消费=0＋reportFault/REC-OBS-02..04 无实现；
 * 本单重出=studio-dev-617）；docs/17-§2（观察面挂相位 1 采集尾——相位内步骤不增删相位）；
 * docs/17-§6（观测写入不参与收割判定；写失败不冒认）；v2/08 §4.4/§5.3；v2/11 §十二；
 * v2/14 §1.8（PORT-OBS 唯一写槽）；v2/15 §一 SEC-FC-06（system 代写 onBehalfOf）。
 *
 * 栈形态：真引擎＋真 SQLite 台账＋fake 平台/执行体（fake 只替代外部端口，v2/17 §一）；
 * 断言面＝TickReport.collect.obs 计数、records 表实名行、装配/观察日志行（生产可观测面）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'
import { wireObservationFace, type WireObservFaceResult } from '../../../src/assembly/observe/wire.ts'
import { renderTick } from '../../../src/assembly/render/tick.ts'

const roots: string[] = []
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

const OPS: PersonRef = { id: 'OPS-1', name: '运维', login: 'ops-1', level: 1, dept: 'departments/综合部', status: 'active', role: '运维岗' }

interface ObsWireStack {
  readonly ledger: Ledger
  readonly engine: Engine
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly logs: string[]
  readonly face: WireObservFaceResult | undefined
}

/** 真栈：真引擎＋真 SQLite＋fake 平台/执行体；观察面按注入名册装配（缺位＝面关） */
async function createObsWireStack(people: readonly PersonRef[]): Promise<ObsWireStack> {
  const root = await mkdtemp(path.join(tmpdir(), 'sn-obs-wire-'))
  roots.push(root)
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const clock = (): number => Date.parse('2026-11-03T02:00:00.000Z')
  const platform = createFakePlatform({ now: () => new Date(clock()).toISOString() })
  const logs: string[] = []
  const face = wireObservationFace({
    ledger,
    snapshot: { people: [...people] },
    company: DEMO_SNAPSHOT.slug,
    clock,
    makeId: (ts) => makeUlid(ts),
    log: (line) => logs.push(line),
  })
  const registry = createRegistry()
  registry.register(createFakeAdapter({ name: 'fake-obs' }), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: 'demo',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
    },
    people: DEMO_SNAPSHOT.people,
    ...(face !== undefined ? { obs: face.step } : {}),
  })
  return { ledger, engine, platform, logs, face }
}

function obsRows(ledger: Ledger): Array<{ record_type: string; c: number }> {
  return ledger.db
    .prepare("SELECT record_type, COUNT(*) AS c FROM records WHERE record_type LIKE 'REC-OBS-%' GROUP BY record_type ORDER BY record_type")
    .all() as Array<{ record_type: string; c: number }>
}

describe('OBS 生产接线（assembly/observe/wire）', () => {
  it('无「运维/巡查」在岗人员 → 面关（undefined＋启动日志明报，不冒名决定者）', async () => {
    const stack = await createObsWireStack(DEMO_SNAPSHOT.people)
    expect(stack.face).toBeUndefined()
    expect(stack.logs.some((line) => line.includes('OBS 观察写入面未装配'))).toBe(true)
    expect(obsRows(stack.ledger)).toEqual([])
    stack.ledger.close()
  })

  it('相位 1 尾：采集失败 → REC-OBS-02＋03；持续不重复；恢复 → REC-OBS-04（真库实名行）', async () => {
    const stack = await createObsWireStack([OPS])
    expect(stack.face?.observer).toBe('OPS-1')
    expect(stack.logs.some((line) => line.includes('OBS 观察写入面已装配：观察位置=OPS-1'))).toBe(true)

    const realList = stack.platform.issues.list.bind(stack.platform.issues)
    // 故障注入＝采集相位真实失败事实（issues.list 不可达）
    stack.platform.issues.list = async (): Promise<never> => {
      throw new Error('LOCAL-999.jsonl: 存在非法 JSON 行')
    }

    const first = await stack.engine.tick()
    expect(first.phases.collect.obs).toMatchObject({ view: 'MON-15', faultsRecorded: 1, watchesOpened: 1, watchesClosed: 0, openWatches: 1 })
    expect(first.errors.some((err) => err.includes('镜像对账失败（issues.list）'))).toBe(true)
    expect(renderTick(first)).toContain('obs=1f/1o/0c open=1')

    // 故障持续：边沿触发不重复写（防刷屏）
    const second = await stack.engine.tick()
    expect(second.phases.collect.obs).toMatchObject({ faultsRecorded: 0, watchesOpened: 0, openWatches: 1 })

    // 恢复：观察有据结束（REC-OBS-04）
    stack.platform.issues.list = realList
    const third = await stack.engine.tick()
    expect(third.phases.collect.obs).toMatchObject({ faultsRecorded: 0, watchesClosed: 1, openWatches: 0 })
    expect(renderTick(third)).toContain('obs=0f/0o/1c open=0')

    expect(obsRows(stack.ledger)).toEqual([
      { record_type: 'REC-OBS-02', c: 1 },
      { record_type: 'REC-OBS-03', c: 1 },
      { record_type: 'REC-OBS-04', c: 1 },
    ])
    expect(stack.logs.some((line) => line.includes('观察开启（REC-OBS-03）'))).toBe(true)
    expect(stack.logs.some((line) => line.includes('监控故障已登记（REC-OBS-02）'))).toBe(true)
    expect(stack.logs.some((line) => line.includes('观察结束（REC-OBS-04）'))).toBe(true)
    stack.ledger.close()
  })
})
