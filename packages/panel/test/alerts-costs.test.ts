/**
 * :8787 监控面全量口径测试（v0.3 补齐刀）：断路器告警卡 / 成本趋势卡 / 事件流增强。
 *
 * 依据：docs/17-§8（:8787 全量口径——断路器与漂移告警/成本趋势，全部读 SQLite）、
 * docs/17-§6 末（断路语义：同(单号,错误签名)连击→熔断）、docs/26 C1（LLM 岛成本与
 * 收割成本双口径分列、禁止相加）、store queryEvents order:'desc' 读面。
 *
 * 语料纪律：
 *   - 窗口端点（/api/breakers、/api/costs）以**真实时钟**为 now（server 不收 now 注入），
 *     ts 全部锚定 Date.now()/UTC 日界相对值（与 panel.test.ts 的 due 判据同手法）；
 *     断言按「日键定位桶」而非数组下标——测试全程跨 UTC 午夜也不漂。
 *   - 入账序 ≠ ts 序（appendEvent 不要求单调；queryEvents 按 ts 排序返回）——凡涉序
 *     断言一律以另一端点读回为基准，不拿入账序当期望序。
 *   - 金额全用二进可精确表示的 dyadic 值（0.25/0.5/1.25…），求和对账走 toBe 级精确断言。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import type { CompanySnapshot, EventRecord } from '@studio-next/contract'
import { createPanelApp } from '../src/index.ts'
import {
  DAY_MS,
  aggregateBreakers,
  buildBreakerSnapshot,
  buildCostsSnapshot,
  dayKeyOf,
  dayStartOf,
  isBreakerEvent,
  parseBreakerNote,
} from '../src/views.ts'
import { makeUlid } from './corpus.ts'

const HOUR = 3_600_000
const MIN = 60_000

// —— 断路 note 工厂（daemon engine.ts 现行 emit 语句逐字同形） ——

function breakerNote(issue: string, streak: number, threshold: number, signature: string, bug: string): string {
  return `CIRCUIT_BREAK：${issue} 连击 ${streak} 达阈值 ${threshold}（签名 ${signature}）→ 自动开 bug 单 ${bug}`
}

/** 事件工厂（ts 显式给；缺省事件名 ESCALATE 只为少打字，patch 覆盖） */
let evSeq = 0
function ev(patch: Record<string, unknown>): Record<string, unknown> {
  evSeq += 1
  const ts = patch.ts === undefined ? 1770000000000 + evSeq * 1000 : (patch.ts as number)
  return {
    id: makeUlid(ts),
    ts,
    company: 'demo',
    issue: 'BRK-1',
    event: 'ESCALATE',
    actor: 'P1/bot',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 10 },
    ...patch,
  }
}

/** work_record 工厂（缺 ended_at = 在途） */
function run(patch: Record<string, unknown>): Record<string, unknown> {
  return {
    id: `acr-${String(++evSeq)}`,
    issue: 'DEMO-C',
    person_id: 'P9',
    executor: 'dsh',
    started_at: 1770000000000,
    attempt: 1,
    status: 'done',
    ...patch,
  }
}

/** ticket 镜像工厂（常规语料：镜像行与预算行并存的常态形态） */
function mirror(issue: string, ts: number): Record<string, unknown> {
  return { issue, company: 'demo', created: ts, updated: ts, state: 'Opened', type: 'task', dept: 'departments/工程部', level: 3, dispatcher: 'P1' }
}

/** 最小公司快照（people/departments 镜像——与预算行并存的常规语料；budgets 读已切 listBudgets 全量面，镜像不再是可见性前提） */
function snapshot(slug = 'demo'): CompanySnapshot {
  return {
    slug,
    name: '演示公司',
    level: 5,
    charter: 'charter.md',
    platform: { platform: 'youtrack' },
    departments: [
      {
        name: '工程部',
        path: 'departments/工程部',
        parent: null,
        leader: 'AGENT-1',
        level: 3,
        lanes: [],
        functions: ['交付'],
        relations: [],
      },
    ],
    people: [{ id: 'AGENT-9', name: '成本岗', login: 'agent-9', level: 2, dept: 'departments/工程部' }],
    jobs: [],
  }
}

