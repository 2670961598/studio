/**
 * people-change 端到端（129-C，studio-dev-178；129-§6.1①/§6.3 P0-A 验收样板）。
 *
 * 链路：org-config 路由（hooks.data_change.routes）+ daemon 逃生位合并 → hr-sync apply 段
 * diff → enqueueHrBatch 产物 changes → people-change 源双写 data-change 意图 →
 * engine.ingest → tick → 联动单物化（assignee=路由目标）+ todo_queue 投影（129-B 收件箱面）。
 *
 * 验收样板（129-§6.3 P0-A）：**新人入司 → 对账岗收件箱自动出现对账单，零手工派单**。
 * 断言面：
 *   1. 端到端联动单：assignee=路由目标、[联动] 标题、变更指纹溯源、linked_ticket=hr 批次；
 *   2. todo_queue 投影行（person=对账岗——收件箱面）；PATROL 留痕 dedup=变更指纹；
 *   3. S2 判负线：同指纹重投 100× 恒只一张联动单（引擎 patrolKeys 恰好一次 × 源 at-least-once）；
 *   4. 路由合并件 mergeDataChangeRoutes（org-config 规范位+daemon.yaml 逐键覆盖）；
 *   5. publish 隔离：双写面抛错不炸 apply 段（三面任务链=主产物照旧）；
 *   6. 未接线（hrPeopleWatch 关面）：零意图入队，数据面 changes 照回传（源料在、双写面未挂）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, EventRecord, PersonRef } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'
import { createSourceRegistry } from '../../../src/engine/sources.ts'
import { mergeDataChangeRoutes } from '../../../src/engine/intents/taxonomy.ts'
import { wirePeopleChangeSource } from '../../../src/engine/hrsync/people-change-source.ts'
import { hrApplySegment } from '../../../src/assembly/hrsync/assemble.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

let root = ''
const T0 = Date.UTC(2026, 9, 22, 0, 0, 0)

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sn-129c-'))
})
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

const DEPT = 'departments/工程部'

function person(id: string, level: number, status?: 'paused'): PersonRef {
  return status === undefined ? { id, name: `${id} 名`, login: id.toLowerCase(), level, dept: DEPT } : { id, name: `${id} 名`, login: id.toLowerCase(), level, dept: DEPT, status }
}

function snapshotOf(people: PersonRef[]): CompanySnapshot {
  return { ...DEMO_SNAPSHOT, people }
}

/** E2E 栈：引擎（合并路由注入）+ 源注册表（publish 闭包经 sink 直达 ingest） */
interface E2EStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  publish: (changes: readonly PersonChange_[], batchId: string) => number
}
type PersonChange_ = Parameters<NonNullable<Parameters<typeof hrApplySegment>[0]['publish']>>[0][number]

function buildStack(id: string, routes: Readonly<Record<string, string>>, opts?: { freezeQueue?: boolean }): E2EStack {
  const snapshot = snapshotOf([person('AGENT-1', 2), person('PRIME-0', 3)])
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const registry = createRegistry()
  registry.register(createFakeAdapter(), { default: true })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/22-§二（内置唤起源）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    people: snapshot.people,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: DEPT,
      defaultLane: 'core',
      dataChangeRoutes: routes,
      // freezeQueue：每拍动作上限 0——联动单定格在新单位（收件箱投影可见面）+ 镜像
      // 重扫每拍（新单镜像入表——投影成员源=镜像∩活集）；派发链行为面已由 129-A e2e
      // 覆盖，本测断言的是「收件箱自动出现对账单」样板
      ...(opts?.freezeQueue === true
        ? { limits: { ...ENGINE_CONFIG_DEFAULTS.limits, maxActionsPerTick: 0 }, mirrorRescanEveryTicks: 1 }
        : {}),
    },
  })
  const sources = createSourceRegistry({ log: () => undefined })
  const ingestSink = (intent: Parameters<Engine['ingest']>[0][number]): void => {
    engine.ingest([intent])
  }
  const publish = wirePeopleChangeSource(sources, { company: snapshot.slug, sink: ingestSink })
  return { platform, ledger, engine, clock, publish }
}

function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents().filter((e) => e.event === name)
}

/** hr apply 段（PREV→NEXT 双写面接线；companyState 镜像同步照 serve 装配序） */
function applyHr(stack: E2EStack, prev: CompanySnapshot, next: CompanySnapshot, wired: boolean) {
  const logs: string[] = []
  const hr = hrApplySegment({
    enabled: true,
    ledger: stack.ledger,
    prev,
    next,
    company: 'demo',
    clock: stack.clock.now,
    makeId: makeUlid,
    log: (l) => logs.push(l),
    ...(wired ? { publish: stack.publish } : {}),
  })
  return { hr, logs }
}

