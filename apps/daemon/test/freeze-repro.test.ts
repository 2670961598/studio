/**
 * freeze-repro —— DEV-9 P1 生产冻结复现与回归（主循环死锁：收割相位阻塞整拍）
 *
 * 事故（2026-10-19，台账 ledger.sqlite + logs/daemon.log）：
 *   18:35:05 DISPATCH LOCAL-28（executor=dsh）→ 下一拍收割相位进入 harvestOne 的
 *   `for await adapter.stream()` 后 **3 分 29 秒零事件**（18:38:35 GATE_FAIL 落账、
 *   tick#2694 行此刻才打印）——期间控制面 reload 无回执、进程 S 态 0% CPU。
 *
 * 根因（实现层）：dsh 适配器 stream() 迭代子进程 stdout，生成器仅在 worker 进程
 * 退出后才 return；而收割相位内联于 tick()（docs/17-§2 七相位顺序执行）——一拍
 * 阻塞 = worker 全生命周期。既有测试全用 src/fakes.ts（launch 即完成流），阻塞面
 * 不可见，故从未拦住。
 *
 * 本文件用**受控挂起流**的 adapter 精确复现：流产出前几个事件后驻留（等外部
 * 释放），断言（修复后）：
 *   1. tick() 在有界时间内返回（拍有界，docs/17-§2）——冻结不再；
 *   2. 驻留期间零动作拍照常落 HEARTBEAT（主循环活性——事故中「零事件」的直接反面）；
 *   3. 流驻留的单据留在在途（harvest.pending 可观测），不误判成功/失败；
 *   4. 流完成后下一拍收口四要件 GATE_PASS（docs/17-§6 判定体不动）；
 *   5. 驻留期流异常 → 下一拍 WORKER_DEAD 失败面收口（无悬空拒绝/无静默吞）。
 */
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import { initCompany, loadCompanyDirectory, readDirectoryFiles } from '@studio-next/company'
import type { CompanySnapshot, DetectResult, ExecutorAdapter, Handle, PersonRef, StreamEvent, TaskBrief, BudgetEstimate, ResultStats } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine } from '../src/engine.ts'
import { createFakePlatform } from '../src/fakes.ts'
import { createDefaultGateRunner } from '../src/gate.ts'
import { createDefaultAssembler } from '../src/prompt-assembly.ts'

const GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: 'studio-next-freeze-repro',
  GIT_AUTHOR_EMAIL: 'freeze-repro@studio-next.invalid',
  GIT_COMMITTER_NAME: 'studio-next-freeze-repro',
  GIT_COMMITTER_EMAIL: 'freeze-repro@studio-next.invalid',
}

const T0 = Date.parse('2026-10-19T10:35:00.000Z')

let root = ''
let snapshot: CompanySnapshot
/** afterEach 兜底释放所有挂起门（防用例失败时驻留生成器泄漏进后续用例） */
const releaseFns: Array<() => void> = []

// ---------------------------------------------------------------------------
// 受控挂起 adapter：launch 落齐产物（REPORT/summary——四要件可过），stream 产出
// 前几个事件后驻留在受控门上；release() 放行至 turn_end(completed)，fail() 注入
// 流异常（驻留期拒绝面）。kill = release('aborted')（dsh 同款：无 turn_end 即退）。
// ---------------------------------------------------------------------------

interface HangGate {
  release(): void
  fail(err: Error): void
}