// —— 语料锚点：真实时钟 + UTC 日界（窗口端点的 now 在 server 内取 Date.now()） ——

let root = ''
let ledger: Ledger

/** 种子入账数与种子日键（跨午夜不变性：断言按日键找桶） */
let seededCount = 0
let seedTodayKey = ''
let seedYdayKey = ''
let seedEmptyKey = ''
let seedNow = 0

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-panel-ac-'))
  ledger = openLedger(path.join(root, 'ac.db'))

  const now = Date.now()
  seedNow = now
  const today = dayStartOf(now)
  const yday = today - DAY_MS
  seedTodayKey = dayKeyOf(now)
  seedYdayKey = dayKeyOf(now - DAY_MS)
  seedEmptyKey = dayKeyOf(now - 2 * DAY_MS) // 该日零种子（空桶断言用）

  // 镜像语料（issue←镜像 / person+company←公司快照）：常规形态；budgets 读走
  // listBudgets 全量面，镜像不再是读取前提（无镜像行可见性由下方 NO-MIRROR 断言锁定）
  ledger.syncCompany(snapshot())
  ledger.upsertTicketMirror(mirror('BRK-C', yday))

  // —— 事件（ts 全相异；入账序不保证 ts 序——查询面自会排序） ——
  const seeds: Array<Record<string, unknown>> = [
    // 断路：窗外老单（8 天前——days=7 剔除）
    ev({ issue: 'BRK-OLD', ts: now - 8 * DAY_MS, note: breakerNote('BRK-OLD', 3, 3, 'LLM_FAIL/timeout', 'BRK-BUG-9') }),
    // 断路：BRK-3（约 2 天又 1 小时前——days=1/2 窗外、days>=3 窗内）
    ev({ issue: 'BRK-3', ts: now - 2 * DAY_MS - HOUR, note: breakerNote('BRK-3', 3, 3, 'GATE_FAIL/验收红', 'BRK-BUG-3') }),
    // LLM（昨日桶）
    ev({ event: 'LLM', issue: 'DEMO-C', ts: yday + 2 * HOUR, cost_usd: 1.25 }),
    // 断路：BRK-1 换签名（WORKER_DEAD——与 LLM_FAIL 同单不同签名=两组）
    ev({ ts: now - 2 * HOUR, note: breakerNote('BRK-1', 3, 3, 'WORKER_DEAD/wall', 'BRK-BUG-3') }),
    // 断路：裸 CIRCUIT_BREAK（无 note——签名/连击不可解析）
    ev({ event: 'CIRCUIT_BREAK', issue: 'BRK-2', ts: now - 90 * MIN }),
    // LLM（今日桶）：两笔有成本 + 一笔零成本（有 usage 零成本——计条不计钱）
    ev({ event: 'LLM', issue: 'DEMO-C', ts: today + HOUR, cost_usd: 0.25 }),
    ev({ event: 'LLM', issue: 'DEMO-C', ts: today + 2 * HOUR, cost_usd: 0.5 }),
    ev({ event: 'LLM', issue: 'DEMO-C', ts: today + 3 * HOUR, tokens: { input: 0 } }),
    // 非 LLM 事件带 cost_usd（不得混入 LLM 岛口径）
    ev({ event: 'REPORT_DAILY', issue: 'DEMO-C', ts: today + 4 * HOUR, tokens: { input: 0 }, cost_usd: 0.75, note: '日报' }),
    // 断路：BRK-1 同签名两次（1 小时/30 分钟前——trips=2，取后者 streak=4）
    ev({ ts: now - 1 * HOUR, note: breakerNote('BRK-1', 3, 3, 'LLM_FAIL/timeout', 'BRK-BUG-1') }),
    ev({ ts: now - 30 * MIN, note: breakerNote('BRK-1', 4, 3, 'LLM_FAIL/timeout', 'BRK-BUG-1') }),
    // 前缀族事件（event= 过滤维的合法名佐证）
    ev({ event: 'GW_COMMENT', issue: 'DEMO-C', ts: today + 30 * MIN, note: '网关动作' }),
  ]
  seededCount = seeds.length
  for (const e of seeds) ledger.appendEvent(e)

  // —— work_records（收割口径：ended 日归桶；在途不计） ——
  ledger.insertWorkRecord(run({ id: 'acr-old', started_at: today - 8 * DAY_MS + HOUR, ended_at: today - 8 * DAY_MS + 2 * HOUR, cost_usd: 7.0 })) // 窗外
  ledger.insertWorkRecord(run({ id: 'acr-y', started_at: yday + 4 * HOUR, ended_at: yday + 5 * HOUR, cost_usd: 1.5 }))
  ledger.insertWorkRecord(run({ id: 'acr-t', started_at: today + 4 * HOUR, ended_at: today + 5 * HOUR, cost_usd: 2.5 }))
  ledger.insertWorkRecord(run({ id: 'acr-fly', started_at: today + 5 * HOUR, cost_usd: 9.75 })) // 在途：未收口不计

  // —— budgets（三类三 scope；dyadic 值精确对账） ——
  ledger.appendBudget({ id: 'bud-r1', scope_kind: 'issue', scope_id: 'BRK-C', kind: 'reserve', estimated_usd: 2.0, ts: today + HOUR })
  ledger.appendBudget({ id: 'bud-s1', scope_kind: 'issue', scope_id: 'BRK-C', kind: 'settle', estimated_usd: 2.0, actual_usd: 1.25, ts: today + 90 * MIN })
  ledger.appendBudget({ id: 'bud-s2', scope_kind: 'issue', scope_id: 'BRK-C', kind: 'settle', estimated_usd: 3.0, ts: today + 2 * HOUR }) // 无 actual：结算计 0（如实不折算）
  ledger.appendBudget({ id: 'bud-x1', scope_kind: 'issue', scope_id: 'BRK-C', kind: 'refusal', estimated_usd: 0.75, ts: yday + 3 * HOUR })
  ledger.appendBudget({ id: 'bud-r2', scope_kind: 'person', scope_id: 'AGENT-9', kind: 'reserve', estimated_usd: 0.5, ts: today + 3 * HOUR })
  ledger.appendBudget({ id: 'bud-r3', scope_kind: 'company', scope_id: 'demo', kind: 'reserve', estimated_usd: 4.0, ts: today + 4 * HOUR })
  ledger.appendBudget({ id: 'bud-r4', scope_kind: 'issue', scope_id: 'NO-MIRROR-1', kind: 'reserve', estimated_usd: 8.0, ts: today + 5 * HOUR }) // 无镜像 scope：listBudgets 全量读面下可见（锁定见下）
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

