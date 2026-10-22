/**
 * panel 判断调用投影 ↔ core 熔断状态机对齐测试（160 §6.5 单D，studio-dev-180）。
 *
 * 为什么落 daemon：panel 运行面依赖冻结为 contract+store（guard:boundaries 边表），
 * panel→core 是非法边；而熔断投影的值语义镜像自 core judge-gates。daemon→panel、
 * daemon→core 均为合法边——跨包对齐面钉在这里（测试面不进 panel 运行面，同
 * panel-inbox-align 先例）。
 *
 * 断言两面：
 *   1) round-trip：daemon 事件构造器（judge/events.ts 冻结 note 格式）→ panel 读面
 *      解析器——site（issue 哨兵）/reason（冻结枚举全量）逐值还原，无 unknown 泄漏；
 *   2) 状态机等价：对任意脚本化事件流，panel replayJudgeBreakers 的折叠 ≡ core
 *      onJudgeFallback/onJudgeSuccess 逐事件折叠。运行时锚据：invoke.ts degrade()
 *      对每条 JUDGE_FALLBACK 恒走 onJudgeFallback（含 site-open——L264/L295），
 *      每条 JUDGE_OK 恒走 onJudgeSuccess（L392）→ 事件流重放与内存态折叠 1:1。
 *      镜像漂移即红（面板熔断列=引擎真实熔断态）。
 */
import { describe, expect, it } from 'vitest'
import type { EventRecord } from '@studio-next/contract'
import {
  JUDGE_BREAKER_THRESHOLD,
  JUDGE_FALLBACK_REASONS,
  initialJudgeBreaker,
  isJudgeSiteOpen,
  onJudgeFallback,
  onJudgeSuccess,
  type JudgeFallbackReason,
  type JudgeSiteBreakerState,
} from '@studio-next/core'
import { dayKeyOf } from '@studio-next/panel'
import {
  JUDGE_BREAKER_THRESHOLD_PROJECTION,
  JUDGE_REASON_UNKNOWN,
  isJudgeEvent,
  parseFallbackReason,
  replayJudgeBreakers,
} from '@studio-next/panel/judge'
import { judgeFallbackEvent, judgeOkEvent } from '../src/engine/judge/events.ts'
import { makeUlid } from '../src/engine/tools/id.ts'

const DAY = 86_400_000
/** 脚本锚：真实时钟取整日中（day1/day2/today 三档相对日键确定） */
const TODAY = Date.now()
const DAY1 = TODAY - 2 * DAY
const DAY2 = TODAY - 1 * DAY

/** 事件构造（daemon 构造器真值——note/issue 即台账面唯一信息载体） */
const ok = (site: string, ts: number): EventRecord =>
  judgeOkEvent({
    id: makeUlid(ts),
    ts,
    company: 'demo',
    site,
    op: 'pick',
    vocabFingerprint: 'ab12cd34',
    costUsd: 0.001,
    durationMs: 800,
    tokens: { input: 3000, output: 100 },
  })
const fb = (site: string, ts: number, reason: JudgeFallbackReason, detail?: string): EventRecord =>
  judgeFallbackEvent({ id: makeUlid(ts), ts, company: 'demo', site, reason, ...(detail !== undefined ? { detail } : {}) })

/** core 逐事件折叠（=daemon invoke.ts 运行时对内存态做的事） */
function coreFold(events: EventRecord[], site: string): JudgeSiteBreakerState {
  let state = initialJudgeBreaker(site)
  for (const ev of events) {
    if (ev.issue !== site) continue
    if (ev.event === 'JUDGE_OK') {
      state = onJudgeSuccess(state)
      continue
    }
    // 测试语料 note 恒为构造器冻结格式——解析必中（round-trip 面另测全枚举）
    const reason = parseFallbackReason(ev.note) as JudgeFallbackReason
    state = onJudgeFallback(state, reason, dayKeyOf(ev.ts))
  }
  return state
}