function createHangingAdapter(): { adapter: ExecutorAdapter; gates: Array<HangGate> } {
  const name = 'hangdsh'
  const gates: HangGate[] = []
  const sessions = new Map<string, { settled: boolean }>()
  let seq = 0

  const adapter: ExecutorAdapter = {
    name,
    capabilities: {
      budget_cap: false,
      cancel_turn: false,
      session_resume: false,
      agents_md: 'native',
      cost_native: false,
    },
    async detect(): Promise<DetectResult> {
      return { name, version: '0.0.0-hang', ok: true, gaps: [] }
    },
    async estimate(_task: TaskBrief): Promise<BudgetEstimate> {
      return { estimated: { usd: 0.01 }, confidence: 1 }
    },
    async launch(task: TaskBrief): Promise<Handle> {
      seq += 1
      const sessionId = `${name}-${seq}`
      // worker 侧产物（真实 dsh worker 分钟级跑完才落——这里 launch 即落仅为让四要件
      // 在流完成后可判过；冻结面只取决于 stream() 的驻留）
      mkdirSync(task.workspace, { recursive: true })
      writeFileSync(path.join(task.workspace, 'REPORT.md'), '# REPORT\n\nfreeze-repro 工作产出\n', 'utf8')
      writeFileSync(path.join(task.workspace, 'summary.json'), '{"summary":"freeze-repro"}', 'utf8')
      sessions.set(sessionId, { settled: false })
      return { executor: name, sessionId, pid: 0 }
    },
    async *stream(h: Handle): AsyncIterable<StreamEvent> {
      const session = sessions.get(h.sessionId)
      if (session === undefined) throw new Error(`${name}: 未知会话 ${h.sessionId}`)
      if (session.settled) throw new Error(`${name}: 一流一收（重复消费）`)
      session.settled = true
      yield { type: 'log', text: '[hangdsh] 工作产出文本（非空输出——四要件之一）' }
      yield { type: 'step_start', step: 'work' }
      yield { type: 'step_end', step: 'work', usage: { input: 100, output: 50 } }
      // —— 冻结点：真机 dsh 在此长时间无新事件（worker 还在跑）——
      let release!: () => void
      let reject!: (err: Error) => void
      const gate = new Promise<void>((res, rej) => {
        release = res
        reject = rej
      })
      gates.push({ release, fail: reject })
      releaseFns.push(release)
      await gate
      // 放行后补终态（真机=worker 退出前最后一批事件）
      yield { type: 'turn_end', completed: true, usage: { input: 100, output: 50 } }
    },
    async resultStats(h: Handle): Promise<ResultStats> {
      return { cost: { usd: 0.01 }, tokens: { input: 100, output: 50 }, duration: 10, turns: 1 }
    },
    async kill(h: Handle): Promise<void> {
      // dsh 语义：kill=优雅空收尾无 turn_end——放行门让流自然收尾（不再 yield）
      sessions.get(h.sessionId) // 无状态面：门由测试侧 release
    },
    isCompleted(h: Handle): boolean {
      return sessions.get(h.sessionId)?.settled === true
    },
  }
  return { adapter, gates }
}

// ---------------------------------------------------------------------------
// 测试栈（e2e.test.ts 同款，adapter 换挂起版；harvestSliceMs 调小让驻留快现）
// ---------------------------------------------------------------------------

function deterministicIds(): (ts: number) => string {
  let n = 0
  return (): string => {
    n += 1
    return '0'.repeat(10) + String(n).padStart(16, '0')
  }
}

interface TestStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildStack(id: string, adapter: ExecutorAdapter): TestStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = T0
  const clock = {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms
    },
  }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
  const registry = createRegistry()
  registry.register(adapter, { default: true })
  const person = snapshot.people[0] as PersonRef
  const engine = createEngine({
    platform,
    ledger,
    registry,
    assembler: createDefaultAssembler({
      fwVersion: 'v0.5-demo',
      frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
      snapshot,
      acceptance: ['echo demo-ok'],
      docRefs: ['docs/17-§2（主循环七相位）'],
    }),
    gateRunner: createDefaultGateRunner(),
    clock: clock.now,
    config: {
      ...ENGINE_CONFIG_DEFAULTS,
      company: snapshot.slug,
      rootDir: path.join(root, id),
      defaultPersonId: person.id,
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      harvestSliceMs: 30,
    },
    people: snapshot.people,
    makeId: deterministicIds(),
  })
  return { platform, ledger, engine, clock }
}

/** 有界等待：超时回 SENTINEL（不抛——让断言面报告「tick 未在有界时间返回」=冻结复现） */
const TIMED_OUT = Symbol('timed-out')
async function bounded<T>(p: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  return await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(TIMED_OUT), ms)
    timer.unref?.()
    p.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        resolve(e as unknown as T)
      },
    )
  })
}

beforeAll(async () => {
  Object.assign(process.env, GIT_ENV)
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-freeze-repro-'))
  const companyDir = path.join(root, 'company')
  const init = await initCompany({ slug: 'demo-corp', targetDir: companyDir })
  expect(init.gitCommit).toBeTruthy()
  const mounted = loadCompanyDirectory(await readDirectoryFiles(companyDir))
  if (!mounted.ok) throw new Error(`公司目录挂载失败：${mounted.issues.map((i) => `${i.file}:${i.line}`).join('；')}`)
  snapshot = mounted.snapshot
})

