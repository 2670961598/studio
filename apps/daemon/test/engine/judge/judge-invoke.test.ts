/**
 * judge 判断调用库测试 —— studio-dev-160 §6.1-§6.6（制作人 2026-10-22 全批，单 164）
 *
 * 覆盖（invokeJudge 全序逐环节 + accounts 簿记 + 工厂面）：
 *   - 采纳路径：裁决采纳 + JUDGE_OK（note 四元组/tokens/cost 手算比对）+ 预算三行
 *     （日 reserve/调用 reserve/调用 settle）+ brief 合成面（任务串落盘/零凭据/一次性
 *     目录树调用毕整删——S4 断言面）；
 *   - 降级路径逐原因：bad-json（三道闸）/timeout/output-truncated（墙钟死线+kill 整树）/
 *     no-model 三形态（turn 失败带 errorCode/launch 即败/流异常）；
 *   - 三帽：estimate-over-cap（**不落账不派**——零预算行零 launch）/site-daily-cap/
 *     company-daily-cap（seed 结算行推已花）；
 *   - 事后超耗：裁决弃用回退机械规则（actual 仍落账仍计熔断签名）；
 *   - 按址熔断：同因 3 连（跨拍——每拍 beginTick）→ 第 4 次 site-open 零 launch；
 *   - 拍闸：同址第二拍 tick-quota（beginTick 后复位）；
 *   - accounts 纯面：scope 键冒号纪律/日 reserve 幂等/跨日懒收口（actual=日合计）；
 *   - dshJudgeAdapterFactory：非 judge 名/非 dsh 家 CONFIG_INVALID，dsh-judge 出 DshAdapter。
 * fake judge adapter：内存脚本回放（不许用 LLM 打桩——脚本是确定性的流形态等价物，
 * 与 adapters fake CLI 同理）；台账=真 store openLedger（落账面不打折）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type {
  DetectResult,
  ExecutorAdapter,
  ExecutorCapabilities,
  Handle,
  StreamEvent,
  TaskBrief,
  TokenCounts,
} from '@studio-next/contract'
import { createModelCatalog, parseModelsYaml } from '@studio-next/core'
import { DshAdapter } from '@studio-next/adapters'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  createJudgeRuntime,
  dshJudgeAdapterFactory,
  invokeJudge,
  type JudgeDeps,
  type JudgeSite,
} from '../../../src/engine/judge/invoke.ts'
import {
  ensureJudgeSiteDay,
  UTC_JUDGE_CALENDAR,
  judgeCallScope,
  judgeDayScope,
  reserveJudgeCall,
  settleJudgeCall,
  validJudgeSiteId,
} from '../../../src/engine/judge/accounts.ts'
import { createJudgeCallDirs } from '../../../src/engine/judge/workspace.ts'

// —— 公共语料 ——————————————————————————————————————————————

/** 价目表（low 档价手算锚：inputPerM=0.05 / outputPerM=0.25） */
const MODELS_YAML = `tiers:
  high: { provider: t, model: m-h, price: { inputPerM: 0.60, outputPerM: 2.20 } }
  mid: { provider: t, model: m-m, price: { inputPerM: 0.20, outputPerM: 0.80 } }
  low: { provider: t, model: m-l, price: { inputPerM: 0.05, outputPerM: 0.25 } }
roles:
  main_worker: high
  micro_judge: low
`
const catalog = createModelCatalog(parseModelsYaml(MODELS_YAML))
/** low 档价手算：1000 入 + 50 出 = 0.0000625 美元（测试期望不调 catalog 折算——防同源恒真） */
const COST_1000_50 = 1000 / 1e6 * 0.05 + 50 / 1e6 * 0.25

