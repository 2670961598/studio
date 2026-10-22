/**
 * :8791 判断调用读面测试（studio-dev-160 §6.5 面板读面 · 单D studio-dev-180）：
 *   - /api/judge 端面形状（basis/note/days/since/sites/totals/openBreakers）
 *   - 按址统计四要件列：调用量（ok+fallbacks）/费用（Σ cost_usd 含降级携带实费）/
 *     降级率/熔断态（全量史重放——与 core judge-gates 值语义的逐例对齐由
 *     apps/daemon/test/panel-judge-align.test.ts 钉住，跨包边：panel→core 非法）
 *   - 熔断重放语义：同因连击 3 开/成功清零/换因归 1/跨日签名复位/site-open 不破开态/
 *     日界差自动闭合（openSinceDay≠当日键）
 *   - company 过滤 / days 夹取 / 窗口外不入统计但参与折叠 / 坏 note 计 unknown 桶
 *   - buildJudgeSnapshot 纯函数面（avgDurationMs 空计时=null、byReason 稳定全序）
 *
 * note 格式语料=apps/daemon/src/engine/judge/events.ts 冻结格式（round-trip 对齐归
 * panel-judge-align.test.ts——本文件只测面板面）。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openLedger, type Ledger } from '@studio-next/store'
import type { EventRecord } from '@studio-next/contract'
import {
  DEFAULT_JUDGE_DAYS,
  JUDGE_REASON_UNKNOWN,
  buildJudgeSnapshot,
  parseFallbackReason,
  replayJudgeBreakers,
} from '../src/judge.ts'
import { createPanelApp } from '../src/index.ts'
import { dayKeyOf } from '../src/views.ts'

// —— 测试用 ULID（daemon 单写入者纪律下 panel 测试自造确定性 id；Crockford Base32） ——

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
let ulidSeq = 0
function ulid(ts: number): string {
  let time = ts
  let timePart = ''
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[time % 32] + timePart
    time = Math.floor(time / 32)
  }
  let randPart = ''
  let rand = ++ulidSeq
  while (rand > 0) {
    randPart = CROCKFORD[rand % 32] + randPart
    rand = Math.floor(rand / 32)
  }
  return timePart + randPart.padStart(16, '0')
}

/** 判断事件（列集最小真值：tokens 非空四桶——零用量约定 {input:0}） */
function judgeEvent(
  over: Partial<EventRecord> & { ts: number; event: 'JUDGE_OK' | 'JUDGE_FALLBACK'; issue: string },
): EventRecord {
  return {
    id: ulid(over.ts),
    ts: over.ts,
    company: 'demo',
    event: over.event,
    issue: over.issue,
    actor: 'daemon:micro-judge',
    attempt: 1,
    level: 1,
    dept: 'framework',
    tokens: { input: 0, output: 0 },
    note: over.event === 'JUDGE_OK' ? `site=${over.issue} op=pick vocab=ab12cd34 degraded=no` : `site=${over.issue} reason=timeout`,
    ...over,
  } as EventRecord
}

const DAY = 86_400_000
/** 快照时刻锚真实时钟（模块装载点）：端面 now 不可注入，合成钟会随日历漂移翻出窗口——
 * 「当日」事件取 NOW−秒级偏移（真实日中概率压倒性；UTC 子夜邻域理论可抖动，可接受） */
const NOW = Date.now()
const okNote = (site: string) => `site=${site} op=pick vocab=ab12cd34 degraded=no`
const fbNote = (site: string, reason: string) => `site=${site} reason=${reason}`