const app = createPanelApp({ openLedger: () => ledger })

/** /api/costs 响应体形状（按日键取桶的断言辅助） */
interface CostsBody {
  days: number
  note: string
  since: number
  series: Array<{
    date: string
    llm_cost_usd: number
    llm_events: number
    harvest_cost_usd: number
    harvest_runs: number
    reserve_usd: number
    settle_usd: number
    refusal_usd: number
    net_usd: number
  }>
  totals: { llm_cost_usd: number; llm_events: number; harvest_cost_usd: number; harvest_runs: number; reserve_usd: number; settle_usd: number; refusal_usd: number; net_usd: number }
}

async function costs(days?: string): Promise<CostsBody> {
  const res = await app.request(days === undefined ? '/api/costs' : `/api/costs?days=${days}`)
  expect(res.status).toBe(200)
  return (await res.json()) as CostsBody
}

// —— /api/breakers（断路器告警卡） ——

describe('GET /api/breakers', () => {
  it('默认 7 天窗：按 (issue,签名) 聚合——同签名两次=trips 2 取最近 note 要素；同单异签名=两组；裸 CIRCUIT_BREAK 签名不可解析=null；窗外老单剔除', async () => {
    const res = await app.request('/api/breakers')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      basis: string
      note: string
      days: number
      since: number
      count: number
      breakers: Array<{
        issue: string
        signature: string | null
        trips: number
        lastTs: number
        streak: number | null
        threshold: number | null
        bug: string | null
      }>
    }
    expect(body.basis).toBe('events-v0')
    expect(body.note).toContain('CIRCUIT_BREAK')
    expect(body.days).toBe(7)
    expect(body.count).toBe(body.breakers.length)
    expect(body.breakers.map((b) => [b.issue, b.signature])).toEqual([
      ['BRK-1', 'LLM_FAIL/timeout'], // 最近触发（now-30min）
      ['BRK-2', null], // 裸 CIRCUIT_BREAK（now-90min）
      ['BRK-1', 'WORKER_DEAD/wall'], // 同单异签名（now-2h）
      ['BRK-3', 'GATE_FAIL/验收红'], // 约 2 天前（7 天窗内）
    ])
    const head = body.breakers[0]
    expect(head).toMatchObject({ trips: 2, streak: 4, threshold: 3, bug: 'BRK-BUG-1' })
    expect(head?.lastTs).toBeGreaterThan(seedNow - HOUR)
    expect(body.breakers[1]).toMatchObject({ trips: 1, streak: null, threshold: null, bug: null })
    expect(body.breakers.every((b) => b.issue !== 'BRK-OLD')).toBe(true) // 8 天前：窗外剔除
  })

  it('?days= 窗口可配与夹取：days=1 剔 2 天前单；days=3 含之；非正数/非数落缺省 7；超限夹 90', async () => {
    const d1 = (await (await app.request('/api/breakers?days=1')).json()) as { days: number; count: number; breakers: Array<{ issue: string }> }
    expect(d1.days).toBe(1)
    expect(d1.breakers.map((b) => b.issue)).toEqual(['BRK-1', 'BRK-2', 'BRK-1']) // BRK-3（约 2 天前）窗外
    const d3 = (await (await app.request('/api/breakers?days=3')).json()) as { count: number }
    expect(d3.count).toBe(4)
    const bad = (await (await app.request('/api/breakers?days=abc')).json()) as { days: number }
    expect(bad.days).toBe(7)
    const zero = (await (await app.request('/api/breakers?days=0')).json()) as { days: number }
    expect(zero.days).toBe(7)
    const big = (await (await app.request('/api/breakers?days=99999')).json()) as { days: number }
    expect(big.days).toBe(90)
  })
})