// ————————————————————————— 1. P0-A 验收样板：新人入司 → 对账岗收件箱 —————————————————————————

describe('P0-A 端到端：新人入司 → 对账岗收件箱自动出现对账单（零手工派单）', () => {
  it('org-config 路由（规范位）+ daemon 覆盖合并 → apply 段双写 → 联动单物化 + todo_queue 投影行', async () => {
    // serve 同款合并面：org-config hooks 规范位 + daemon.yaml dataChangeRoutes 逐键覆盖
    const routes = mergeDataChangeRoutes(
      { data_change: { routes: { 入: 'AGENT-1', 升: 'PRIME-0' } } },
      { 入: 'AGENT-1', 升: 'AGENT-1', 停: 'AGENT-1' }, // daemon 逃生位：升 覆盖为 AGENT-1
    )
    expect(routes).toEqual({ 入: 'AGENT-1', 升: 'AGENT-1', 停: 'AGENT-1' })

    const s = buildStack('p0a', routes!, { freezeQueue: true })
    const prev = snapshotOf([person('AGENT-1', 2)])
    const next = snapshotOf([person('AGENT-1', 2), person('AGENT-9', 1)]) // 新人入司
    const { hr } = applyHr(s, prev, next, true)
    expect(hr.changes.map((c) => `${c.kind}:${c.personId}`)).toEqual(['入:AGENT-9'])
    expect(hr.batchId).not.toBeNull()

    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    await s.engine.tick() // 第二拍：镜像重扫入表 → 相位尾投影落 todo_queue 行

    // 联动单：assignee=路由目标（对账岗），标题/溯源/priority 落位
    const issues = await s.platform.issues.list({})
    const linked = issues.filter((i) => i.title.startsWith('[联动]'))
    expect(linked).toHaveLength(1)
    expect(linked[0]?.assignee).toBe('AGENT-1')
    expect(linked[0]?.title).toContain('AGENT-9')
    expect(linked[0]?.title).toContain('入')
    expect(linked[0]?.description).toContain(hr.batchId ?? '') // linked_ticket=hr 批次（对账锚溯源）
    const c0 = hr.changes[0]
    if (c0 === undefined) throw new Error('unreachable：changes 已断言 1 条')
    const fp = `${c0.personId}+${c0.kind}+${c0.prev ?? ''}→${c0.next ?? ''}` // 变更指纹（入事件 next=复合明细串）
    expect(linked[0]?.description).toContain(fp)

    // PATROL 留痕：intent=people-change|data-change|demo|<指纹>（铁律2 幂等锚）
    const patrols = eventsOf(s.ledger, 'PATROL')
    expect(patrols.some((p) => (p.note ?? '').includes(`intent=people-change|data-change|demo|${fp}`))).toBe(true)

    // todo_queue 投影：对账岗收件箱面（129-B 投影，person=AGENT-1）
    const queue = s.ledger.listTodoQueue()
    expect(queue.some((r) => r.person === 'AGENT-1')).toBe(true)
    s.ledger.close()
  })

  it('三变更批（升/停/入）→ 三张联动单各按路由指派（升→PRIME-0 规范位胜出）', async () => {
    const routes = mergeDataChangeRoutes({ data_change: { routes: { 升: 'PRIME-0' } } }, { 入: 'AGENT-1', 停: 'AGENT-1' })
    const s = buildStack('p0a-multi', routes!)
    const prev = snapshotOf([person('AGENT-1', 2), person('AGENT-2', 3)])
    const next = snapshotOf([person('AGENT-1', 3), person('AGENT-2', 3, 'paused'), person('AGENT-9', 1)])
    const { hr } = applyHr(s, prev, next, true)
    expect(hr.changes.map((c) => `${c.kind}:${c.personId}`)).toEqual(['升:AGENT-1', '停:AGENT-2', '入:AGENT-9'])

    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const linked = (await s.platform.issues.list({})).filter((i) => i.title.startsWith('[联动]'))
    expect(linked).toHaveLength(3)
    const byAssignee = new Map(linked.map((i) => [`${i.assignee}`, (i.title.match(/AGENT-\d/) ?? [''])[0]]))
    expect(byAssignee.get('PRIME-0')).toBe('AGENT-1') // 升 → PLN 线（规范位）
    expect(byAssignee.get('AGENT-1')).toBe('AGENT-9') // 入 → 对账岗
    s.ledger.close()
  })
})

