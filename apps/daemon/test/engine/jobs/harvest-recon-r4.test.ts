/**
 * R4 读回门：工单型岗归档件 内容门④＋哨兵门⑤＋patrol 计数⑥（127-A §4.5）。
 *
 * studio-dev-216 迁出注记：本套原在 `test/engine/harvest-recon.test.ts`（工况一/二/三
 * 同文件）；216 增补「写读形状失配」三工况后该件超 BC-S2 尺寸阈 600 行——R4 域整体
 * 迁出至 jobs/ 子域自持 harness（studio-dev-200 同款落位先例）。覆盖面零增减：
 * ok 全链 / missing / mismatch（抄旧槽）/ 空壳转人工 / patrol 观测计数
 * ＋216 三工况（deliverables 落位容错、存量回填清账、pre-R1 真欠账负对照）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import type { FlowPlatform } from '@studio-next/contract'
import { DEFAULT_FLOW_TABLE, type FlowTable } from '@studio-next/core'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type TickReport } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform, type FakeAdapterMode } from '../../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'
import { runHarvestRecon } from '../../../src/engine/jobs/harvest-recon.ts'
import { reportFileName } from '../../../src/engine/jobs/output-account.ts'
import { expectedSentinel } from '../../../src/engine/jobs/sentinel.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

let root = ''

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo, d, h, mi, s, 0).getTime()
}

const T0 = local(2026, 9, 16, 17, 55, 0)

function reportJob(job_id: string, payload: unknown): JobRecord {
  return {
    job_id,
    company: 'demo',
    dept: 'departments/工程部',
    cron: '0 18 * * *',
    role: 'AGENT-1',
    level: 2,
    model_tier: 'low',
    payload,
    next_run_at: 0,
  }
}

function scheduleIntent(jobId: string, dedupKey: string): InvokeIntent {
  return { kind: 'schedule', company: 'demo', payload: { job_id: jobId }, source: 'test-sched', dedupKey, priority: 2 }
}

/** 引擎栈（harvest-recon.test 同形；对账步节流=每拍——recon 面常开） */
function buildStack(id: string, mode: FakeAdapterMode = 'ok', flows?: FlowTable): {
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  companyDir: string
  workspaceOf: (ticket: TicketId) => string
  reportsDir: string
  platform: FlowPlatform
} {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode: () => mode, name: 'fake' }), { default: true })
  const companyRoot = path.join(root, `${id}-company`)
  const engineRoot = path.join(root, id)
  const platform = createFakePlatform({ now: () => new Date(clock.now()).toISOString() })
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwkVersion: 'v0.5-test',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot: DEMO_SNAPSHOT,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/04-§三（报表命名）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: 'demo',
      rootDir: engineRoot,
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      companyDir: companyRoot,
      harvestReconEveryTicks: 1, // 对账步每拍（节流面另有缺省 30——engine config 单测不在此重复）
      ...(flows !== undefined ? { flows } : {}),
    },
    people: DEMO_SNAPSHOT.people,
  })
  return {
    ledger,
    engine,
    clock,
    companyDir: companyRoot,
    workspaceOf: (ticket: TicketId): string => path.join(engineRoot, 'workspaces', ticket, 'att1'),
    reportsDir: path.join(companyRoot, 'reports', '工程部'),
    platform,
  }
}

async function dispatchAndHarvest(stack: { engine: Engine; clock: { advance(ms: number): void } }): Promise<TickReport> {
  stack.clock.advance(1000)
  const dispatchTick = await stack.engine.tick()
  expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
  stack.clock.advance(1000)
  return await stack.engine.tick()
}

function eventsOf(ledger: Ledger, name: EventRecord['event'], ticket?: TicketId): EventRecord[] {
  return ledger.queryEvents(ticket !== undefined ? { issue: ticket } : undefined).filter((e) => e.event === name)
}