// —— /api/costs（成本趋势卡：docs/26 C1 分列口径） ——

describe('GET /api/costs', () => {
  it('默认 7 天窗对账：今日桶 LLM 岛 0.75（3 条）/收割 2.5（1 单）/reserve 14.5/settle 1.25/净额 13.25；昨日桶 LLM 1.25/收割 1.5/refusal 0.75；空日零填充；totals 与手插数据一致', async () => {
    const body = await costs()
    expect(body.days).toBe(7)
    expect(body.note).toContain('分列')
    expect(body.note).toContain('不相加')
    expect(body.series.length).toBe(7)
    // 按种子日键定位桶（跨 UTC 午夜跑测试也不漂）
    const today = body.series.find((p) => p.date === seedTodayKey)
    const yday = body.series.find((p) => p.date === seedYdayKey)
    const empty = body.series.find((p) => p.date === seedEmptyKey)
    expect(today).toBeDefined()
    expect(yday).toBeDefined()
    expect(empty).toBeDefined()

    expect(today).toMatchObject({
      llm_cost_usd: 0.75, // 0.25+0.5；零成本 LLM 条计条不计钱
      llm_events: 3,
      harvest_cost_usd: 2.5,
      harvest_runs: 1,
      reserve_usd: 14.5, // 2.0(issue)+0.5(person)+4.0(company)+8.0(无镜像 issue——listBudgets 全量读面可见)
      settle_usd: 1.25, // 仅 actual；无 actual 的 settle 计 0
      refusal_usd: 0,
      net_usd: 13.25,
    })
    expect(yday).toMatchObject({ llm_cost_usd: 1.25, llm_events: 1, harvest_cost_usd: 1.5, harvest_runs: 1, refusal_usd: 0.75, net_usd: 0 })
    expect(empty).toMatchObject({
      llm_cost_usd: 0,
      llm_events: 0,
      harvest_cost_usd: 0,
      harvest_runs: 0,
      reserve_usd: 0,
      settle_usd: 0,
      refusal_usd: 0,
      net_usd: 0,
    })
    expect(body.totals).toEqual({
      llm_cost_usd: 2.0,
      llm_events: 4,
      harvest_cost_usd: 4.0,
      harvest_runs: 2,
      reserve_usd: 14.5,
      settle_usd: 1.25,
      refusal_usd: 0.75,
      net_usd: 13.25,
    })
  })

  it('口径排除项锁定：非 LLM 事件的 cost_usd 不入 LLM 岛口径；在途 run 不计收割；窗外老 run 不计；无镜像 scope 的预算经 listBudgets 全量读面可见（COSTS_BUDGETS_BASIS_NOTE）', async () => {
    const body = await costs()
    // REPORT_DAILY 带 cost_usd 0.75 但非 LLM——不计（若误计应为 2.75）
    expect(body.totals.llm_cost_usd).toBe(2.0)
    // 在途 9.75 与窗外 7.0 不计（若误计应为 20.75）
    expect(body.totals.harvest_cost_usd).toBe(4.0)
    // NO-MIRROR-1 无镜像仍有 reserve 8.0：全量读面（listBudgets）下 6.5+8.0=14.5
    // ——镜像枚举近似时代「无镜像不可见」的缺口已消（views.COSTS_BUDGETS_BASIS_NOTE）
    expect(body.totals.reserve_usd).toBe(14.5)
  })

  it('?days= 可配：days=2 恰两桶且末桶=今天（UTC）；days=99999 夹 90 桶；days=abc 落缺省 7', async () => {
    const d2 = await costs('2')
    expect(d2.series.length).toBe(2)
    expect(d2.series[1]?.date).toBe(dayKeyOf(Date.now())) // 末桶恒为请求时刻所在 UTC 日
    expect(d2.series[0]?.date).toBe(dayKeyOf(Date.now() - DAY_MS))
    const big = await costs('99999')
    expect(big.days).toBe(90)
    expect(big.series.length).toBe(90)
    const bad = await costs('abc')
    expect(bad.days).toBe(7)
    expect(bad.series.length).toBe(7)
  })
})