// ————————————————————————— 2. S2 判负线：同指纹重投恒一张 —————————————————————————

describe('幂等双层（129-§6.1 铁律2：源 at-least-once × 引擎恰好一次）', () => {
  it('同变更 100 批重投 → 恒只一张联动单（第二张即判负线）', async () => {
    const routes = mergeDataChangeRoutes({ data_change: { routes: { 入: 'AGENT-1' } } }, undefined)
    const s = buildStack('s2-dedup', routes!)
    const prev = snapshotOf([person('AGENT-1', 2)])
    const next = snapshotOf([person('AGENT-1', 2), person('AGENT-9', 1)])
    const { hr } = applyHr(s, prev, next, true)
    expect(hr.enqueued).toBeGreaterThan(0)
    // 重投 100 次（新批次号、同一变更指纹——源面 at-least-once 模拟：重放/多源同报）
    for (let i = 0; i < 100; i += 1) s.publish(hr.changes, `REPLAY-${i}`)
    await s.engine.tick()
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[联动]'))).toHaveLength(1)
    // 跨拍再投也不长单（patrolKeys append-only 恰好一次）
    s.publish(hr.changes, 'REPLAY-FINAL')
    const report2 = await s.engine.tick()
    expect(report2.errors).toEqual([])
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[联动]'))).toHaveLength(1)
    s.ledger.close()
  })
})

// ————————————————————————— 3. 路由合并件单元面 —————————————————————————

describe('mergeDataChangeRoutes（org-config 规范位 + daemon.yaml 逃生位）', () => {
  it('两侧皆空 → undefined（fail-closed：未配=明报拒收不猜默认）', () => {
    expect(mergeDataChangeRoutes(undefined, undefined)).toBeUndefined()
    expect(mergeDataChangeRoutes({}, undefined)).toBeUndefined()
  })

  it('只有 org-config → 原样（拷贝不改入参）；只有 daemon → 透传', () => {
    const org = { data_change: { routes: { 入: 'AGENT-1' } } }
    expect(mergeDataChangeRoutes(org, undefined)).toEqual({ 入: 'AGENT-1' })
    expect(mergeDataChangeRoutes(undefined, { 调: 'AGENT-2' })).toEqual({ 调: 'AGENT-2' })
    expect(org.data_change.routes).toEqual({ 入: 'AGENT-1' }) // 入参不被改写
  })

  it('两侧并存 → daemon 逐键覆盖（129-A 既有逃生位不破）', () => {
    expect(
      mergeDataChangeRoutes({ data_change: { routes: { 入: 'AGENT-1', 升: 'PRIME-0' } } }, { 升: 'AGENT-1' }),
    ).toEqual({ 入: 'AGENT-1', 升: 'AGENT-1' })
  })
})

// ————————————————————————— 4. publish 隔离与未接线面 —————————————————————————

describe('publish 隔离（双写失败不炸 apply 段——数据面主产物照旧）', () => {
  it('publish 抛错：hr 三面任务照入队、log 明报双写失败、异常不上抛', () => {
    const s = buildStack('iso', mergeDataChangeRoutes({ data_change: { routes: { 入: 'AGENT-1' } } }, undefined)!)
    const prev = snapshotOf([person('AGENT-1', 2)])
    const next = snapshotOf([person('AGENT-1', 2), person('AGENT-9', 1)])
    const logs: string[] = []
    const hr = hrApplySegment({
      enabled: true,
      ledger: s.ledger,
      prev,
      next,
      company: 'demo',
      clock: s.clock.now,
      makeId: makeUlid,
      log: (l) => logs.push(l),
      publish: () => {
        throw new Error('boom：意图面模拟故障')
      },
    })
    expect(hr.enqueued).toBe(3) // 入=3 面任务（三面链=主产物不受双写故障影响）
    expect(logs.join('\n')).toContain('双写失败')
    expect(logs.join('\n')).toContain('boom')
  })

  it('未接线（hrPeopleWatch 关面）：零意图入队；changes 源料照回传（数据面行为字节不变）', async () => {
    const s = buildStack('off', mergeDataChangeRoutes({ data_change: { routes: { 入: 'AGENT-1' } } }, undefined)!)
    const prev = snapshotOf([person('AGENT-1', 2)])
    const next = snapshotOf([person('AGENT-1', 2), person('AGENT-9', 1)])
    const { hr } = applyHr(s, prev, next, false)
    expect(hr.changes).toHaveLength(1) // 源料在（缺的只是双写面）
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    expect((await s.platform.issues.list({})).filter((i) => i.title.startsWith('[联动]'))).toHaveLength(0)
    s.ledger.close()
  })
})