let root = ''
let ledger: Ledger

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-judge-'))
  ledger = openLedger(path.join(root, 'judge.db'))
  const events: EventRecord[] = [
    // —— site A（mj-x-pick）：混合面——ok×2 + fallback×1（费用含降级携带实费；均时含未唤起型）——
    judgeEvent({ ts: NOW - 3 * DAY + 1_000, event: 'JUDGE_OK', issue: 'mj-x-pick', cost_usd: 0.0014, duration_ms: 1200, note: okNote('mj-x-pick'), tokens: { input: 4000, output: 128 } }),
    judgeEvent({ ts: NOW - 3 * DAY + 2_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-pick', cost_usd: 0.0009, duration_ms: 10_000, note: fbNote('mj-x-pick', 'timeout'), tokens: { input: 1200, output: 60 } }),
    judgeEvent({ ts: NOW - 3 * DAY + 3_000, event: 'JUDGE_OK', issue: 'mj-x-pick', cost_usd: 0.0011, duration_ms: 900, note: okNote('mj-x-pick'), tokens: { input: 3800, output: 96 } }),
    // —— site B（mj-x-interrupt）：当日同因（bad-json）连击 3 → 熔断开；再一记 site-open（开态保持）——
    judgeEvent({ ts: NOW - 9_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-interrupt', note: fbNote('mj-x-interrupt', 'bad-json') }),
    judgeEvent({ ts: NOW - 8_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-interrupt', note: fbNote('mj-x-interrupt', 'bad-json') }),
    judgeEvent({ ts: NOW - 7_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-interrupt', note: fbNote('mj-x-interrupt', 'bad-json') }),
    judgeEvent({ ts: NOW - 6_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-interrupt', note: fbNote('mj-x-interrupt', 'site-open') }),
    // —— site C（mj-x-relay）：fb,fb,ok,fb（同日）——成功清零后 streak=1 不开——
    judgeEvent({ ts: NOW - 2_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-relay', note: fbNote('mj-x-relay', 'op-not-in-vocab') }),
    judgeEvent({ ts: NOW - 1_900, event: 'JUDGE_FALLBACK', issue: 'mj-x-relay', note: fbNote('mj-x-relay', 'op-not-in-vocab') }),
    judgeEvent({ ts: NOW - 1_800, event: 'JUDGE_OK', issue: 'mj-x-relay', cost_usd: 0.0002, note: okNote('mj-x-relay') }),
    judgeEvent({ ts: NOW - 1_700, event: 'JUDGE_FALLBACK', issue: 'mj-x-relay', note: fbNote('mj-x-relay', 'over-spend'), cost_usd: 0.02 }),
    // —— site D（mj-x-crossday）：前日同因×2 + 当日×1 ——跨日签名复位，streak=1 不开——
    judgeEvent({ ts: NOW - 2 * DAY + 5_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-crossday', note: fbNote('mj-x-crossday', 'refusal') }),
    judgeEvent({ ts: NOW - 2 * DAY + 6_000, event: 'JUDGE_FALLBACK', issue: 'mj-x-crossday', note: fbNote('mj-x-crossday', 'refusal') }),
    judgeEvent({ ts: NOW - 500, event: 'JUDGE_FALLBACK', issue: 'mj-x-crossday', note: fbNote('mj-x-crossday', 'refusal') }),
    // —— site E（mj-x-badnote）：note 坏格式——unknown 桶（状态机照推进）——
    judgeEvent({ ts: NOW - 400, event: 'JUDGE_FALLBACK', issue: 'mj-x-badnote', note: 'garbage' }),
    // —— site F（mj-x-stale）：窗口外（10 天前）ok×1——不入行集（窗口统计）但参与折叠——
    judgeEvent({ ts: NOW - 10 * DAY, event: 'JUDGE_OK', issue: 'mj-x-stale', note: okNote('mj-x-stale') }),
    // —— 另一公司（poly）：company 过滤面——
    judgeEvent({ ts: NOW - 100, event: 'JUDGE_OK', issue: 'mj-y-collect', company: 'poly', cost_usd: 0.0003, note: okNote('mj-y-collect') }),
  ]
  for (const ev of events) ledger.appendEvent(ev)
})

afterAll(async () => {
  ledger.close()
  await rm(root, { recursive: true, force: true })
})

const app = createPanelApp({ openLedger: () => ledger })

describe('GET /api/judge（端面形状与按址四要件）', () => {
  it('demo 面：行集全序（calls 降序→site 升序）；site A 四要件列逐值（费用含降级实费、均时含降级计时）', async () => {
    const res = await app.request('/api/judge?company=demo')
    expect(res.status).toBe(200)
    const body = (await res.json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(body.basis).toBe('events-replay-v1')
    expect(body.note).toContain('JUDGE_OK/JUDGE_FALLBACK')
    expect(body.days).toBe(DEFAULT_JUDGE_DAYS)
    // 端面 now=真实时钟（≥模块装载点）：since∈[NOW−7d, 请求时刻−7d]，只夹界不逐毫秒比
    expect(body.since).toBeGreaterThanOrEqual(NOW - DEFAULT_JUDGE_DAYS * DAY)
    expect(body.since).toBeLessThanOrEqual(Date.now() - DEFAULT_JUDGE_DAYS * DAY)
    expect(body.company).toBe('demo')
    expect(body.sites.map((s) => s.site)).toEqual([
      'mj-x-interrupt', // calls 4（与 relay 同数——site 升序在前）
      'mj-x-relay', // 4
      'mj-x-crossday', // 3（与 pick 同数——site 升序在前）
      'mj-x-pick', // 3
      'mj-x-badnote', // 1
    ]) // mj-x-stale 窗口外不入行集
    const a = body.sites.find((s) => s.site === 'mj-x-pick')
    expect(a).toBeDefined()
    expect(a?.company).toBe('demo')
    expect(a?.calls).toBe(3)
    expect(a?.ok).toBe(2)
    expect(a?.fallbacks).toBe(1)
    expect(a?.fallbackRate).toBeCloseTo(1 / 3, 10)
    expect(a?.costUsd).toBeCloseTo(0.0014 + 0.0009 + 0.0011, 12)
    expect(a?.avgDurationMs).toBeCloseTo((1200 + 10_000 + 900) / 3, 10)
    expect(a?.lastTs).toBe(NOW - 3 * DAY + 3_000)
    expect(a?.byReason).toEqual([{ reason: 'timeout', count: 1 }])
    expect(a?.breaker).toEqual({ open: false, streak: 0, lastReason: null, openSinceDay: null }) // 末事件 OK→清零
  })

  it('site B：当日同因连击 3 熔断开 + site-open 不破开态（streak 换因归 1）；site C：成功清零；site D：跨日签名复位', async () => {
    const body = (await (await app.request('/api/judge?company=demo')).json()) as ReturnType<typeof buildJudgeSnapshot>
    const b = body.sites.find((s) => s.site === 'mj-x-interrupt')
    expect(b?.calls).toBe(4)
    expect(b?.ok).toBe(0)
    expect(b?.fallbackRate).toBe(1)
    expect(b?.breaker.open).toBe(true)
    expect(b?.breaker.openSinceDay).toBe(dayKeyOf(NOW - 9_000))
    expect(b?.breaker.streak).toBe(1) // site-open 换因归 1（开态由同日旧标记保持）
    expect(b?.breaker.lastReason).toBe('site-open')
    expect(b?.byReason).toEqual([
      { reason: 'bad-json', count: 3 },
      { reason: 'site-open', count: 1 },
    ])
    const c = body.sites.find((s) => s.site === 'mj-x-relay')
    expect(c?.calls).toBe(4)
    expect(c?.ok).toBe(1)
    expect(c?.fallbacks).toBe(3)
    expect(c?.breaker.open).toBe(false)
    expect(c?.breaker.streak).toBe(1)
    expect(c?.breaker.lastReason).toBe('over-spend')
    const d = body.sites.find((s) => s.site === 'mj-x-crossday')
    expect(d?.breaker.open).toBe(false)
    expect(d?.breaker.streak).toBe(1) // 前日×2 不隔夜累计
    expect(d?.breaker.lastReason).toBe('refusal')
  })

  it('坏 note：unknown 桶如实呈现（状态机照推进，不臆造原因）', async () => {
    const body = (await (await app.request('/api/judge?company=demo')).json()) as ReturnType<typeof buildJudgeSnapshot>
    const e = body.sites.find((s) => s.site === 'mj-x-badnote')
    expect(e?.byReason).toEqual([{ reason: JUDGE_REASON_UNKNOWN, count: 1 }])
    expect(e?.breaker.lastReason).toBe(JUDGE_REASON_UNKNOWN)
  })

  it('合计与熔断计数：totals=Σ 行集（窗口内）；openBreakers=1（B）', async () => {
    const body = (await (await app.request('/api/judge?company=demo')).json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(body.totals.calls).toBe(15)
    expect(body.totals.ok).toBe(3)
    expect(body.totals.fallbacks).toBe(12)
    expect(body.totals.fallbackRate).toBeCloseTo(12 / 15, 10)
    expect(body.totals.costUsd).toBeCloseTo(0.0014 + 0.0009 + 0.0011 + 0.0002 + 0.02, 10)
    expect(body.openBreakers).toBe(1)
  })

  it('company 过滤排他（poly 面只含 mj-y-collect）；ghost 公司零行零合计不炸', async () => {
    const poly = (await (await app.request('/api/judge?company=poly')).json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(poly.sites.map((s) => s.site)).toEqual(['mj-y-collect'])
    expect(poly.totals.calls).toBe(1)
    expect(poly.totals.ok).toBe(1)
    expect(poly.totals.costUsd).toBeCloseTo(0.0003, 12)
    const ghost = (await (await app.request('/api/judge?company=ghost')).json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(ghost.sites).toEqual([])
    expect(ghost.totals).toEqual({ calls: 0, ok: 0, fallbacks: 0, fallbackRate: 0, costUsd: 0 })
    expect(ghost.openBreakers).toBe(0)
  })

  it('days 夹取：非数/非正落缺省 7，超上限夹 90', async () => {
    const bad = (await (await app.request('/api/judge?days=abc')).json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(bad.days).toBe(DEFAULT_JUDGE_DAYS)
    const big = (await (await app.request('/api/judge?days=999')).json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(big.days).toBe(90)
  })

  it('窗口收窄（days=1）：前日及其更早事件出窗——pick/interrupt 前 3 记断链事件出窗，当日事件留窗', async () => {
    const body = (await (await app.request('/api/judge?company=demo&days=1')).json()) as ReturnType<typeof buildJudgeSnapshot>
    expect(body.sites.map((s) => s.site)).toEqual([
      'mj-x-interrupt', // 4（与 relay 同数——site 升序在前）
      'mj-x-relay', // 4
      'mj-x-badnote', // 1（与 crossday 同数——site 升序在前）
      'mj-x-crossday', // 1（前日×2 出窗，当日×1 留）
    ]) // mj-x-pick（全在 3 天前）整址出窗
    // 熔断投影不受窗口约束：interrupt 的开态由出窗的当日三连击折叠而来
    const b = body.sites.find((s) => s.site === 'mj-x-interrupt')
    expect(b?.breaker.open).toBe(true)
    expect(b?.calls).toBe(4)
  })
})

describe('buildJudgeSnapshot / 纯函数面', () => {
  it('now 注入：generatedAt/since=now−days×24h；avgDurationMs=null（无计时事件）', () => {
    const body = buildJudgeSnapshot(ledger, { now: NOW, days: 1, company: 'demo' })
    expect(body.generatedAt).toBe(NOW)
    expect(body.since).toBe(NOW - DAY)
    const b = body.sites.find((s) => s.site === 'mj-x-interrupt')
    expect(b?.avgDurationMs).toBe(null) // 该址事件全不带 duration_ms
  })

  it('parseFallbackReason：冻结格式解析 / detail 后缀不吞 / 坏格式 null', () => {
    expect(parseFallbackReason('site=mj-x reason=timeout')).toBe('timeout')
    expect(parseFallbackReason('site=mj-x reason=no-model code=AUTH')).toBe('no-model')
    expect(parseFallbackReason(undefined)).toBe(null)
    expect(parseFallbackReason('garbage')).toBe(null)
  })

  it('replayJudgeBreakers：空事件集→空投影；非判断事件跳过；昨日开断今日投影闭合（日界差自动复位）', () => {
    expect(replayJudgeBreakers([], dayKeyOf(NOW)).size).toBe(0)
    const nonJudge = judgeEvent({ ts: NOW, event: 'JUDGE_OK', issue: 'mj-x' })
    ;(nonJudge as { event: string }).event = 'LLM' // 非判断事件（issue 撞哨兵也不折叠）
    expect(replayJudgeBreakers([nonJudge], dayKeyOf(NOW)).size).toBe(0)
    // 昨日开的断：now 日键≠openSinceDay → 投影闭合（daemon 同款 isJudgeSiteOpen 语义）
    const yesterday = dayKeyOf(NOW) !== dayKeyOf(NOW - DAY) ? NOW - DAY : NOW - 2 * DAY
    const opened: EventRecord[] = [
      judgeEvent({ ts: yesterday + 1, event: 'JUDGE_FALLBACK', issue: 'mj-z', note: fbNote('mj-z', 'bad-json') }),
      judgeEvent({ ts: yesterday + 2, event: 'JUDGE_FALLBACK', issue: 'mj-z', note: fbNote('mj-z', 'bad-json') }),
      judgeEvent({ ts: yesterday + 3, event: 'JUDGE_FALLBACK', issue: 'mj-z', note: fbNote('mj-z', 'bad-json') }),
    ]
    expect(replayJudgeBreakers(opened, dayKeyOf(yesterday)).get('mj-z')?.open).toBe(true)
    expect(replayJudgeBreakers(opened, dayKeyOf(NOW)).get('mj-z')?.open).toBe(false)
  })
})