// —— /api/events 增强（order=desc 透传 + event= 过滤维） ——

describe('GET /api/events 增强（order/event 维）', () => {
  it('?order=desc = 升序全量的镜像反序（store desc 读面透传）', async () => {
    const asc = (await (await app.request('/api/events')).json()) as { events: Array<{ id: string }> }
    const desc = (await (await app.request('/api/events?order=desc')).json()) as { events: Array<{ id: string }> }
    expect(desc.events.map((e) => e.id)).toEqual([...asc.events.map((e) => e.id)].reverse())
  })

  it('?order=desc&limit=2 取最近两条（desc+limit=「最近 N 条」组合语义；期望序取自升序读回非入账序）', async () => {
    const asc = (await (await app.request('/api/events')).json()) as { events: Array<{ id: string }> }
    const body = (await (await app.request('/api/events?order=desc&limit=2')).json()) as { count: number; events: Array<{ id: string }> }
    expect(body.count).toBe(2)
    expect(body.events.map((e) => e.id)).toEqual([...asc.events.map((e) => e.id)].reverse().slice(0, 2))
  })

  it('?event= 过滤维：CIRCUIT_BREAK 只剩裸事件一条；event=LLM&order=desc&limit=2 = 最近两条 LLM（过滤后截断，非截断后过滤）', async () => {
    const cb = (await (await app.request('/api/events?event=CIRCUIT_BREAK')).json()) as {
      count: number
      events: Array<{ event: string; issue: string; note?: string }>
    }
    expect(cb.count).toBe(1)
    expect(cb.events[0]).toMatchObject({ event: 'CIRCUIT_BREAK', issue: 'BRK-2' })

    const llm = (await (await app.request('/api/events?event=LLM&order=desc&limit=2')).json()) as {
      count: number
      events: Array<{ event: string; cost_usd?: number }>
    }
    expect(llm.count).toBe(2)
    expect(llm.events.every((e) => e.event === 'LLM')).toBe(true)
    // 最近两条 LLM = 零成本条(3H) 与 0.5 条(2H)——若「截断后过滤」会拿错条数（LLM 共 4 条）
    expect(llm.events.map((e) => e.cost_usd ?? 0)).toEqual([0, 0.5])
  })

  it('event 维与 company/issue 维可组合；前缀族名合法；坏事件名/坏 order = 400', async () => {
    const combo = (await (await app.request('/api/events?company=demo&issue=DEMO-C&event=LLM&order=desc')).json()) as {
      count: number
      events: Array<{ event: string; issue: string }>
    }
    expect(combo.count).toBe(4)
    expect(combo.events.every((e) => e.event === 'LLM' && e.issue === 'DEMO-C')).toBe(true)

    const gw = (await (await app.request('/api/events?event=GW_COMMENT')).json()) as { count: number }
    expect(gw.count).toBe(1)

    const badEvent = await app.request('/api/events?event=NOPE_EVENT')
    expect(badEvent.status).toBe(400)
    const badEventBody = (await badEvent.json()) as { ok: boolean; error: string }
    expect(badEventBody.ok).toBe(false)
    expect(badEventBody.error).toContain('NOPE_EVENT')

    const badOrder = await app.request('/api/events?order=DiSc')
    expect(badOrder.status).toBe(400)
  })

  it('缺省无 order 仍升序、无 limit 仍全量（首刀语义不回退）', async () => {
    const body = (await (await app.request('/api/events')).json()) as { count: number; events: Array<{ id: string; ts: number }> }
    expect(body.count).toBe(seededCount)
    expect(new Set(body.events.map((e) => e.id)).size).toBe(seededCount)
    const tsList = body.events.map((e) => e.ts)
    expect([...tsList].sort((a, b) => a - b)).toEqual(tsList)
  })
})