afterEach(() => {
  for (const release of releaseFns.splice(0)) release()
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('DEV-9 冻结复现：收割流驻留时主循环必须保持拍有界（docs/17-§2）', () => {
  it('tick1 派发挂起流 worker（在途 1）', async () => {
    const { adapter } = createHangingAdapter()
    const stack = buildStack('freeze-main', adapter)
    const created = await stack.platform.issues.create({
      title: '冻结复现单',
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    const r1 = await stack.engine.tick()
    expect(r1.errors).toEqual([])
    expect(r1.phases.dispatch.dispatched).toBe(1)
    expect(r1.inflightAfter).toBe(1)
    expect(created.id).toBe('T-1')
  })

  it('冻结复现（核心断言）：worker 流驻留时下一拍必须在有界时间返回，且单据留在在途', async () => {
    const { adapter, gates } = createHangingAdapter()
    const stack = buildStack('freeze-core', adapter)
    await stack.platform.issues.create({
      title: '冻结复现单',
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    await stack.engine.tick() // 派发（同拍派发不收割——docs/17-§2 结构性保证，流未开）

    // —— 冻结点复现：下一拍进收割相位，流驻留（门未放）——
    stack.clock.advance(1000)
    const startedAt = Date.now()
    const r2 = await bounded(stack.engine.tick(), 1_000)
    expect(r2).not.toBe(TIMED_OUT) // 修复前：整拍挂在 for await 流上（事故 3m29s 面）
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    const report = r2 as Awaited<ReturnType<Engine['tick']>>
    expect(report.errors).toEqual([])
    expect(report.inflightAfter).toBe(1) // 驻留单留在在途——不误收口
    expect(report.phases.harvest.pending).toBeGreaterThanOrEqual(1)
    expect(gates).toHaveLength(1) // 流已开并驻留在门上（真机=worker 还在跑）
    // 无收割结论（GATE_* 未落）
    expect(stack.ledger.queryEvents({ issue: 'T-1' }).map((e) => e.event)).toEqual(['DISPATCH'])
  })

  it('驻留期间主循环活性：连续拍均有界返回且零动作拍落 HEARTBEAT（事故「零事件」反面）', async () => {
    const { adapter } = createHangingAdapter()
    const stack = buildStack('freeze-liveness', adapter)
    await stack.platform.issues.create({
      title: '冻结复现单',
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    await stack.engine.tick() // 派发
    for (let i = 0; i < 3; i += 1) {
      stack.clock.advance(1000)
      const r = await bounded(stack.engine.tick(), 1_000)
      expect(r).not.toBe(TIMED_OUT)
    }
    // 主循环活着 = 心跳照落（含派发后的驻留拍）
    const beats = stack.ledger.queryEvents({ issue: '-' }).filter((e) => e.event === 'HEARTBEAT')
    expect(beats.length).toBeGreaterThanOrEqual(3)
  })

  it('流放行 → 下一拍收口四要件 GATE_PASS（docs/17-§6 判定体不动）', async () => {
    const { adapter, gates } = createHangingAdapter()
    const stack = buildStack('freeze-pass', adapter)
    await stack.platform.issues.create({
      title: '冻结复现单',
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    await stack.engine.tick() // 派发
    stack.clock.advance(1000)
    await stack.engine.tick() // 收割检查：驻留
    expect(gates).toHaveLength(1)
    gates[0].release() // worker 跑完：流补 turn_end(completed=true)
    stack.clock.advance(1000)
    const r3 = await stack.engine.tick()
    expect(r3.errors).toEqual([])
    expect(r3.phases.harvest.completed).toBe(1)
    expect(r3.inflightAfter).toBe(0)
    expect(stack.ledger.queryEvents({ issue: 'T-1' }).map((e) => e.event)).toEqual(['DISPATCH', 'GATE_PASS'])
    const record = stack.ledger.listWorkRecords({ issue: 'T-1' })[0]
    expect(record?.status).toBe('done')
    expect(record?.report_ref).toMatch(/REPORT\.md$/)
    expect(existsSync(record?.report_ref ?? '')).toBe(true)
  })

  it('驻留期流异常 → 下一拍 WORKER_DEAD 失败面收口（无悬空拒绝）', async () => {
    const { adapter, gates } = createHangingAdapter()
    const stack = buildStack('freeze-dead', adapter)
    await stack.platform.issues.create({
      title: '冻结复现单',
      type: 'task',
      dept: snapshot.departments[0]?.path,
      level: 0,
      assignee: snapshot.people[0]?.id,
    })
    stack.clock.advance(1000)
    await stack.engine.tick() // 派发
    stack.clock.advance(1000)
    await stack.engine.tick() // 收割检查：驻留
    expect(gates).toHaveLength(1)
    gates[0].fail(new Error('worker 进程异常退出（复现）'))
    stack.clock.advance(1000)
    const r3 = await stack.engine.tick()
    expect(r3.phases.harvest.failed).toBe(1)
    expect(r3.inflightAfter).toBe(0)
    const gateFail = stack.ledger.queryEvents({ issue: 'T-1' }).find((e) => e.event === 'GATE_FAIL')
    expect(gateFail?.note).toContain('WORKER_DEAD：流消费异常 worker 进程异常退出（复现）')
    expect((await stack.platform.issues.get('T-1')).state).toBe('新单') // 回首批位
  })
})
