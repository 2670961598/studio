/**
 * harvest-recon —— P3 收账对账相位回归（studio-dev-122；spike-3 三工况，提案 §5 冻结判据）
 *
 * 缺口（提案 E9-E13，2026-10-20/21 实证）：
 *   - E9 归档断链（86 号）：jobs[].output 声明落点 × 公司目录实际文件无对账面——存量断链
 *     无回扫补收；
 *   - E10 悬空单（94 号）：有产物无 REPORT 的收割失败面不可见——重派/回收决策看不到半成品；
 *   - E12 权限静默（113 号归档 mode 600 实证）：收账面无可达性检查。
 *
 * 本刀（spike-3 判据即断言；docs/17-§2 相位 4 尾对账步 + §6 四要件冻结不动）：
 *   - 工况一（86 复刻）：REPORT_MISSING 事件 + 内容哈希幂等补收（补收后文件存在且哈希与
 *     工位副本一致）；重复收割→跳过；改工位副本重收→哈希异→转人工事件、不覆盖；
 *   - 工况二（94 复刻）：HARVEST_INCOMPLETE 事件且收账面可见、不自动补收不代写；
 *   - 工况三（权限夹具）：交付物 chmod 000 → HARVEST_DENIED 不静默；umask 前移后新单
 *     产物权限 ≥0644。
 *   - 判负线（负断言）：补收后哈希不核=负（断言回读核过）；工况二被「修复」成自动生成
 *     REPORT=负（断言 REPORT 不被代写）；仅打日志不进事件=负（断言全部走台账 queryEvents）。
 */
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { EventRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import { openLedger, type JobRecord, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine, type TickReport } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'
import { DEMO_SNAPSHOT } from '../../src/assembly/serve.ts'
import { deliverablesOf, statHarvestDenial } from '../../src/engine/jobs/harvest-recon.ts'

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

/** 引擎栈（job-output.test 同形；对账步节流=每拍——recon 面常开） */
function buildStack(id: string, mode: 'ok' | 'no_report' = 'ok'): {
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
  companyDir: string
  workspaceOf: (ticket: TicketId) => string
  reportsDir: string
} {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = { now: (): number => t, advance: (ms: number): void => { t += ms } }
  const registry = createRegistry()
  registry.register(createFakeAdapter({ mode: () => mode, name: 'fake' }), { default: true })
  const companyRoot = path.join(root, `${id}-company`)
  const engineRoot = path.join(root, id)
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
      rootDir: engineRoot,
      defaultPersonId: 'AGENT-1',
      deptFallback: 'departments/工程部',
      defaultLane: 'core',
      companyDir: companyRoot,
      harvestReconEveryTicks: 1, // 对账步每拍（节流面另有缺省 30——engine config 单测不在此重复）
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

function sha256Of(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function archivedFileOf(dir: string): string {
  const names = readdirSync(dir)
  expect(names).toHaveLength(1) // 单岗单单——收账目标唯一
  return path.join(dir, names[0] as string)
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'studio-next-harvest-recon-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

// ————————————————————————— 单元面：stat 兜底 / 悬空快照 —————————————————————————

describe('statHarvestDenial / deliverablesOf：E12 可达性体检与悬空面快照', () => {
  it('0644 可读=undefined；chmod 000 → EACCES 归因（不静默的判定基元）', () => {
    const dir = path.join(root, 'unit-perm')
    mkdirSync(dir, { recursive: true })
    const f = path.join(dir, 'REPORT.md')
    writeFileSync(f, '# R\n', 'utf8')
    expect(statHarvestDenial(dir, f)).toBeUndefined()
    chmodSync(f, 0o000)
    const denied = statHarvestDenial(dir, f)
    expect(denied).toBeDefined()
    expect(denied?.path).toBe(f)
    expect(denied?.reason).toMatch(/EACCES|permission/i)
    chmodSync(f, 0o644) // 还原（afterAll 清场面）
  })
  it('deliverablesOf：空目录/.gitkeep=undefined；有件=清单（94 号快照）', () => {
    const ws = path.join(root, 'unit-ws', 'att1')
    mkdirSync(path.join(ws, 'deliverables'), { recursive: true })
    expect(deliverablesOf(ws)).toBeUndefined()
    writeFileSync(path.join(ws, 'deliverables', '.gitkeep'), '', 'utf8')
    expect(deliverablesOf(ws)).toBeUndefined()
    writeFileSync(path.join(ws, 'deliverables', 'plan.md'), '# P\n', 'utf8')
    expect(deliverablesOf(ws)).toEqual(['plan.md'])
  })
})

// ————————————————————————— 工况一（spike-3 §5：86 号复刻） —————————————————————————

describe('工况一：有工位副本、缺归档 → REPORT_MISSING + 内容哈希幂等补收', () => {
  it('补收后目标存在且哈希与工位副本一致（先事件后搬运；判负线：补收后哈希不核=负）', async () => {
    const stack = buildStack('g1')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    const harvest = await dispatchAndHarvest(stack)
    expect(harvest.phases.harvest.completed).toBe(1) // GATE_PASS + DEV-50 常态收账在位
    const target = archivedFileOf(stack.reportsDir)
    const source = path.join(stack.workspaceOf('T-1'), 'REPORT.md')
    const goodHash = sha256Of(target)
    expect(sha256Of(source)).toBe(goodHash) // 常态收账（accountJobOutput）先证在位
    // —— 86 号工况复刻：公司目录归档缺失（存量断链——收割时 daemon 停机/收账失败面）——
    unlinkSync(target)
    expect(existsSync(target)).toBe(false)
    stack.clock.advance(1000)
    const reconTick = await stack.engine.tick()
    // 先事件（台账非日志——判负线③）：
    expect(eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')).toHaveLength(1)
    expect(eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')[0]?.note).toContain('缺归档→补收')
    // 后搬运 + 回读核哈希（判负线①）：
    expect(existsSync(target)).toBe(true)
    expect(sha256Of(target)).toBe(sha256Of(source))
    expect(sha256Of(target)).toBe(goodHash) // 补收内容=断链前的工位副本原貌
    expect(reconTick.phases.harvest.recon).toMatchObject({ scanned: 1, repaired: 1, manual: 0 })
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('重复收割→跳过（目标在位且哈希同：零新事件零动作）', async () => {
    const stack = buildStack('g1-idem')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    await dispatchAndHarvest(stack)
    const target = archivedFileOf(stack.reportsDir)
    unlinkSync(target)
    stack.clock.advance(1000)
    await stack.engine.tick() // 补收拍
    expect(eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')).toHaveLength(1)
    stack.clock.advance(1000)
    const again = await stack.engine.tick() // 重复收割拍
    expect(eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')).toHaveLength(1) // 幂等：不重复落事件
    expect(again.phases.harvest.recon).toMatchObject({ scanned: 1, inPlace: 1, repaired: 0, manual: 0 })
    expect(sha256Of(target)).toBe(sha256Of(path.join(stack.workspaceOf('T-1'), 'REPORT.md')))
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('改工位副本后重收 → 哈希异 → 转人工事件、目标不被覆盖（迟到写入竞态安全，R6）', async () => {
    const stack = buildStack('g1-conflict')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    await dispatchAndHarvest(stack)
    const target = archivedFileOf(stack.reportsDir)
    const source = path.join(stack.workspaceOf('T-1'), 'REPORT.md')
    const archivedHash = sha256Of(target)
    unlinkSync(target)
    stack.clock.advance(1000)
    await stack.engine.tick() // 补收拍（复原归档）
    // 工位副本被改（迟到写入）→ 哈希异：
    writeFileSync(source, `${readFileSync(source, 'utf8')}\n人事后补改写\n`, 'utf8')
    stack.clock.advance(1000)
    const conflictTick = await stack.engine.tick()
    const missings = eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')
    expect(missings).toHaveLength(2)
    expect(missings[1]?.note).toContain('哈希异')
    expect(missings[1]?.note).toContain('转人工绝不覆盖')
    expect(sha256Of(target)).toBe(archivedHash) // 绝不覆盖：归档仍是补收时点原貌
    expect(sha256Of(target)).not.toBe(sha256Of(source))
    expect(conflictTick.phases.harvest.recon).toMatchObject({ manual: 1 })
    stack.clock.advance(1000)
    await stack.engine.tick() // 再扫：冲突已报过（recon-key 去重）——不刷事件
    expect(eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')).toHaveLength(2)
    await stack.engine.dispose()
    stack.ledger.close()
  })

  it('工位副本失考（工位 REPORT 已删）→ 事件转人工、不崩不代写', async () => {
    const stack = buildStack('g1-nocopy')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    await dispatchAndHarvest(stack)
    const target = archivedFileOf(stack.reportsDir)
    unlinkSync(target)
    unlinkSync(path.join(stack.workspaceOf('T-1'), 'REPORT.md')) // 工位副本失考
    stack.clock.advance(1000)
    const tick = await stack.engine.tick()
    const missings = eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')
    expect(missings).toHaveLength(1)
    expect(missings[0]?.note).toContain('无工位副本可补')
    expect(existsSync(target)).toBe(false) // 不代写：没有副本就没有归档
    expect(tick.phases.harvest.recon).toMatchObject({ manual: 1 })
    expect(tick.errors).toHaveLength(0) // 转人工是事件面，不是 tick 错误
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

// ————————————————————————— 工况二（spike-3 §5：94 号复刻） —————————————————————————

describe('工况二：有产物、无 REPORT → HARVEST_INCOMPLETE 可见，不补收不代写', () => {
  it('GATE_FAIL 时 deliverables 在场 → 事件进台账（attempt 作用域）＋半成品清单入 note', async () => {
    const stack = buildStack('g2')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    // 派发拍（fake ok 形态落 REPORT）后、收割拍前注入 94 号工况：删 REPORT、留产物
    stack.clock.advance(1000)
    const dispatchTick = await stack.engine.tick()
    expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
    const ws = stack.workspaceOf('T-1')
    unlinkSync(path.join(ws, 'REPORT.md'))
    unlinkSync(path.join(ws, 'summary.json'))
    mkdirSync(path.join(ws, 'deliverables'), { recursive: true })
    writeFileSync(path.join(ws, 'deliverables', 'plan.md'), '# 计划\n半成品语料（94 号 att1 同型）\n', 'utf8')
    stack.clock.advance(1000)
    const harvest = await stack.engine.tick()
    expect(harvest.phases.harvest.failed).toBe(1) // 四要件缺 REPORT=GATE_FAIL（冻结语义不动）
    const incompletes = eventsOf(stack.ledger, 'HARVEST_INCOMPLETE', 'T-1')
    expect(incompletes).toHaveLength(1)
    expect(incompletes[0]?.attempt).toBe(1)
    expect(incompletes[0]?.note).toContain('deliverables=1件（plan.md）')
    expect(incompletes[0]?.note).toContain('不补收不代写')
    // 判负线②：工况二被「修复」成自动生成 REPORT=负——daemon 不代写：
    expect(existsSync(path.join(ws, 'REPORT.md'))).toBe(false)
    // 不自动补收：公司目录零归档（非岗产物落位面不该有动作）
    expect(existsSync(stack.reportsDir)).toBe(false)
    await stack.engine.dispose()
    stack.ledger.close()
  })
})

// ————————————————————————— 工况三（spike-3 §5：权限夹具） —————————————————————————

describe('工况三：chmod 000 → HARVEST_DENIED 不静默；umask 前移后新单产物 ≥0644', () => {
  it('umask 前移：派发窗 0o022——脚手架与 worker 产物默认 ≥0644（治 E12 于干预窗内）', async () => {
    const prev = process.umask(0o077) // 收紧外环境：前移不生效则产物 0600——断言有区分度
    try {
      const stack = buildStack('g3-umask')
      stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
        stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
      stack.clock.advance(1000)
      const dispatchTick = await stack.engine.tick()
      expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
      const ws = stack.workspaceOf('T-1')
      // daemon 落盘脚手架（brief）与 worker 侧产物（fake launch 窗内落 REPORT）≥0644：
      expect(statSync(path.join(ws, 'brief.md')).mode & 0o777).toBe(0o644)
      expect(statSync(path.join(ws, 'REPORT.md')).mode & 0o777).toBe(0o644)
      stack.clock.advance(1000)
      await stack.engine.tick() // dispose 前收口在途（收割拍）
      await stack.engine.dispose()
      stack.ledger.close()
    } finally {
      process.umask(prev)
    }
  })

  it('交付物 chmod 000 → HARVEST_DENIED 事件不静默；四要件判定不被 denied 改判', async () => {
    const stack = buildStack('g3-denied')
    stack.ledger.upsertJob(reportJob('daily-report-工程部', { type: 'report', output: 'reports/工程部/' }))
    stack.engine.ingest([scheduleIntent('daily-report-工程部', 'sched:daily-report-工程部:1')])
    stack.clock.advance(1000)
    const dispatchTick = await stack.engine.tick()
    expect(dispatchTick.phases.dispatch.dispatched).toBe(1)
    const ws = stack.workspaceOf('T-1')
    chmodSync(path.join(ws, 'REPORT.md'), 0o000) // E12 夹具：收账面读不动
    stack.clock.advance(1000)
    const harvest = await stack.engine.tick()
    const denied = eventsOf(stack.ledger, 'HARVEST_DENIED', 'T-1')
    expect(denied).toHaveLength(1)
    expect(denied[0]?.note).toContain(`path=${path.join(ws, 'REPORT.md')}`)
    expect(denied[0]?.note).toContain('人工处置')
    // 四要件冻结：REPORT 在位（existsSync 语义）+闸门 echo 过——GATE_PASS 照判（denied 只补可见）；
    // 常态收账 copyFileSync 读不动源 → output-err 留痕（不静默的另一面）：
    expect(harvest.phases.harvest.completed).toBe(1)
    expect(eventsOf(stack.ledger, 'GATE_PASS', 'T-1')[0]?.note).toContain('output-err=')
    // 对账步同拍如实续报：工位 REPORT 不可读（chmod 000 哈希失考）→ REPORT_MISSING
    // 转人工（不猜不伪造——诚实留痕）：
    const missing = eventsOf(stack.ledger, 'REPORT_MISSING', 'T-1')
    expect(missing).toHaveLength(1)
    expect(missing[0]?.note).toContain('工位副本不可读')
    chmodSync(path.join(ws, 'REPORT.md'), 0o644) // 还原（afterAll 清场面）
    await stack.engine.dispose()
    stack.ledger.close()
  })
})
