/**
 * job-output —— DEV-50 岗产物落位收账回归（红→绿：收账面为新增机制，断言即规格）
 *
 * 缺口（2026-10-20 实证 studio-dev-86 首件日报）：jobs[].output 落点声明全链无消费面
 * ——REPORT 只落工位（work_records.report_ref），公司目录 reports/ 位空置，docs/04-§三
 * 报表聚合地基断链；worker 沙箱（workspace-write）写不到公司目录位=必须收割面代收。
 *
 * 本刀（收割面收账，docs/17-§2 第 4 相后置步；17-§6 四要件冻结不动）：
 *   - 单元面：reportFileName 命名约定（04-§三 + 消毒）＋ accountJobOutput 分支
 *     （非岗单/未声明落点/面未开=空收账非错；job 失联/落点不合法/写失败=err 留痕不抛）；
 *   - 链路面：真引擎全链（upsertJob→schedule 意图→tick 物化派发→tick 收割）——
 *     GATE_PASS 后 REPORT 按落点收账、note 携 output= 证据锚；
 *   - 负面：面未开（companyDir 不注入）零行为变化；落点不合法（绕过装载闸直写台账）
 *     收账失败不回滚收割（四要件仍判 PASS）、异常如实进 tick errors。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type TickReport } from '../../src/engine/engine.ts'
import { accountJobOutput, reportFileName } from '../../src/engine/jobs/output-account.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { makeUlid } from '../../src/engine/tools/id.ts'
import { DEMO_SNAPSHOT } from '../../src/assembly/serve.ts'

let root = ''

function local(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number {
  return new Date(y, mo, d, h, mi, s, 0).getTime()
}

const T0 = local(2026, 9, 16, 17, 55, 0) // 2026-10-16 17:55 本地——收割跨 18:00 日报窗语料

/** 日报岗语料（toJobs 装载后的 jobs 表同形：payload 骑 output/type——M4-④） */
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

/** PATROL 事件直写（单→岗锚语料——engine 物化口径同形，jobs-lifecycle appendEvt 同手法） */
function appendPatrol(ledger: Ledger, ticket: TicketId, jobId: string, ts: number): void {
  ledger.appendEvent({
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue: ticket,
    event: 'PATROL',
    actor: 'daemon',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    note: `intent=sched:${jobId}:1;job=${jobId};cron=0 18 * * *;role=AGENT-1;dedup=sched:${jobId}:1;来源=test`,
  } satisfies EventRecord)
}

/** 引擎栈（breaker/jobs-lifecycle 同手法；companyDir 可选注入=DEV-50 收账面开关） */
function buildStack(id: string, companyDir?: string, mode: 'ok' | 'no_report' = 'ok'): {
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  companyDir: string
} {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode: () => mode, name: 'fake' }), { default: true })
  const companyRoot = path.join(root, `${id}-company`)
  const engine = createEngine({
    platform: createFakePlatform({ now: () => new Date(clock.now()).toISOString() }),
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
      rootDir: path.join(root, id),
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      ...(companyDir !== undefined ? { companyDir } : {}),
    },
    people: DEMO_SNAPSHOT.people,
  })
  return { ledger, engine, clock, companyDir: companyRoot }
}

/** 派发拍+收割拍（fake adapter ok 形态：launch 即写 REPORT——第二拍四要件齐 GATE_PASS） */
async function dispatchAndHarvest(stack: { engine: Engine; clock: { advance(ms: number): void } }): Promise<TickReport> {
  stack.clock.advance(1000)
  const dispatchTick = await stack.engine.tick()
  expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
  stack.clock.advance(1000)
  return await stack.engine.tick()
}

