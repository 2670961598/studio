/**
 * task-141：续跑面 × 路由源 executor（引擎级）——「resume 跨执行器不强行 resume」。
 *
 * 依据：docs/quality/model-routing.md §10「续跑与源 executor」；docs/v2/12 §2.1-③（session 归属
 * 执行位，换宿主=新段）；F1-15（续跑派发不静默：续跑/降级两形都带 note 锚与 causation_id）。
 *
 * 栈：fake 适配器（session_resume=true 续跑能力位）+ 真引擎全生命周期（派发→收割→CLOSE）→
 * 平台复活 + resume 主张 → 第二次派发。断言：
 *   ① 跨族：上次工位 dsh、路由首选源 executor=agy → 不强行续跑（降级新派锚明报因；新会话；
 *      causation_id 仍挂上次工时单）；在途执行器=源 executor（agy）。
 *   ② 同族：路由首选源 executor=dsh → 续跑位优先（续自第 N 誓锚在、attempt 续用、同会话）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createModelCatalog, modelSourcesOf, parseModelsYaml } from '@studio-next/core'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, ExecutorAdapter, TaskBrief, TicketId } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/demo/demo-snapshot.ts'

const roots: string[] = []
afterEach(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); roots.length = 0 })

const yamlOf = (firstExecutor: string): string => `tiers:
  high:
    sources:
      - {id: a, provider: glm, model: GLM-5.3, priority: 10, price: {inputPerM: 1, outputPerM: 2}, cooldown: {baseMs: 1500, maxMs: 3000, circuitAfter: 3}, executor: ${firstExecutor}}
      - {id: b, provider: opencode-go, model: kimi-k3.1-pro, priority: 20, price: {inputPerM: 2, outputPerM: 10}, executor: dsh}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1, outputPerM: 0.4}}
roles: {main_worker: high}
`

interface Stack {
  readonly engine: ReturnType<typeof createEngine>
  readonly platform: ReturnType<typeof createFakePlatform>
  readonly ledger: Ledger
  /** 各次 launch 收到的续跑三元组（fake 适配器不续会话——续跑与否以任务书 resume 字段为准） */
  readonly resumes: Array<TaskBrief['resume']>
  advance(ms: number): void
}

async function stack(root: string, yaml: string, launchFailures: Readonly<Record<string, readonly unknown[]>> = {}): Promise<Stack> {
  let now = Date.parse('2026-11-03T00:00:00.000Z')
  const platform = createFakePlatform({ now: () => new Date(now).toISOString() })
  const ledger = openLedger(path.join(root, 'ledger.sqlite'))
  const models = parseModelsYaml(yaml)
  const registry = createRegistry()
  const resumes: Array<TaskBrief['resume']> = []
  const wrap = (name: string): ExecutorAdapter => {
    const base = createFakeAdapter({ name }) as unknown as { launch: (t: TaskBrief) => Promise<unknown>; capabilities: Record<string, unknown> }
    return {
      ...base,
      capabilities: { ...base.capabilities, session_resume: true }, // 续跑能力位在场：续跑面能否成立只取决于源 executor 对账
      async launch(task: TaskBrief) {
        if (task.resume !== undefined) resumes.push(task.resume)
        const prior = ledger.listWorkRecords({ issue: task.ticket }).length
        const fail = launchFailures[name]?.[prior === 0 ? 0 : 1]
        if (fail !== undefined) throw fail
        return base.launch(task)
      },
    } as unknown as ExecutorAdapter
  }
  registry.register(wrap('dsh'), { default: true })
  registry.register(wrap('agy'))
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({ fwkVersion: 'v0.5-test', frameworkPrompts: '你是 demo worker：产出 REPORT/summary。', snapshot: DEMO_SNAPSHOT, acceptance: ['true'], docRefs: ['docs/17-§2'] }),
    gateRunner: createDefaultGateRunner(),
    clock: () => now,
    catalog: createModelCatalog(models),
    modelRouting: { sources: { high: modelSourcesOf(models, 'high') }, rootDir: root },
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: DEMO_SNAPSHOT.slug,
      rootDir: path.join(root, 'var'),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      mirrorRescanEveryTicks: 1,
      stallAfterMs: 60_000,
      modelTierByRole: { main_worker: 'high' },
      modelTierTickets: { 'T-1': 'high' },
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { engine, platform, ledger, resumes, advance: (ms) => { now += ms } }
}