// —— HTML 单页：两新卡接线 ——

describe('GET /legacy（旧版单页：断路器/成本新卡——换装刀一后旧页迁 /legacy）', () => {
  it('含断路器卡与成本卡区块、红点样式、初始倒序 50 条拉取、分列不相加口径文案', async () => {
    const res = await app.request('/legacy')
    expect(res.status).toBe(200)
    const html = await res.text()
    for (const marker of [
      '断路器告警',
      'id="breakers-list"',
      '成本趋势',
      'id="costs-body"',
      'class="dot"',
      '/api/breakers?days=7',
      '/api/costs?days=7',
      '/api/events?order=desc&limit=50',
      '分列不相加',
      'renderBreakers',
      'renderCosts',
    ]) {
      expect(html).toContain(marker)
    }
  })
})

// —— 纯函数层（零 IO 直测；build* 用第二个 tmp 库配固定 now 锚定 UTC 日界） ——

/** 直测用最小合法事件行（EventRecord 形状；id 走 makeUlid 保 ULID 合法） */
function row(patch: Partial<EventRecord>): EventRecord {
  const ts = patch.ts ?? 1770000000000
  return {
    id: patch.id ?? makeUlid(ts),
    ts,
    company: 'demo',
    issue: 'X-1',
    event: 'ESCALATE',
    actor: 'P1/bot',
    attempt: 1,
    level: 3,
    dept: 'departments/工程部',
    tokens: { input: 1 },
    ...patch,
  }
}