describe('round-trip：daemon 事件构造器 → panel 读面解析器（冻结 note 格式不漂移）', () => {
  it('JUDGE_FALLBACK reason 冻结枚举全量还原（含 detail 后缀不吞）；issue=site 哨兵往返', () => {
    expect(JUDGE_FALLBACK_REASONS.length).toBeGreaterThanOrEqual(14)
    for (const reason of JUDGE_FALLBACK_REASONS) {
      const ev = fb('mj-roundtrip', TODAY - 500, reason)
      expect(isJudgeEvent(ev)).toBe(true)
      expect(ev.event).toBe('JUDGE_FALLBACK')
      expect(ev.issue).toBe('mj-roundtrip') // site 归属=issue 列（panel 投影键）
      expect(parseFallbackReason(ev.note)).toBe(reason) // 无 unknown 泄漏
    }
    const withDetail = fb('mj-roundtrip', TODAY - 400, 'output-truncated', 'len=8192>max')
    expect(parseFallbackReason(withDetail.note)).toBe('output-truncated') // detail 后缀不吞原因位
  })

  it('JUDGE_OK：issue=site 哨兵往返；note 非 reason 载体（fallback 解析器对 ok note 恒 null）', () => {
    const ev = ok('mj-ok-rt', TODAY - 300)
    expect(isJudgeEvent(ev)).toBe(true)
    expect(ev.issue).toBe('mj-ok-rt')
    expect(parseFallbackReason(ev.note)).toBe(null)
  })

  it('阈值镜像同值（core 冻结 3——面板本地声明漂移即红）', () => {
    expect(JUDGE_BREAKER_THRESHOLD_PROJECTION).toBe(JUDGE_BREAKER_THRESHOLD)
  })
})