const root = mkdtempSync(join(tmpdir(), 'judge-invoke-test-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
let dbSeq = 0

/** 标准判断位：pick(candidate∈{a,b,c})，机械规则=取首候选 a（降级路径的可辨识回退值） */
const SITE: JudgeSite = {
  siteId: 'ticket-priority',
  vocab: { ops: [{ op: 'pick', params: { candidate: { kind: 'enum', values: ['a', 'b', 'c'] } } }] },
  fallback: () => ({ op: 'pick', params: { candidate: 'a' } }),
}

// —— fake judge adapter（确定性流形态回放） ————————————————————

interface FakeScript {
  logs?: string[]
  turnEnd?: { completed: boolean; error?: string; errorCode?: string }
  hang?: boolean
  streamThrows?: boolean
  failLaunch?: boolean
  statsTokens?: TokenCounts
}

class FakeJudgeAdapter implements ExecutorAdapter {
  readonly name = 'dsh-judge'
  readonly capabilities: ExecutorCapabilities = {
    budget_cap: false, cancel_turn: true, session_resume: false, agents_md: 'user_level', cost_native: false,
  }
  readonly briefs: TaskBrief[] = []
  readonly briefTexts: string[] = [] // launch 期取证（一次性目录调用毕即删——时序内读）
  killed = 0
  constructor(private readonly script: FakeScript) {}
  async detect(): Promise<DetectResult> {
    return { name: 'fake-judge', version: '1.0.0', ok: true, gaps: [] }
  }
  async estimate(): Promise<{ estimated: { usd: number }; confidence: number }> {
    return { estimated: { usd: 0 }, confidence: 1 }
  }
  async launch(task: TaskBrief): Promise<Handle> {
    if (this.script.failLaunch) throw new Error('spawn ENOENT：dsh 不在 PATH')
    this.briefs.push(task)
    this.briefTexts.push(readFileSync(task.briefPath, 'utf8'))
    return { executor: this.name, sessionId: `sess-${this.briefs.length}`, pid: 4242 }
  }
  async *stream(_h: Handle): AsyncIterable<StreamEvent> {
    for (const text of this.script.logs ?? []) yield { type: 'log', text }
    if (this.script.hang) await new Promise<never>(() => {}) // 永不结束——死线路径
    if (this.script.streamThrows) throw new Error('pipe broken')
    const t = this.script.turnEnd
    if (t !== undefined) {
      yield {
        type: 'turn_end',
        completed: t.completed,
        ...(t.error !== undefined ? { error: t.error } : {}),
        ...(t.errorCode !== undefined ? { errorCode: t.errorCode } : {}),
      }
    }
  }
  async resultStats(_h: Handle): Promise<{ cost: { usd: number }; tokens: TokenCounts; duration: number; turns: number }> {
    if (this.killed > 0) throw new Error('killed：无统计面') // 被杀进程收不到统计——如实
    return { cost: { usd: 0 }, tokens: this.script.statsTokens ?? { input: 0, output: 0 }, duration: 7, turns: 1 }
  }
  async kill(_h: Handle, _graceMs: number): Promise<void> {
    this.killed++
  }
}

/** 每用例独立台账+依赖（ledger 文件隔离；wsParent 固定子目录断言一次性目录树） */
function makeDeps(script: FakeScript): { deps: JudgeDeps; adapter: FakeJudgeAdapter; ledger: Ledger; wsParent: string } {
  const ledger = openLedger(join(root, `judge-${++dbSeq}.sqlite`))
  const adapter = new FakeJudgeAdapter(script)
  const wsParent = join(root, `ws-${dbSeq}`)
  mkdirSync(wsParent, { recursive: true })
  const deps: JudgeDeps = {
    company: 'demo-corp',
    ledger,
    catalog,
    makeAdapter: () => adapter,
    now: () => Date.now(),
    wsParent,
  }
  return { deps, adapter, ledger, wsParent }
}

/** 剩余一次性目录树计数（断言「调用毕整删」） */
function judgeTreesUnder(parent: string): number {
  return readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('studio-next-judge-')).length
}

// ————————————————————————— 采纳路径 —————————————————————————

describe('invokeJudge 采纳路径（§6.1 全序：三闸过→采纳→JUDGE_OK→三行落账）', () => {
  it('裁决采纳：verdict/cost 手算锚/JUDGE_OK 四元组 note/预算三行/brief 零凭据/一次性目录整删', async () => {
    const script: FakeScript = {
      logs: ['{"op":"pick","params":{"candidate":"b"}}'],
      turnEnd: { completed: true },
      statsTokens: { input: 1000, output: 50 },
    }
    const { deps, adapter, ledger, wsParent } = makeDeps(script)
    const res = await invokeJudge(createJudgeRuntime(), deps, SITE, { items: ['a', 'b', 'c'] })
    expect(res.degraded).toBe(false)
    expect(res.verdict).toEqual({ op: 'pick', params: { candidate: 'b' } })
    expect(res.costUsd).toBe(COST_1000_50)

    // JUDGE_OK：事件四元组 note + tokens + cost + 哨兵列
    const events = ledger.queryEvents()
    expect(events).toHaveLength(1)
    const ok = events[0]!
    expect(ok.event).toBe('JUDGE_OK')
    expect(ok.issue).toBe('ticket-priority')
    expect(ok.actor).toBe('daemon:micro-judge')
    expect(ok.dept).toBe('framework')
    expect(ok.attempt).toBe(1)
    expect(ok.note).toContain('site=ticket-priority')
    expect(ok.note).toContain('op=pick')
    expect(ok.note).toContain('vocab=')
    expect(ok.note).toContain('degraded=no')
    expect(ok.tokens.input).toBe(1000)
    expect(ok.cost_usd).toBe(COST_1000_50)

    // 预算三行：日 reserve（帽额全额）+ 调用 reserve + 调用 settle（actual=手算锚）
    const rows = ledger.listBudgets()
    expect(rows).toHaveLength(3)
    const scopes = rows.map((r) => r.scope_id)
    expect(scopes.filter((s) => s.startsWith('mj-day:ticket-priority:'))).toHaveLength(1)
    const callRows = rows.filter((r) => s_isCall(r.scope_id))
    expect(callRows.map((r) => r.kind).sort()).toEqual(['reserve', 'settle'])
    const settle = rows.find((r) => r.kind === 'settle' && s_isCall(r.scope_id))!
    expect(settle.actual_usd).toBe(COST_1000_50)

    // brief 合成面：哨兵票号/一次性 workspace/零凭据/user_level 通道/任务串含词表与上下文
    expect(adapter.briefs).toHaveLength(1)
    const brief = adapter.briefs[0]!
    expect(brief.ticket.startsWith('mj-')).toBe(true)
    expect(brief.attempt).toBe(1)
    expect(brief.credentials).toBeUndefined()
    expect(brief.AGENTS_MD.channel).toBe('user_level')
    expect(brief.workspace).toContain('studio-next-judge-')
    const briefText = adapter.briefTexts[0]! // launch 期取证（调用毕树已删）
    expect(briefText).toContain('判定器')
    expect(briefText).toContain('pick')
    expect(briefText).toContain('候选')
    expect(briefText).toContain('items')

    // 一次性目录树调用毕整删（brief 文件随树去——S4 断言面）
    expect(judgeTreesUnder(wsParent)).toBe(0)
    expect(existsSync(brief.briefPath)).toBe(false)
    ledger.close()
  })
})

/** scope 是否每次调用键（mj:<site>:<callId>） */
function s_isCall(scopeId: string): boolean {
  return scopeId.startsWith('mj:ticket-priority:')
}

// ————————————————————————— 降级路径（立即回退机械规则，不重试） ————————————

describe('invokeJudge 降级路径（§6.1 处置分叉）', () => {
  it('bad-json：围栏输出三道闸拒收→机械规则回退（candidate=a）+ JUDGE_FALLBACK + 仍结算真消耗', async () => {
    const script: FakeScript = {
      logs: ['```json\n{"op":"pick","params":{"candidate":"b"}}\n```'],
      turnEnd: { completed: true },
      statsTokens: { input: 1000, output: 50 },
    }
    const { deps, ledger } = makeDeps(script)
    const res = await invokeJudge(createJudgeRuntime(), deps, SITE, {})
    expect(res.degraded).toBe(true)
    expect(res.reason).toBe('bad-json')
    expect(res.verdict).toEqual({ op: 'pick', params: { candidate: 'a' } })
    expect(res.costUsd).toBe(COST_1000_50)
    const fb = ledger.queryEvents()[0]!
    expect(fb.event).toBe('JUDGE_FALLBACK')
    expect(fb.note).toBe('site=ticket-priority reason=bad-json')
    const settle = ledger.listBudgets().find((r) => r.kind === 'settle' && s_isCall(r.scope_id))!
    expect(settle.actual_usd).toBe(COST_1000_50)
    ledger.close()
  })

  it('timeout：零输出挂起→墙钟死线杀整树（kill 计数）→reason=timeout，actual=0 如实结算', async () => {
    const { deps, adapter, ledger } = makeDeps({ hang: true })
    const rt = createJudgeRuntime()
    const res = await invokeJudge(rt, deps, { ...SITE, timeoutMs: 120 }, {})
    expect(res.degraded).toBe(true)
    expect(res.reason).toBe('timeout')
    expect(res.durationMs).toBeGreaterThanOrEqual(100)
    expect(adapter.killed).toBe(1)
    const settle = ledger.listBudgets().find((r) => r.kind === 'settle' && s_isCall(r.scope_id))!
    expect(settle.actual_usd).toBe(0)
    ledger.close()
  }, 10_000)

  it('output-truncated：有部分输出后挂起→死线杀→reason=output-truncated', async () => {
    const { deps, ledger } = makeDeps({ logs: ['{"op":"pi'], hang: true })
    const res = await invokeJudge(createJudgeRuntime(), deps, { ...SITE, timeoutMs: 120 }, {})
    expect(res.reason).toBe('output-truncated')
    ledger.close()
  }, 10_000)

  it('no-model·turn 失败：turn_end completed=false + errorCode=AUTH→reason=no-model，note 带 code', async () => {
    const { deps, ledger } = makeDeps({ turnEnd: { completed: false, error: 'auth failed', errorCode: 'AUTH' } })
    const res = await invokeJudge(createJudgeRuntime(), deps, SITE, {})
    expect(res.reason).toBe('no-model')
    const fb = ledger.queryEvents()[0]!
    expect(fb.note).toContain('reason=no-model')
    expect(fb.note).toContain('code=AUTH')
    ledger.close()
  })

  it('no-model·launch 即败：spawn 层失败→reserve 收口 actual=0 结算，零 JUDGE_OK', async () => {
    const { deps, ledger } = makeDeps({ failLaunch: true })
    const res = await invokeJudge(createJudgeRuntime(), deps, SITE, {})
    expect(res.reason).toBe('no-model')
    const settle = ledger.listBudgets().find((r) => r.kind === 'settle' && s_isCall(r.scope_id))!
    expect(settle.actual_usd).toBe(0)
    expect(ledger.queryEvents().filter((e) => e.event === 'JUDGE_OK')).toHaveLength(0)
    ledger.close()
  })

  it('no-model·流异常：stream 抛错→reason=no-model（executor 侧管道坏同口径）', async () => {
    const { deps, ledger } = makeDeps({ streamThrows: true })
    const res = await invokeJudge(createJudgeRuntime(), deps, SITE, {})
    expect(res.reason).toBe('no-model')
    ledger.close()
  })
})

// ————————————————————————— 三帽（§6.2：不落账不派） ——————————————————

describe('invokeJudge 三帽（§6.2 事前估算闸+按址日帽+公司日帽）', () => {
  it('estimate-over-cap：估算超单次帽→拒绝=零预算行零 launch，只有 JUDGE_FALLBACK', async () => {
    const { deps, adapter, ledger } = makeDeps({ logs: ['{"op":"pick","params":{"candidate":"b"}}'], turnEnd: { completed: true } })
    const tightSite: JudgeSite = { ...SITE, caps: { perCallUsd: 1e-9, perSiteDailyUsd: 5, companyDailyUsd: 50 } }
    const res = await invokeJudge(createJudgeRuntime(), deps, tightSite, {})
    expect(res.reason).toBe('estimate-over-cap')
    expect(res.degraded).toBe(true)
    expect(res.verdict).toEqual({ op: 'pick', params: { candidate: 'a' } })
    expect(ledger.listBudgets()).toHaveLength(0) // 不落账不派：refuse 无预算行
    expect(adapter.briefs).toHaveLength(0) // 从未 launch
    expect(ledger.queryEvents()[0]!.event).toBe('JUDGE_FALLBACK')
    ledger.close()
  })

  it('site-daily-cap：址日已花+估算超帽→拒绝（seed 结算行推已花面）', async () => {
    const { deps, ledger } = makeDeps({ logs: ['{"op":"pick","params":{"candidate":"b"}}'], turnEnd: { completed: true } })
    const now = Date.now()
    reserveJudgeCall(ledger, { site: 'ticket-priority', callId: 'seed-1', estimatedUsd: 0.0001, ts: now, id: 'seed-r1' })
    settleJudgeCall(ledger, { site: 'ticket-priority', callId: 'seed-1', estimatedUsd: 0.0001, actualUsd: 0.0000999, ts: now, id: 'seed-s1' })
    const site: JudgeSite = { ...SITE, caps: { perCallUsd: 0.01, perSiteDailyUsd: 0.0001, companyDailyUsd: 5 } }
    const res = await invokeJudge(createJudgeRuntime(), deps, site, {})
    expect(res.reason).toBe('site-daily-cap')
    // seed 两行 + 无新行（refuse 在簿记前）
    expect(ledger.listBudgets()).toHaveLength(2)
    ledger.close()
  })

  it('company-daily-cap：他址消耗计入公司日帽→本址拒绝（跨址共帽语义）', async () => {
    const { deps, ledger } = makeDeps({ logs: ['{"op":"pick","params":{"candidate":"b"}}'], turnEnd: { completed: true } })
    const now = Date.now()
    reserveJudgeCall(ledger, { site: 'other-site', callId: 'seed-1', estimatedUsd: 0.0001, ts: now, id: 'seed-r1' })
    settleJudgeCall(ledger, { site: 'other-site', callId: 'seed-1', estimatedUsd: 0.0001, actualUsd: 0.0000999, ts: now, id: 'seed-s1' })
    const site: JudgeSite = { ...SITE, caps: { perCallUsd: 0.01, perSiteDailyUsd: 5, companyDailyUsd: 0.0001 } }
    const res = await invokeJudge(createJudgeRuntime(), deps, site, {})
    expect(res.reason).toBe('company-daily-cap')
    ledger.close()
  })
})

// ————————————————————————— 事后超耗 / 熔断 / 拍闸 ——————————————————

describe('invokeJudge 事后超耗与熔断拍闸（§6.2/§6.6）', () => {
  it('over-spend：实际>单次帽→裁决弃用回退机械规则（actual 仍落账仍计熔断签名）', async () => {
    // 100 万入 + 1 万出 = 0.05+0.0025 = 0.0525 > 0.01 缺省单次帽
    const { deps, ledger } = makeDeps({
      logs: ['{"op":"pick","params":{"candidate":"b"}}'],
      turnEnd: { completed: true },
      statsTokens: { input: 1_000_000, output: 10_000 },
    })
    const res = await invokeJudge(createJudgeRuntime(), deps, SITE, {})
    expect(res.degraded).toBe(true)
    expect(res.reason).toBe('over-spend')
    expect(res.verdict).toEqual({ op: 'pick', params: { candidate: 'a' } }) // 模型说了 b 也弃用
    expect(res.costUsd).toBeCloseTo(0.0525, 10)
    const settle = ledger.listBudgets().find((r) => r.kind === 'settle' && s_isCall(r.scope_id))!
    expect(settle.actual_usd).toBeCloseTo(0.0525, 10)
    expect(ledger.queryEvents()[0]!.note).toContain('reason=over-spend')
    ledger.close()
  })

  it('按址熔断：同因 3 连降级（跨拍）→ 第 4 次 site-open 零 launch；换址不受牵连', async () => {
    const { deps, adapter, ledger } = makeDeps({
      logs: ['```json\n{}\n```'],
      turnEnd: { completed: true },
      statsTokens: { input: 100, output: 10 },
    })
    const rt = createJudgeRuntime()
    for (let i = 1; i <= 3; i++) {
      rt.beginTick(`tick-${i}`)
      const res = await invokeJudge(rt, deps, SITE, {})
      expect(res.reason).toBe('bad-json')
    }
    expect(adapter.briefs).toHaveLength(3)
    rt.beginTick('tick-4')
    const blocked = await invokeJudge(rt, deps, SITE, {})
    expect(blocked.reason).toBe('site-open')
    expect(adapter.briefs).toHaveLength(3) // 熔断中不再唤起
    // 换址不受牵连（同拍同库）
    const other: JudgeSite = { ...SITE, siteId: 'other-place' }
    const otherRes = await invokeJudge(rt, deps, other, {})
    expect(otherRes.reason).toBe('bad-json')
    expect(adapter.briefs).toHaveLength(4)
    ledger.close()
  })

  it('拍闸：同址同拍第二唤起→tick-quota（beginTick 复位）；预检拒绝不点火', async () => {
    const good: FakeScript = { logs: ['{"op":"pick","params":{"candidate":"b"}}'], turnEnd: { completed: true }, statsTokens: { input: 100, output: 10 } }
    const { deps, adapter, ledger } = makeDeps(good)
    const rt = createJudgeRuntime()
    const first = await invokeJudge(rt, deps, SITE, {})
    expect(first.degraded).toBe(false)
    const second = await invokeJudge(rt, deps, SITE, {})
    expect(second.reason).toBe('tick-quota')
    expect(adapter.briefs).toHaveLength(1) // 预检拒绝不 launch
    rt.beginTick('tick-2')
    const third = await invokeJudge(rt, deps, SITE, {})
    expect(third.degraded).toBe(false)
    ledger.close()
  })
})

// ————————————————————————— accounts 纯面 —————————————————————————

describe('accounts 簿记面（scope 键纪律/日幂等/懒收口）', () => {
  it('scope 键冒号纪律：调用键/日键前缀互斥（公司日帽合计不双计）；siteId 闸', () => {
    expect(judgeCallScope('s', 'c')).toBe('mj:s:c')
    expect(judgeDayScope('s', 'd')).toBe('mj-day:s:d')
    expect(judgeDayScope('s', 'd').startsWith('mj:')).toBe(false) // 日键不进 mj: 前缀合计
    expect(validJudgeSiteId('')).toBe(false)
    expect(validJudgeSiteId('a:b')).toBe(false) // 冒号会撕裂 scope 键
    expect(validJudgeSiteId('ticket-priority')).toBe(true)
  })

  it('日 reserve 幂等：同日重复调不重复落；跨日懒收口=昨日结算 actual=日合计', () => {
    const ledger = openLedger(join(root, `judge-accounts-${++dbSeq}.sqlite`))
    const caps = { perCallUsd: 0.01, perSiteDailyUsd: 0.5, companyDailyUsd: 5 }
    const makeId = () => `id-${++dbSeq}`
    // 日键用 UTC 真值（judgeDaySpent 缺省 UTC 日历——seed ts 必须落在被收口的窗口内）
    const day1 = UTC_JUDGE_CALENDAR.dayKeyOf(Date.now())
    const day2 = UTC_JUDGE_CALENDAR.dayKeyOf(Date.now() + 86_400_000)
    const now = Date.now()
    ensureJudgeSiteDay(ledger, { site: 's', dayKey: day1, caps, ts: now, makeId })
    ensureJudgeSiteDay(ledger, { site: 's', dayKey: day1, caps, ts: now, makeId })
    let rows = ledger.listBudgets()
    expect(rows).toHaveLength(1) // 幂等
    expect(rows[0]!.scope_id).toBe(`mj-day:s:${day1}`)
    expect(rows[0]!.kind).toBe('reserve')
    expect(rows[0]!.estimated_usd).toBe(0.5) // 日帽全额预留
    // 当日真消耗 0.0000625（结算行），次日首唤起触发懒收口
    reserveJudgeCall(ledger, { site: 's', callId: 'c1', estimatedUsd: COST_1000_50, ts: now, id: makeId() })
    settleJudgeCall(ledger, { site: 's', callId: 'c1', estimatedUsd: COST_1000_50, actualUsd: COST_1000_50, ts: now, id: makeId() })
    ensureJudgeSiteDay(ledger, { site: 's', dayKey: day2, caps, ts: now + 86_400_000, makeId })
    rows = ledger.listBudgets()
    const daySettle = rows.find((r) => r.scope_id === `mj-day:s:${day1}` && r.kind === 'settle')
    expect(daySettle).toBeDefined()
    expect(daySettle!.estimated_usd).toBe(0.5) // 冲销额=预留额
    expect(daySettle!.actual_usd).toBe(COST_1000_50) // 日实际合计
    expect(rows.filter((r) => r.scope_id === `mj-day:s:${day2}` && r.kind === 'reserve')).toHaveLength(1)
    ledger.close()
  })
})

// ————————————————————————— dshJudgeAdapterFactory ——————————————————

describe('dshJudgeAdapterFactory（v1 冻结面=dsh 家）', () => {
  const dirs = createJudgeCallDirs({ parent: root })
  afterAll(() => dirs.cleanup())

  function expectConfigInvalid(fn: () => unknown, subcause: string): void {
    expect(() => fn()).toThrowError(expect.objectContaining({ subcause, category: 'CONFIG_INVALID' }))
  }

  it('非 judge 名→judge/not-judge-slot；非 dsh 家→judge/family-unsupported', () => {
    expectConfigInvalid(() => dshJudgeAdapterFactory({ name: 'dsh' }), 'judge/not-judge-slot')
    expectConfigInvalid(() => dshJudgeAdapterFactory({ name: 'claude-judge' }), 'judge/family-unsupported')
    expectConfigInvalid(() => dshJudgeAdapterFactory({ name: 'kimi-judge' }), 'judge/family-unsupported')
  })

  it('dsh-judge→工厂出 DshAdapter（一次性 per-dirs 构造：seatbelt 选项构造期固定——judge 档）', () => {
    const factory = dshJudgeAdapterFactory({ name: 'dsh-judge' })
    const a1 = factory(dirs)
    const a2 = factory(dirs)
    expect(a1).toBeInstanceOf(DshAdapter)
    expect(a2).not.toBe(a1) // 每次调用新实例（不跨调用共享状态——判断零生命周期）
  })
})