function gatePassNotes(ledger: Ledger, ticket: string): string[] {
  return ledger.queryEvents({ issue: ticket }).filter((e) => e.event === 'GATE_PASS').map((e) => e.note ?? '')
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-job-output-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ————————————————————————— 单元面：命名约定（docs/04-§三） —————————————————————————

describe('reportFileName：`<YYYY-MM-DD>-<type>-<节点>-<单号>.md`（04-§三；本地时区取日与 cron 同口径）', () => {
  const job = reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' })
  it('常形：日期=now 本地日、type/节点取 payload/dept 尾段', () => {
    expect(reportFileName(job, 'T-7', local(2026, 9, 16, 18, 0, 0))).toBe('2026-10-16-report-工程部-T-7.md')
    // 跨日界（次日本地 00:05——UTC 语料回退核对）：日段随本地时区走
    expect(reportFileName(job, 'T-7', local(2026, 9, 17, 0, 5, 0))).toBe('2026-10-17-report-工程部-T-7.md')
  })
  it('缺 type 段=artifact 兜底；非法字符消毒（/ 与 ; 折叠为 -，防空段注入）', () => {
    expect(reportFileName(reportJob('plain', undefined), 'T-1', T0)).toBe('2026-10-16-artifact-工程部-T-1.md')
    const dirty = reportJob('dirty', { type: 're/port;rm' })
    expect(reportFileName(dirty, 'T-1', T0)).toBe('2026-10-16-re-port-rm-工程部-T-1.md')
  })
})

// ————————————————————————— 单元面：收账分支 —————————————————————————

describe('accountJobOutput：空收账三态与失败留痕（永不抛——收割成败不被收账牵动）', () => {
  let reportDir = ''
  let reportPath = ''

  beforeAll(() => {
    reportDir = path.join(root, 'unit-reports')
    reportPath = path.join(reportDir, 'REPORT.md')
    mkdirSync(reportDir, { recursive: true })
    writeFileSync(reportPath, '# REPORT\n落位收账单元语料\n', { flag: 'w' })
  })

  function ledgerOf(id: string): Ledger {
    return openLedger(path.join(root, `${id}.sqlite`))
  }

  it('面未开（companyDir 缺省）与非岗单（无 PATROL job= 锚）=空收账非错', () => {
    const ledger = ledgerOf('unit-closed')
    expect(accountJobOutput({ ledger, ticket: 'T-1', reportPath, companyDir: undefined, now: () => T0 })).toEqual({ noteSuffix: '', sidecarSuffix: '' })
    const plain = ledgerOf('unit-plain') // 空白台账（无 PATROL）——普通单语义
    expect(accountJobOutput({ ledger: plain, ticket: 'T-9', reportPath, companyDir: reportDir, now: () => T0 })).toEqual({ noteSuffix: '', sidecarSuffix: '' })
    ledger.close()
    plain.close()
  })

  it('岗未声明 output=空收账非错（多数岗无落点声明）', () => {
    const ledger = ledgerOf('unit-nodecl')
    appendPatrol(ledger, 'T-1', 'no-decl-job', T0)
    ledger.upsertJob(reportJob('no-decl-job', { type: 'patrol' }))
    expect(accountJobOutput({ ledger, ticket: 'T-1', reportPath, companyDir: reportDir, now: () => T0 })).toEqual({ noteSuffix: '', sidecarSuffix: '' })
    ledger.close()
  })

  it('job 失联（PATROL 有锚但台账无行——热更移除）= err 留痕 + onProblem 上报', () => {
    const ledger = ledgerOf('unit-missing')
    appendPatrol(ledger, 'T-1', 'ghost-job', T0)
    const problems: string[] = []
    const r = accountJobOutput({ ledger, ticket: 'T-1', reportPath, companyDir: reportDir, now: () => T0, onProblem: (m) => problems.push(m) })
    expect(r.noteSuffix).toContain('output-err=job 不在台账(job=ghost-job')
    expect(problems).toHaveLength(1)
    ledger.close()
  })

  it('落点不合法（../ 逃逸——绕过装载闸直写台账语料）= err 留痕、目标不落盘', () => {
    const ledger = ledgerOf('unit-unsafe')
    appendPatrol(ledger, 'T-1', 'escape-job', T0)
    ledger.upsertJob(reportJob('escape-job', { type: 'report', output: '../outside' }))
    const r = accountJobOutput({ ledger, ticket: 'T-1', reportPath, companyDir: reportDir, now: () => T0 })
    expect(r.noteSuffix).toContain('output-err=落点不合法')
    expect(existsSync(path.join(root, 'outside'))).toBe(false)
    ledger.close()
  })

  it('REPORT 失踪（要件 3 事实源异常）= 写失败留痕不抛', () => {
    const ledger = ledgerOf('unit-noreport')
    appendPatrol(ledger, 'T-1', 'noreport-job', T0)
    ledger.upsertJob(reportJob('noreport-job', { type: 'report', output: 'reports/工程部/' }))
    const r = accountJobOutput({
      ledger,
      ticket: 'T-1',
      reportPath: path.join(root, 'unit-reports', 'GONE.md'),
      companyDir: reportDir,
      now: () => T0,
    })
    expect(r.noteSuffix).toContain('output-err=写失败')
    ledger.close()
  })

  it('常形收账：mkdir -p + 复制 REPORT，note 携 output=<目标>；同单同日重收=幂等覆盖', () => {
    const ledger = ledgerOf('unit-happy')
    appendPatrol(ledger, 'T-1', 'daily-report-工程部', T0)
    ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    const r = accountJobOutput({ ledger, ticket: 'T-1', reportPath, companyDir: reportDir, now: () => T0 })
    const target = path.join(reportDir, 'reports/工程部/2026-10-16-report-工程部-T-1.md')
    expect(r).toEqual({ noteSuffix: `;output=${target}`, target, sidecarSuffix: '' }) // 无 summaryPath 入参=无侧车面（127-A R1）
    expect(readFileSync(target, 'utf8')).toContain('落位收账单元语料')
    writeFileSync(reportPath, '# REPORT\nv2 覆写语料\n', { flag: 'w' })
    accountJobOutput({ ledger, ticket: 'T-1', reportPath, companyDir: reportDir, now: () => T0 })
    expect(readFileSync(target, 'utf8')).toContain('v2 覆写语料')
    ledger.close()
  })
})

// ————————————————————————— 链路面：真引擎全链 —————————————————————————

describe('引擎链路：日报岗 GATE_PASS → REPORT 按 jobs[].output 落点收账（DEV-50 主证）', () => {
  it('18:00 日报岗全链：派发→收割→reports/<部门>/ 有当日文件，GATE_PASS note 携 output= 证据锚', async () => {
    const stack = buildStack('chain-happy', path.join(root, 'chain-happy-company'))
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    const harvest = await dispatchAndHarvest(stack)
    expect(harvest.phases.harvest.completed).toBe(1)
    const notes = gatePassNotes(stack.ledger, 'T-1')
    expect(notes).toHaveLength(1)
    const target = path.join(stack.companyDir, 'reports/工程部/2026-10-16-report-工程部-T-1.md')
    expect(notes[0]).toContain(`;output=${target}`)
    expect(existsSync(target)).toBe(true)
    // 收账件=工位 REPORT 同内容（复制非改写；work_records.report_ref 仍指工位原件）
    const workspaceReport = readFileSync(target, 'utf8')
    expect(workspaceReport.length).toBeGreaterThan(0)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('面未开（companyDir 不注入）：GATE_PASS 照常、无收账、无文件——既有链路零行为变化', async () => {
    const stack = buildStack('chain-closed')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    const harvest = await dispatchAndHarvest(stack)
    expect(harvest.phases.harvest.completed).toBe(1)
    expect(gatePassNotes(stack.ledger, 'T-1')[0]).not.toContain('output=')
    expect(existsSync(path.join(stack.companyDir, 'reports/工程部'))).toBe(false)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('落点不合法（绕过装载闸直写台账）：四要件仍判 PASS（收割成败不被收账牵动），err 如实进 tick errors', async () => {
    const stack = buildStack('chain-unsafe', path.join(root, 'chain-unsafe-company'))
    stack.ledger.upsertJob(reportJob('escape-job', { type: 'report', output: '../outside' }))
    stack.engine.ingest([scheduleIntent('escape-job', 'sched:escape-job:1')])
    const harvest = await dispatchAndHarvest(stack)
    expect(harvest.phases.harvest.completed).toBe(1) // 17-§6 四要件冻结口径不动
    const notes = gatePassNotes(stack.ledger, 'T-1')
    expect(notes[0]).toContain('output-err=落点不合法')
    expect(harvest.errors.some((e) => e.includes('落位收账') && e.includes('落点不合法'))).toBe(true)
    expect(existsSync(path.join(root, 'outside'))).toBe(false)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('GATE_FAIL（worker 未落 REPORT）：收账步不触达——无 GATE_PASS、无文件、无 errors', async () => {
    const stack = buildStack('chain-gatefail', path.join(root, 'chain-gatefail-company'), 'no_report')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    stack.clock.advance(1000)
    const dispatchTick = await stack.engine.tick()
    expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
    stack.clock.advance(1000)
    const harvest = await stack.engine.tick()
    expect(harvest.phases.harvest.failed).toBe(1) // 要件 3 红=FAIL 收口
    expect(gatePassNotes(stack.ledger, 'T-1')).toHaveLength(0) // 无 GATE_PASS 即无收账面
    expect(harvest.errors).toHaveLength(0) // 失败归 GATE_FAIL 语义，不混入收账噪音
    expect(existsSync(path.join(stack.companyDir, 'reports/工程部'))).toBe(false)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