describe('parseBreakerNote / isBreakerEvent', () => {
  it('daemon 形态 note 四要素全解析；畸形/缺失 → null（不臆造）', () => {
    expect(parseBreakerNote(breakerNote('STUDIO-1', 3, 3, 'LLM_FAIL/timeout', 'STUDIO-BUG-1'))).toEqual({
      streak: 3,
      threshold: 3,
      signature: 'LLM_FAIL/timeout',
      bug: 'STUDIO-BUG-1',
    })
    expect(parseBreakerNote('CIRCUIT_BREAK：格式不对的 note')).toBeNull()
    expect(parseBreakerNote(undefined)).toBeNull()
  })

  it('双通道匹配：裸 CIRCUIT_BREAK 命中；ESCALATE 带 CIRCUIT_BREAK： 前缀命中；普通 ESCALATE 不命中', () => {
    expect(isBreakerEvent(row({ event: 'CIRCUIT_BREAK' }))).toBe(true)
    expect(isBreakerEvent(row({ event: 'ESCALATE', note: breakerNote('X-1', 3, 3, 's', 'b') }))).toBe(true)
    expect(isBreakerEvent(row({ event: 'ESCALATE', note: '普通升级' }))).toBe(false)
    expect(isBreakerEvent(row({ event: 'ESCALATE' }))).toBe(false)
    expect(isBreakerEvent(row({ event: 'STALL' }))).toBe(false)
  })
})

describe('aggregateBreakers（多单多签名聚合）', () => {
  it('按 (issue,签名) 分组、trips 累计、lastTs 降序（同刻按 issue 稳定序）、非断路事件不计', () => {
    const events = [
      row({ issue: 'A-1', event: 'CIRCUIT_BREAK', ts: 5000 }),
      row({ issue: 'A-2', event: 'ESCALATE', ts: 9000, note: breakerNote('A-2', 3, 3, 'sig-x', 'B-2') }),
      row({ issue: 'A-1', event: 'CIRCUIT_BREAK', ts: 8000 }),
      row({ issue: 'A-2', event: 'ESCALATE', ts: 3000, note: breakerNote('A-2', 2, 3, 'sig-y', 'B-3') }),
      row({ issue: 'A-3', event: 'ESCALATE', ts: 7000, note: '普通升级——不计' }),
      row({ issue: 'A-1', event: 'STALL', ts: 9500 }),
    ]
    const out = aggregateBreakers(events)
    expect(out.map((b) => [b.issue, b.signature, b.trips])).toEqual([
      ['A-2', 'sig-x', 1], // lastTs 9000
      ['A-1', null, 2], // 两次裸事件同组；lastTs 8000
      ['A-2', 'sig-y', 1], // 3000
    ])
    expect(out[0]).toMatchObject({ streak: 3, threshold: 3, bug: 'B-2' })
    expect(out[1]).toMatchObject({ streak: null, bug: null })
  })

  it('同刻多组按 issue 升序稳定（输出确定性）', () => {
    const sameTs = 7000
    const out = aggregateBreakers([
      row({ issue: 'Z-9', event: 'CIRCUIT_BREAK', ts: sameTs }),
      row({ issue: 'A-1', event: 'CIRCUIT_BREAK', ts: sameTs }),
    ])
    expect(out.map((b) => b.issue)).toEqual(['A-1', 'Z-9'])
  })
})

describe('dayStartOf / dayKeyOf（UTC 日切）', () => {
  it('UTC 日界纯算术：当日任意时刻归当日 00:00Z；日键 YYYY-MM-DD；跨日边界邻接', () => {
    const t = Date.UTC(2026, 2, 10, 23, 59, 59, 999) // 2026-03-10T23:59:59.999Z
    expect(dayStartOf(t)).toBe(Date.UTC(2026, 2, 10))
    expect(dayKeyOf(t)).toBe('2026-03-10')
    expect(dayStartOf(t + 1)).toBe(Date.UTC(2026, 2, 11)) // +1ms 跨日
    expect(dayKeyOf(t + 1)).toBe('2026-03-11')
    expect(dayStartOf(Date.UTC(2026, 2, 10))).toBe(Date.UTC(2026, 2, 10)) // 恰午夜归自身
  })
})