async function tick(s: Stack): Promise<void> {
  s.advance(1000)
  await s.engine.tick()
}

function notesOf(ledger: Ledger, ticket: TicketId, event: EventRecord['event']): Array<EventRecord> {
  return ledger.queryEvents({ issue: ticket }).filter((e) => e.event === event)
}

/** 建单→跑到 CLOSE→复活+resume 主张→一拍；返回单号 */
async function runToCloseThenResume(s: Stack): Promise<TicketId> {
  const created = await s.platform.issues.create({ title: 'resume probe', type: 'task', level: 0, assignee: 'AGENT-1' })
  const ticket = created.id
  for (let i = 0; i < 12 && notesOf(s.ledger, ticket, 'CLOSE').length === 0; i += 1) await tick(s)
  expect(notesOf(s.ledger, ticket, 'CLOSE')).toHaveLength(1)
  await s.platform.issues.transition(ticket, '新单') // 平台侧复活（离开 closed 终态，closed-set 释放，重进决策）
  s.engine.ingest([{ kind: 'resume', company: DEMO_SNAPSHOT.slug, source: 'routing-test', ticket, payload: { cause: 'task-141 续跑×源 executor 探针' } }])
  await tick(s)
  return ticket
}

describe('task-141 续跑面 × 路由源 executor', () => {
  it('跨族：上次工位 dsh，路由首选源 executor=agy → 不强行续跑（降级新派明报；新会话；因果链仍挂上次工时单）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-resume-1')); roots.push(root)
    // 首派：a（agy）launch 429 → 冷却 1.5s → 换 b（dsh）成功 → 工位=dsh；冷却在 CLOSE 前到期
    const s = await stack(root, yamlOf('agy'), { agy: [new Error('upstream 429 quota exhausted')] })
    const ticket = await runToCloseThenResume(s)
    const [previous, current] = s.ledger.listWorkRecords({ issue: ticket })
    expect(previous?.executor).toBe('dsh')
    const dispatches = notesOf(s.ledger, ticket, 'DISPATCH')
    expect(dispatches).toHaveLength(2)
    const second = dispatches[1]?.note ?? ''
    expect(second).toContain(';resume=降级新派（路由源 a@agy 非续跑同族 dsh——task-141 跨执行器不强行续跑——F1-15）')
    expect(second).not.toContain('（续自第')
    expect(second).toContain('executor=agy@0.0.0-fake')
    expect(second).toContain(';routing=a@agy')
    expect(dispatches[1]?.causation_id).toBe(previous?.id) // 因果链不断
    expect(current?.executor).toBe('agy')
    expect(current?.session_id).not.toBe(previous?.session_id) // 新会话（续跑同一会话≠跨执行器）
    expect(s.resumes).toEqual([]) // 新派：任务书不带续跑三元组
  })

  it('同族：路由首选源 executor=dsh → 续跑位优先（续自第 N 誓锚在、任务书携续跑三元组）', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sn-src-exec-resume-2')); roots.push(root)
    const s = await stack(root, yamlOf('dsh'))
    const ticket = await runToCloseThenResume(s)
    const [previous] = s.ledger.listWorkRecords({ issue: ticket })
    const dispatches = notesOf(s.ledger, ticket, 'DISPATCH')
    expect(dispatches).toHaveLength(2)
    const second = dispatches[1]?.note ?? ''
    expect(second).toContain(`;resume=${previous?.session_id ?? ''}@dsh（续自第 1 誓）`)
    expect(second).not.toContain('resume=降级新派')
    expect(second).toContain(';routing=a@dsh')
    expect(second).toContain('executor=dsh@0.0.0-fake')
    expect(dispatches[1]?.causation_id).toBe(previous?.id)
    // 续跑成立：任务书携上次会话三元组（fake 适配器不续会话号——以任务书为准，不以台账会话号为准）
    expect(s.resumes).toEqual([{ sessionId: previous?.session_id ?? '', summaryPath: expect.any(String) }])
  })
})