describe('状态机等价：panel 重放投影 ≡ core 折叠（面板熔断列=引擎真实熔断态）', () => {
  /** 脚本面：覆盖开/清零/换因/跨日/site-open 不破开/日界闭合/全 ok 六工况 */
  const script: EventRecord[] = [
    // mj-a：同因连击 3 → 开（当日）
    fb('mj-a', DAY1 + 1_000, 'bad-json'),
    fb('mj-a', DAY1 + 2_000, 'bad-json'),
    fb('mj-a', DAY1 + 3_000, 'bad-json'),
    // mj-b：连击 2 → 成功 → 再降（成功清零，streak=1）
    fb('mj-b', DAY2 + 1_000, 'bad-json'),
    fb('mj-b', DAY2 + 2_000, 'bad-json'),
    ok('mj-b', DAY2 + 3_000),
    fb('mj-b', DAY2 + 4_000, 'bad-json'),
    // mj-c：换因归 1
    fb('mj-c', DAY2 + 5_000, 'timeout'),
    fb('mj-c', DAY2 + 6_000, 'bad-json'),
    // mj-d：昨日×2 + 今日×1 ——跨日签名复位（streak=1 不开）
    fb('mj-d', DAY1 + 7_000, 'refusal'),
    fb('mj-d', DAY1 + 8_000, 'refusal'),
    fb('mj-d', TODAY - 2_000, 'refusal'),
    // mj-e：昨日开断——今日投影闭合（日界差自动复位）
    fb('mj-e', DAY1 + 9_000, 'params-domain'),
    fb('mj-e', DAY1 + 10_000, 'params-domain'),
    fb('mj-e', DAY1 + 11_000, 'params-domain'),
    // mj-f：当日开断后再吃 site-open——开态保持、换因归 1（invoke degrade 对
    // site-open 也走 onJudgeFallback——运行时锚据，镜像必须同形）
    fb('mj-f', TODAY - 6_000, 'op-not-in-vocab'),
    fb('mj-f', TODAY - 5_000, 'op-not-in-vocab'),
    fb('mj-f', TODAY - 4_000, 'op-not-in-vocab'),
    fb('mj-f', TODAY - 3_000, 'site-open'),
    // mj-g：仅成功——零态
    ok('mj-g', TODAY - 1_000),
    // mj-h：混序穿插（跨址交错——按址折叠互不串扰）
    fb('mj-h', TODAY - 9_000, 'estimate-over-cap'),
    // mj-a 开断后成功：onJudgeSuccess 整体清零（丢 openSinceDay——core 冻结语义；运行时
    // 开断中的址到不了成功事件，此为状态机边界工况钉值——防「两边一起漂」的空对齐）
    ok('mj-a', TODAY - 8_000),
    fb('mj-h', TODAY - 7_000, 'estimate-over-cap'),
  ]

  it('逐址逐字段全等：open（isJudgeSiteOpen）/streak/lastReason/openSinceDay', () => {
    const nowDay = dayKeyOf(TODAY)
    const projection = replayJudgeBreakers(script, nowDay)
    const sites = new Set(script.map((ev) => ev.issue))
    expect(sites.size).toBe(8)
    for (const site of sites) {
      const core = coreFold(script, site)
      const panel = projection.get(site)
      expect(panel, `site=${site} 投影存在`).toBeDefined()
      expect(panel?.open, `site=${site} open`).toBe(isJudgeSiteOpen(core, nowDay))
      expect(panel?.streak, `site=${site} streak`).toBe(core.streak)
      expect(panel?.lastReason, `site=${site} lastReason`).toBe(core.lastReason ?? null)
      expect(panel?.openSinceDay, `site=${site} openSinceDay`).toBe(core.openSinceDay ?? null)
    }
  })

  it('工况锚值（防「两边一起漂」的空对齐）：a 当日开 / b 清零 / d 跨日归 1 / e 日界闭合 / f site-open 不破开', () => {
    const nowDay = dayKeyOf(TODAY)
    const p = replayJudgeBreakers(script, nowDay)
    expect(p.get('mj-a')?.open).toBe(false) // 开断后成功→整体清零（边界工况）
    expect(p.get('mj-a')?.streak).toBe(0)
    expect(p.get('mj-a')?.lastReason).toBe(null)
    expect(p.get('mj-b')?.open).toBe(false)
    expect(p.get('mj-b')?.streak).toBe(1)
    expect(p.get('mj-c')?.streak).toBe(1)
    expect(p.get('mj-c')?.lastReason).toBe('bad-json')
    expect(p.get('mj-d')?.streak).toBe(1)
    expect(p.get('mj-d')?.open).toBe(false)
    expect(p.get('mj-e')?.open).toBe(false) // 昨日开断今日闭合
    expect(p.get('mj-e')?.openSinceDay).toBe(dayKeyOf(DAY1)) // 跨日闭合但键保留（core 状态原样）
    expect(p.get('mj-f')?.open).toBe(true) // site-open 不破开态
    expect(p.get('mj-f')?.streak).toBe(1)
    expect(p.get('mj-f')?.lastReason).toBe('site-open')
    expect(p.get('mj-g')).toEqual({ open: false, streak: 0, lastReason: null, openSinceDay: null })
    expect(p.get('mj-h')?.streak).toBe(2)
  })

  it('投影吃全量史（跨址交错/排序不敏感）：shuffle 后逐址投影不变', () => {
    const nowDay = dayKeyOf(TODAY)
    const base = replayJudgeBreakers(script, nowDay)
    // 同址事件相对序保持（shuffle 只乱址间序——store queryEvents 按 (ts,id) 升序，
    // 此处验证的是「址间交错不影响按址折叠」；同址乱序属台账不可达态，不测）
    const shuffled = [...script].sort((a, b) => (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : a.ts - b.ts))
    const other = replayJudgeBreakers(shuffled, nowDay)
    for (const site of new Set(script.map((ev) => ev.issue))) {
      expect(other.get(site)).toEqual(base.get(site))
    }
  })

  it('未知原因桶不进 core 等价面（panel unknown 桶只属坏 note 防御——构造器语料恒可解析）', () => {
    for (const reason of JUDGE_FALLBACK_REASONS) {
      expect(reason).not.toBe(JUDGE_REASON_UNKNOWN)
    }
  })
})