function archivedFileOf(dir: string): string {
  // 127-A R1：归档目录可含 `<归档名>.summary.json` 侧车（哨兵随件）——收账目标仍唯一
  const names = readdirSync(dir).filter((n) => !n.endsWith('.summary.json'))
  expect(names).toHaveLength(1) // 单岗单单——收账目标唯一
  return path.join(dir, names[0] as string)
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-harvest-recon-r4-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

/** T:patrol 类型流（丁案语料：终态=巡毕无产出——与 templates org-config 同形） */
const PATROL_FLOWS: FlowTable = {
  ...DEFAULT_FLOW_TABLE,
  'T:patrol': {
    mainline: ['待巡查', '巡查中', '巡毕纪要', '巡毕复核', '巡毕无产出'],
    finalStates: ['巡毕无产出'],
    anchors: { fresh: '待巡查', approval: '', dispatched: '巡查中', evidenceReady: '巡毕纪要', verified: '巡毕复核', delivered: '巡毕无产出' },
  },
}

describe('R4 读回门：工单型岗归档件 内容门④＋哨兵门⑤（127-A §4.5）', () => {
  const SLOT = T0 + 5 * 60_000 // 槽时刻（scheduler dedupKey=job@firedAt 同源）

  it('哨兵 ok 全链：worker 回写三元组 → sidecar 随件归档＋GATE_PASS note sentinel=ok＋对账 sentinelOk、零事件', async () => {
    const stack = buildStack('r4-ok', 'sentinel')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', `daily-report-工程部@${SLOT}`)])
    await dispatchAndHarvest(stack)
    const target = archivedFileOf(stack.reportsDir)
    // 批示③：哨兵随件归档——`<归档名>.summary.json` 三元组=期望重算（nonce 机械落法）
    const sidecar = `${target}.summary.json`
    expect(existsSync(sidecar)).toBe(true)
    const parsed = JSON.parse(readFileSync(sidecar, 'utf8')) as { sentinel: unknown }
    expect(parsed.sentinel).toEqual(expectedSentinel('demo', 'daily-report-工程部', SLOT))
    // GATE_PASS 即时观测（不拦收割——P3 才是权威事件面）
    expect(eventsOf(stack.ledger, 'GATE_PASS', 'T-1')[0]?.note).toContain(';sentinel=ok')
    // 对账步：哨兵门过
    expect(eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')).toHaveLength(0)
    stack.clock.advance(1000)
    const reconTick = await stack.engine.tick()
    expect(eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')).toHaveLength(0) // 幂等：ok 恒不落事件
    expect(reconTick.phases.harvest.recon).toMatchObject({ sentinelOk: 1, sentinelMissing: 0, invalid: 0 })
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('哨兵缺（worker 未回写）→ GATE_PASS note sentinel=missing＋SENTINEL_MISSING 欠账不重派（recon-key 幂等）', async () => {
    const stack = buildStack('r4-missing')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', `daily-report-工程部@${SLOT}`)])
    await dispatchAndHarvest(stack)
    expect(eventsOf(stack.ledger, 'GATE_PASS', 'T-1')[0]?.note).toContain(';sentinel=missing')
    // 对账步（收割拍尾即首告）：欠账不重派——批示⑤
    const missings = eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')
    expect(missings).toHaveLength(1)
    expect(missings[0]?.note).toContain('欠账不重派')
    expect(missings[0]?.note).toContain('jobs catchup')
    expect(missings[0]?.note).toContain(`run_at=${SLOT}`)
    expect(missings[0]?.issue).toBe('T-1')
    stack.clock.advance(1000)
    const reconTick = await stack.engine.tick()
    expect(eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')).toHaveLength(1) // recon-key 去重
    expect(reconTick.phases.harvest.recon).toMatchObject({ sentinelMissing: 1, sentinelOk: 0 })
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('哨兵不符（抄旧槽——run_at 挪 7 天）→ note sentinel=mismatch＋SENTINEL_MISSING 状态=mismatch', async () => {
    const stack = buildStack('r4-stale', 'sentinel_old')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', `daily-report-工程部@${SLOT}`)])
    await dispatchAndHarvest(stack)
    expect(eventsOf(stack.ledger, 'GATE_PASS', 'T-1')[0]?.note).toContain(';sentinel=mismatch')
    const missings = eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')
    expect(missings).toHaveLength(1)
    expect(missings[0]?.note).toContain('状态=mismatch')
    expect(missings[0]?.note).toContain('抄旧槽')
    await stack.engine.dispose()
    stack.ledger.close()
  })

  // —— studio-dev-216：写读形状失配（212 实况复刻＋清账路径回放）——

  it('212 复刻（fresh 面）：sidecar 落 deliverables/ → gate 容错发现＋随件归档＋哨兵 ok 零误报', async () => {
    // 212 实况：worker 三元组写对、落位偏一格（deliverables/summary.json，正位无件）——
    // 修复前 gate 只认正位 → summary 缺 → 不归档 → P3 读归档侧车=unreadable → 误报
    // SENTINEL_MISSING（09:10:24 关单、09:10:32 误报）。修复后全链绿。
    const stack = buildStack('r4-216-fresh', 'sentinel_deliverables')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', `daily-report-工程部@${SLOT}`)])
    await dispatchAndHarvest(stack)
    const gateNote = eventsOf(stack.ledger, 'GATE_PASS', 'T-1')[0]?.note ?? ''
    // gate 容错发现：summary= 指向 deliverables/ 兜床位（正位优先——此形态正位无件）
    expect(gateNote).toContain(`;summary=${path.join(stack.workspaceOf('T-1'), 'deliverables', 'summary.json')}`)
    expect(gateNote).toContain(';sentinel=ok')
    // 随件归档：`<归档名>.summary.json` 落位且三元组=期望重算（P3 事实源补齐）
    const target = archivedFileOf(stack.reportsDir)
    const sidecar = `${target}.summary.json`
    expect(existsSync(sidecar)).toBe(true)
    expect((JSON.parse(readFileSync(sidecar, 'utf8')) as { sentinel: unknown }).sentinel).toEqual(
      expectedSentinel('demo', 'daily-report-工程部', SLOT),
    )
    expect(eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')).toHaveLength(0)
    const reconTick = await stack.engine.tick()
    expect(reconTick.phases.harvest.recon).toMatchObject({ sentinelOk: 1, sentinelMissing: 0, sentinelBackfilled: 0 })
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('清账路径（存量面·212 真数据回放）：归档侧车缺＋工位副本三元组 ok → 回填归档＋复核不再误报（幂等）', () => {
    // 复刻 live ledger 的 212 真形状（修复前已收割：GATE_PASS note 无 summary 段、
    // 无归档侧车；工位 deliverables/summary.json 携真三元组——nonce 亲复算一致）：
    // PATROL dedup=pln-daily-review-研发部@1792717202702 → expected nonce=3cf0e51d…c4cc。
    const id = 'r4-216-backfill'
    const ledger = openLedger(path.join(root, `${id}.sqlite`))
    const RUN_AT = 1792717202702
    const REAL_NONCE = '3cf0e51d7579e3d14f9c622c99991b1e8647d1852ef711366f3dad52c018c4cc'
    expect(expectedSentinel('studio-dev', 'pln-daily-review-研发部', RUN_AT).nonce).toBe(REAL_NONCE) // 真槽复算锚
    const companyRoot = path.join(root, `${id}-company`)
    const ws = path.join(root, id, 'workspaces', 'studio-dev-212', 'att1')
    const job: JobRecord = {
      job_id: 'pln-daily-review-研发部',
      company: 'studio-dev',
      dept: 'departments/研发部',
      cron: '0 9 * * *',
      role: 'PLN-1',
      level: 2,
      model_tier: 'low',
      payload: { type: 'report', output: 'reports/研发部/' },
      next_run_at: 0,
    }
    ledger.upsertJob(job)
    ledger.appendEvent({
      id: makeUlid(T0), ts: RUN_AT - 5000, company: 'studio-dev', issue: 'studio-dev-212',
      event: 'PATROL', actor: 'daemon', attempt: 1, level: 2, dept: 'departments/研发部',
      tokens: { input: 0 },
      note: `intent=scheduler|schedule|studio-dev|pln-daily-review-研发部@${RUN_AT};job=pln-daily-review-研发部;cron=0 9 * * *;role=PLN-1;dedup=pln-daily-review-研发部@${RUN_AT};来源=scheduler`,
    } satisfies EventRecord)
    const gateTs = 1792717813292 // live 09:10:24 关单时刻（reportFileName 同刻同公式）
    ledger.appendEvent({
      id: makeUlid(T0 + 1), ts: gateTs, company: 'studio-dev', issue: 'studio-dev-212',
      event: 'GATE_PASS', actor: 'daemon', attempt: 1, level: 2, dept: 'departments/研发部',
      tokens: { input: 1 },
      // live 真形状：无 ;summary= 段（修复前 gate 盲视 deliverables/ 落位）
      note: `四要件齐（completed/非空/REPORT/exit0）；report=${path.join(ws, 'REPORT.md')};budget=settle 冲销 $0.0500 实际 $0.0000`,
    } satisfies EventRecord)
    // 工位现场：REPORT＋deliverables/summary.json（真三元组；正位无 sidecar——212 实况）
    const reportBody = '# 212 日报\n\n## 结论\n\n全链关单（正文有效字符远超 16）'
    mkdirSync(path.join(ws, 'deliverables'), { recursive: true })
    writeFileSync(path.join(ws, 'REPORT.md'), reportBody, 'utf8')
    writeFileSync(
      path.join(ws, 'deliverables', 'summary.json'),
      JSON.stringify({ sentinel: { job: 'pln-daily-review-研发部', run_at: RUN_AT, nonce: REAL_NONCE } }),
      'utf8',
    )
    // 归档在位（收割时已收账）但无侧车——内容与工位副本同（inPlace 口径）
    const targetDir = path.join(companyRoot, 'reports', '研发部')
    mkdirSync(targetDir, { recursive: true })
    const target = path.join(targetDir, reportFileName(job, 'studio-dev-212', gateTs))
    writeFileSync(target, reportBody, 'utf8')
    const emitted: Array<{ name: string; ticket: TicketId; note: string }> = []
    const emit = (name: 'REPORT_MISSING' | 'HARVEST_INCOMPLETE' | 'SENTINEL_MISSING' | 'HARVEST_INVALID', ticket: TicketId, _attempt: number, note: string): void => {
      emitted.push({ name, ticket, note })
    }
    // 第一扫：回填归档侧车＋sentinelOk（误报欠账清账——零新事件）
    const first = runHarvestRecon({ ledger, companyDir: companyRoot, emit })
    expect(first).toMatchObject({ sentinelOk: 1, sentinelBackfilled: 1, sentinelMissing: 0 })
    expect(existsSync(`${target}.summary.json`)).toBe(true)
    expect(emitted.filter((e) => e.name === 'SENTINEL_MISSING')).toHaveLength(0) // 复核不再误报
    // 第二扫（幂等）：侧车已归档 → 直读 ok，不再计回填、零事件
    const second = runHarvestRecon({ ledger, companyDir: companyRoot, emit })
    expect(second).toMatchObject({ sentinelOk: 1, sentinelBackfilled: 0, sentinelMissing: 0 })
    expect(emitted).toHaveLength(0)
    ledger.close()
  })

  it('清账路径负对照（pre-R1 存量）：工位副本无三元组 → 不回填不代写，照旧 fail-closed 欠账', () => {
    // 机制前历史岗单（194 型：summary.json 在正位但无 sentinel 字段）＝真欠账非误报——
    // 回填门只治「写错位」，不治「没写」：SENTINEL_MISSING 照落（recon-key 幂等）。
    const id = 'r4-216-prer1'
    const ledger = openLedger(path.join(root, `${id}.sqlite`))
    const companyRoot = path.join(root, `${id}-company`)
    const ws = path.join(root, id, 'workspaces', 'studio-dev-194', 'att1')
    const job: JobRecord = {
      job_id: 'hf-finance-daily',
      company: 'studio-dev',
      dept: 'departments/综合部',
      cron: '0 20 * * *',
      role: 'HF-1',
      level: 2,
      model_tier: 'low',
      payload: { type: 'report', output: 'reports/综合部/' },
      next_run_at: 0,
    }
    ledger.upsertJob(job)
    ledger.appendEvent({
      id: makeUlid(T0), ts: T0, company: 'studio-dev', issue: 'studio-dev-194',
      event: 'PATROL', actor: 'daemon', attempt: 1, level: 2, dept: 'departments/综合部',
      tokens: { input: 0 },
      note: `intent=scheduler;job=hf-finance-daily;dedup=hf-finance-daily@${SLOT};来源=scheduler`,
    } satisfies EventRecord)
    ledger.appendEvent({
      id: makeUlid(T0 + 1), ts: T0 + 600_000, company: 'studio-dev', issue: 'studio-dev-194',
      event: 'GATE_PASS', actor: 'daemon', attempt: 1, level: 2, dept: 'departments/综合部',
      tokens: { input: 1 },
      note: `四要件齐（completed/非空/REPORT/exit0）；report=${path.join(ws, 'REPORT.md')};summary=${path.join(ws, 'summary.json')}`,
    } satisfies EventRecord)
    mkdirSync(ws, { recursive: true })
    const reportBody = '# 194 日结\n\n## 结论\n\n已交付（有效字符过门）'
    writeFileSync(path.join(ws, 'REPORT.md'), reportBody, 'utf8')
    writeFileSync(path.join(ws, 'summary.json'), JSON.stringify({ schema: 'summary/v1', conclusion: 'pre-R1 无哨兵', changed_files: [] }), 'utf8')
    const targetDir = path.join(companyRoot, 'reports', '综合部')
    mkdirSync(targetDir, { recursive: true })
    const target = path.join(targetDir, reportFileName(job, 'studio-dev-194', T0 + 600_000))
    writeFileSync(target, reportBody, 'utf8')
    const emitted: Array<{ name: string; note: string }> = []
    // emit 桩兼落账（engine makeEvent 同效）——recon-key 幂等去重跨扫生效的先决面
    const emit = (name: 'REPORT_MISSING' | 'HARVEST_INCOMPLETE' | 'SENTINEL_MISSING' | 'HARVEST_INVALID', _ticket: TicketId, _attempt: number, note: string): void => {
      emitted.push({ name, note })
      ledger.appendEvent({
        id: makeUlid(T0 + 900_000 + emitted.length), ts: T0 + 900_000 + emitted.length,
        company: 'studio-dev', issue: 'studio-dev-194', event: name, actor: 'daemon',
        attempt: 1, level: 2, dept: 'departments/综合部', tokens: { input: 0 }, note,
      } satisfies EventRecord)
    }
    const first = runHarvestRecon({ ledger, companyDir: companyRoot, emit })
    expect(first).toMatchObject({ sentinelOk: 0, sentinelBackfilled: 0, sentinelMissing: 1 })
    expect(first.manual).toBe(0) // 归档在位哈希同——非转人工面
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.name).toBe('SENTINEL_MISSING')
    expect(emitted[0]?.note).toContain('状态=unreadable') // 归档侧车缺＝不可读（如实暴露）
    expect(emitted[0]?.note).toContain('欠账不重派')
    expect(existsSync(`${target}.summary.json`)).toBe(false) // 不代写归档侧车
    const second = runHarvestRecon({ ledger, companyDir: companyRoot, emit })
    expect(second.sentinelMissing).toBe(1)
    expect(emitted).toHaveLength(1) // recon-key 幂等去重
    ledger.close()
  })

  it('内容门④：归档件空壳（有效字符<16）→ HARVEST_INVALID 转人工（不叠哨兵事件）；修复后 recon-key 换键可再报', async () => {
    const stack = buildStack('r4-shell', 'sentinel')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', `daily-report-工程部@${SLOT}`)])
    await dispatchAndHarvest(stack)
    const target = archivedFileOf(stack.reportsDir)
    expect(eventsOf(stack.ledger, 'HARVEST_INVALID', 'T-1')).toHaveLength(0)
    // 归档后被篡改成空壳（骨架/占位面——R4④ 判据）：工位副本与归档同改同内容——
    // 哈希同走 inPlace 读回门（哈希异会先进 conflict 转人工支配序，那是工况一既有面）
    const shell = '# REPORT\n\n## 结论\n\n（略）\n'
    writeFileSync(target, shell, 'utf8')
    writeFileSync(path.join(stack.workspaceOf('T-1'), 'REPORT.md'), shell, 'utf8')
    stack.clock.advance(1000)
    const reconTick = await stack.engine.tick()
    const invalids = eventsOf(stack.ledger, 'HARVEST_INVALID', 'T-1')
    expect(invalids).toHaveLength(1)
    expect(invalids[0]?.note).toContain('空壳')
    expect(invalids[0]?.note).toContain('不自动重派')
    // 信号支配序：内容门先红 → 哨兵门不叠事件（sidecar 仍 ok 也不计数）
    expect(eventsOf(stack.ledger, 'SENTINEL_MISSING', 'T-1')).toHaveLength(0)
    expect(reconTick.phases.harvest.recon).toMatchObject({ invalid: 1 })
    stack.clock.advance(1000)
    await stack.engine.tick()
    expect(eventsOf(stack.ledger, 'HARVEST_INVALID', 'T-1')).toHaveLength(1) // recon-key（含哈希）幂等
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('⑥ patrol 巡查物化单：T:patrol 终态物化零派发＋对账只计观测数（不事件化）', async () => {
    const stack = buildStack('r4-patrol', 'ok', PATROL_FLOWS)
    stack.ledger.upsertJob(reportJob('health-patrol-工程部', { type: 'patrol' }))
    stack.engine.ingest([scheduleIntent('health-patrol-工程部', `health-patrol-工程部@${SLOT}`)])
    stack.clock.advance(1000)
    const tick1 = await stack.engine.tick()
    // 丁案：巡查工件落 T:patrol delivered 终态（结构性不可派发——不烧配额）
    const issue = await stack.platform.issues.get('T-1')
    expect(issue.type).toBe('patrol')
    expect(issue.state).toBe('巡毕无产出')
    expect(eventsOf(stack.ledger, 'PATROL', 'T-1')).toHaveLength(1)
    expect(tick1.phases.dispatch.dispatched).toBe(0)
    // 对账步：计观测数即止——无收割语义无事件（spam 防线）
    const recon = tick1.phases.harvest.recon
    expect(recon).toMatchObject({ patrolArtifacts: 1, scanned: 0 })
    for (const name of ['SENTINEL_MISSING', 'HARVEST_INVALID', 'REPORT_MISSING'] as const) {
      expect(eventsOf(stack.ledger, name, 'T-1')).toHaveLength(0)
    }
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('⑥ T:patrol 未声明 → L0 delivered 兜底（现状行为原样；装载警告面治源不炸配置）', async () => {
    const stack = buildStack('r4-patrol-l0')
    stack.ledger.upsertJob(reportJob('health-patrol-工程部', { type: 'patrol' }))
    stack.engine.ingest([scheduleIntent('health-patrol-工程部', `health-patrol-工程部@${SLOT}`)])
    stack.clock.advance(1000)
    const tick1 = await stack.engine.tick()
    const issue = await stack.platform.issues.get('T-1')
    expect(issue.type).toBe('patrol')
    expect(issue.state).toBe('已交付') // L0 兜底——语义退化由 jobContractLoadWarnings 可见
    expect(tick1.phases.harvest.recon).toMatchObject({ patrolArtifacts: 1 })
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