describe('buildBreakerSnapshot / buildCostsSnapshot（固定 now 直测）', () => {
  let fixed: Ledger
  let fixedRoot = ''
  /** 固定锚：2026-03-10T12:00:00Z（窗口计算与真实时钟完全解耦） */
  const FIXED_NOW = Date.UTC(2026, 2, 10, 12)

  beforeAll(async () => {
    fixedRoot = await mkdtemp(path.join(tmpdir(), 'studio-next-panel-fixed-'))
    fixed = openLedger(path.join(fixedRoot, 'fixed.db'))
    const DAY10 = Date.UTC(2026, 2, 10)
    const DAY9 = DAY10 - DAY_MS
    const DAY8 = DAY10 - 2 * DAY_MS
    const DAY7 = DAY10 - 3 * DAY_MS

    // 公司镜像语料（快照 slug=nope ↔ 预算 scope_id=nope；listBudgets 全量面下镜像与否不影响可见性）
    fixed.syncCompany(snapshot('nope'))

    // 断路：窗外（7 天前）、界上（恰 since，闭端应含）、窗内各一
    fixed.appendEvent(ev({ issue: 'F-OLD', ts: FIXED_NOW - 7 * DAY_MS - HOUR, note: breakerNote('F-OLD', 3, 3, 's-old', 'F-BUG-0') }))
    fixed.appendEvent(ev({ issue: 'F-EDGE', ts: FIXED_NOW - 3 * DAY_MS, note: breakerNote('F-EDGE', 3, 3, 's-edge', 'F-BUG-9') })) // days=3 恰 since
    fixed.appendEvent(ev({ issue: 'F-IN', ts: FIXED_NOW - HOUR, note: breakerNote('F-IN', 5, 3, 's-in', 'F-BUG-1') }))

    // 成本：三桶各一笔 LLM + 窗外一笔；budgets 净额两桶
    fixed.appendEvent(ev({ event: 'LLM', issue: 'F-1', ts: DAY8 + HOUR, cost_usd: 0.125 }))
    fixed.appendEvent(ev({ event: 'LLM', issue: 'F-1', ts: DAY9 + HOUR, cost_usd: 0.25 }))
    fixed.appendEvent(ev({ event: 'LLM', issue: 'F-1', ts: DAY10 + HOUR, cost_usd: 0.5 }))
    fixed.appendEvent(ev({ event: 'LLM', issue: 'F-1', ts: DAY7 + HOUR, cost_usd: 8.0 })) // days=3 窗外
    fixed.appendBudget({ id: 'fb-1', scope_kind: 'company', scope_id: 'nope', kind: 'reserve', estimated_usd: 1.0, ts: DAY9 + 2 * HOUR })
    fixed.appendBudget({ id: 'fb-2', scope_kind: 'company', scope_id: 'nope', kind: 'settle', estimated_usd: 1.0, actual_usd: 0.75, ts: DAY10 + 2 * HOUR })
  })

  afterAll(async () => {
    fixed.close()
    await rm(fixedRoot, { recursive: true, force: true })
  })

  it('buildBreakerSnapshot：days=3 窗含界（恰 since 事件在内）、7 天前单在外、since/days/basis 回显', () => {
    const snap = buildBreakerSnapshot(fixed, { now: FIXED_NOW, days: 3 })
    expect(snap.basis).toBe('events-v0')
    expect(snap.days).toBe(3)
    expect(snap.since).toBe(FIXED_NOW - 3 * DAY_MS)
    expect(snap.breakers.map((b) => b.issue)).toEqual(['F-IN', 'F-EDGE'])
    expect(snap.breakers[1]).toMatchObject({ signature: 's-edge', streak: 3 })
  })

  it('buildCostsSnapshot：恰 N 桶升序零填充、窗外 LLM 不计、净额=reserve−settle 且 refusal 不入净额、LLM 与 budgets 双序列独立各自对账', () => {
    const snap = buildCostsSnapshot(fixed, { now: FIXED_NOW, days: 3 })
    expect(snap.series.map((p) => p.date)).toEqual(['2026-03-08', '2026-03-09', '2026-03-10'])
    expect(snap.series.map((p) => p.llm_cost_usd)).toEqual([0.125, 0.25, 0.5]) // 窗外 8.0 不计
    expect(snap.series.map((p) => p.net_usd)).toEqual([0, 1.0, -0.75])
    expect(snap.totals.llm_cost_usd).toBe(0.875)
    expect(snap.totals.reserve_usd).toBe(1.0)
    expect(snap.totals.settle_usd).toBe(0.75)
    expect(snap.totals.net_usd).toBe(0.25)
    expect(snap.note).toContain('docs/26')
  })
})
