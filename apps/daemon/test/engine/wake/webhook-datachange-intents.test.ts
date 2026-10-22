/**
 * webhook / data-change 意图消费（129-A 消费门扩两行）——studio-dev-166 实现面测试
 *
 * 规格依据（129 提案 §6.1 分类学，制作人 2026-10-22 全批；批示②=data-change kind、
 * 批示⑥=webhook 派工链缓开）：
 *   - §6.1③ 外部类：webhook 消费=只落单不派工（22-§二 原语义）——落终态锚点结构性
 *     不可派发（patrol 工件先例，DEV-40）；派工升级链（payload 指定路由）=批示⑥ P2 缓开，
 *     引擎留登记位无实现面
 *   - §6.1① 数据变更类：消费=物化联动单→路由表定 assignee→前向态进派发链（联动单是
 *     要做工的单）；dedupKey=变更指纹 `person+classifier+prev→next`（铁律2 幂等双层，
 *     源侧设置引擎校验一致）
 *   - 129 P1-A/C9 双链收口：API 触发端点与 watch-file 同产 webhook 意图走 ingest 统一链
 *   - docs/25-§3.4 v1.3/v1.8（无 ticket 意图必填 dedupKey；幂等键四元组；kind 增 data-change）
 *   - docs/22-§三.2（意图幂等：PATROL 留痕派生键集 append-only 不释放）
 *
 * 断言面：
 *   1. webhook 端到端：落单（[webhook] 前缀+溯源 description）→ PATROL 留痕 → 同拍
 *      回收 CLOSE；零派发/零在途/零预算（终态锚点结构性不派发）
 *   2. webhook 明报拒收：payload 形状不符 / dedupKey 含分号（PATROL note 可表示性）；
 *      缺 dedupKey（HOLD_INTENT_MALFORMED 前置闸）
 *   3. webhook 注入防御：eventId 含 ";job=" → noteSafe 净化，jobTickets 零命中
 *      （dedupKey≠eventId——eventId 只展示不承载幂等键，与 mention 闸差异是设计点）
 *   4. data-change 端到端：路由命中 → [联动] 单物化（assignee=路由目标、前向态）→
 *      PATROL → DISPATCH（派发链——fake adapter 即跑即收）
 *   5. data-change 明报拒收（fail-closed）：class≠people-change / classifier 非七值 /
 *      dedupKey≠变更指纹（伪造面）/ 路由未配 / 类型未命中 / 路由目标不在人事索引
 *      （无 defaultPersonId 兜底——宁拒不错派）
 *   6. 幂等：同指纹/同 dedupKey 跨拍重投恒只物化一次（patrolKeys append-only）
 *   7. 同拍混排 schedule+mention 系零回归：webhook+data-change 两行与既有行互不干扰
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, EventRecord, InvokeIntent } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import {
  checkDataChangePayload,
  checkWebhookPayload,
  createEngine,
  dataChangeFingerprint,
  ENGINE_CONFIG_DEFAULTS,
  type Engine,
} from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''

/** 两人物快照（AGENT-1=路由目标路；PRIME-0=在索引但不路由——区分路由面与索引面） */
function twoPersonSnapshot(): CompanySnapshot {
  return {
    ...DEMO_SNAPSHOT,
    people: [
      { id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' },
      { id: 'PRIME-0', name: '宰相', login: 'prime-0', level: 3, dept: 'departments/工程部' },
    ],
  }
}

interface EngineStack {
  platform: ReturnType<typeof createFakePlatform>
  ledger: Ledger
  engine: Engine
  clock: { now(): number; advance(ms: number): void }
}

function buildEngineStack(
  id: string,
  opts?: { dataChangeRoutes?: Readonly<Record<string, string>>; rescanEveryTicks?: number },
): EngineStack {
  const snapshot = twoPersonSnapshot()
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = Date.UTC(2026, 9, 22, 0, 0, 0)
  const clock = { now: (): number => t, advance: (ms): void => { t += ms } }
  const platform = createFakePlatform({ now: () => new Date(t).toISOString() })
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
      defaultPersonId: snapshot.people[0]?.id ?? 'AGENT-1',
      deptFallback: snapshot.departments[0]?.path ?? 'departments/工程部',
      defaultLane: snapshot.departments[0]?.lanes[0] ?? 'core',
      ...(opts?.dataChangeRoutes !== undefined ? { dataChangeRoutes: opts.dataChangeRoutes } : {}),
      // 混排多单并发收口要快进重扫（DEV-42①：无活动单靠 rescan 重进决策候选——缺省 30 拍
      // 太慢；本测试面开 1，语义面与生产行为一致）
      ...(opts?.rescanEveryTicks !== undefined ? { mirrorRescanEveryTicks: opts.rescanEveryTicks } : {}),
    },
  })
  return { platform, ledger, engine, clock }
}

/** webhook 意图负载入参（源侧契约面：watch-file dedupKey=mtime#行号；API=幂等键同源） */
interface WebhookPayloadInput {
  title?: string
  detail?: string
  eventId?: string
  dedupKey?: string
  source?: string
}

function webhookIntent(partial?: WebhookPayloadInput): InvokeIntent {
  return {
    kind: 'webhook',
    company: 'demo',
    source: partial?.source ?? 'watch-file',
    dedupKey: partial?.dedupKey ?? '1770000000000#1',
    priority: 1,
    payload: {
      title: partial?.title ?? '外部系统：构建失败',
      eventId: partial?.eventId ?? '$hook-1',
      ...(partial?.detail !== undefined ? { detail: partial.detail } : {}),
    },
  }
}

/** data-change 意图负载入参——dedupKey 按源侧契约公式**字面**推导（不 import 引擎函数：
 *  源侧与引擎侧两独立实现必须给出同一指纹，公式漂移在此暴露——129-§6.1 铁律2） */
interface DataChangeInput {
  classifier?: string
  person?: string
  field?: string
  prev?: string | null
  next?: string | null
  linked_ticket?: string
  dedupKey?: string
}

function dataChangeIntent(partial?: DataChangeInput): InvokeIntent {
  const p = {
    class: 'people-change',
    classifier: partial?.classifier ?? '入',
    person: partial?.person ?? 'AGENT-2',
    ...(partial?.field !== undefined ? { field: partial.field } : {}),
    ...(partial?.prev !== undefined ? { prev: partial.prev } : {}),
    ...(partial?.next !== undefined ? { next: partial.next } : {}),
    ...(partial?.linked_ticket !== undefined ? { linked_ticket: partial.linked_ticket } : {}),
  }
  const prev = (partial?.prev ?? undefined) === undefined ? '' : (partial?.prev ?? '')
  const next = (partial?.next ?? undefined) === undefined ? '' : (partial?.next ?? '')
  return {
    kind: 'data-change',
    company: 'demo',
    source: 'people-change',
    dedupKey: partial?.dedupKey ?? `${p.person}+${p.classifier}+${prev}→${next}`,
    priority: 1,
    payload: p,
  }
}

/**
 * SLA 扫描器视角（镜像 jobs-sources.ts jobTickets 的正则 `(?:^|;)job=([^;]+)`——
 * mention-intents.test.ts 同款：job= 前缀是岗单据 PATROL 的唯一可见性判据）
 */
function scanJobKeys(events: readonly EventRecord[]): string[] {
  const out: string[] = []
  for (const e of events) {
    if (e.event !== 'PATROL') continue
    const m = /(?:^|;)job=([^;]+)/.exec(e.note ?? '')
    if (m !== null) out.push(m[1] as string)
  }
  return out
}

function eventsOf(ledger: Ledger, name: EventRecord['event']): EventRecord[] {
  return ledger.queryEvents().filter((e) => e.event === name)
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'sn-129a-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 0. 契约件单元面 —————————————————————————

describe('payload 契约件：checkWebhookPayload / checkDataChangePayload / dataChangeFingerprint', () => {
  it('checkWebhookPayload：title 必填字符串、detail/eventId 可选字符串、未知形状明报', () => {
    expect(checkWebhookPayload({ title: 't' })).toEqual({ title: 't' })
    expect(checkWebhookPayload({ title: 't', detail: 'd', eventId: 'e' })).toEqual({ title: 't', detail: 'd', eventId: 'e' })
    expect(checkWebhookPayload(null)).toMatch(/payload 非对象/)
    expect(checkWebhookPayload({})).toMatch(/title 缺失或非字符串/)
    expect(checkWebhookPayload({ title: 1 })).toMatch(/title 缺失或非字符串/)
    expect(checkWebhookPayload({ title: 't', detail: 2 })).toMatch(/detail 非字符串/)
    expect(checkWebhookPayload({ title: 't', eventId: 3 })).toMatch(/eventId 非字符串/)
  })

  it('checkDataChangePayload：class 固定 people-change、classifier 七值域、person 非空', () => {
    expect(checkDataChangePayload({ class: 'people-change', classifier: '入', person: 'AGENT-2' })).toEqual({
      class: 'people-change',
      classifier: '入',
      person: 'AGENT-2',
    })
    expect(checkDataChangePayload({ class: 'budget-threshold', classifier: '入', person: 'X' })).toMatch(
      /class 'budget-threshold' 不支持（v0 只开 people-change/,
    )
    for (const bad of ['', '调岗', 'transfer']) {
      expect(checkDataChangePayload({ class: 'people-change', classifier: bad, person: 'AGENT-2' })).toMatch(
        /classifier '.*' 不在人事事件七值/,
      )
    }
    expect(checkDataChangePayload({ class: 'people-change', classifier: '入' })).toMatch(/person 缺失或非字符串/)
    expect(checkDataChangePayload({ class: 'people-change', classifier: '入', person: 'AGENT-2', prev: 7 })).toMatch(
      /prev 非字符串\/null/,
    )
  })

  it('dataChangeFingerprint：公式逐字对齐提案 `person+type+prev→next`（缺省渲染空串）', () => {
    expect(dataChangeFingerprint({ person: 'AGENT-2', classifier: '入', prev: null, next: '2' })).toBe('AGENT-2+入+→2')
    expect(dataChangeFingerprint({ person: 'AGENT-2', classifier: '调', field: 'level', prev: '2', next: '3' })).toBe(
      'AGENT-2+调+2→3',
    )
    // 指纹不携带 field（提案公式无 field——同工号同类型同值域的字段级变更归源侧聚合）
    expect(dataChangeFingerprint({ person: 'P', classifier: '调', prev: 'a', next: 'b' })).toBe(
      dataChangeFingerprint({ person: 'P', classifier: '调', field: 'x', prev: 'a', next: 'b' }),
    )
  })
})

// ————————————————————————— 1. webhook 端到端（只落单不派工） —————————————————————————

describe('webhook 意图：端到端落单链（129-§6.1③ 只落单不派工）', () => {
  it('物化事件单：[webhook] 前缀+溯源 description、无 assignee、落终态锚点 → PATROL+CLOSE 同拍收口；零派发零在途', async () => {
    const s = buildEngineStack('wh-e2e')
    s.engine.ingest([webhookIntent()])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])

    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(1)
    const ticket = issues[0]
    expect(ticket?.type).toBe('task')
    expect(ticket?.level).toBe(0)
    expect(ticket?.assignee).toBeUndefined() // 只落单：无天然派工对象
    expect(ticket?.title.startsWith('[webhook] 外部系统：构建失败')).toBe(true)
    expect(ticket?.description).toContain('watch-file')
    expect(ticket?.description).toContain('$hook-1')
    expect(ticket?.description).toContain('1770000000000#1')
    expect(ticket?.description).toContain('只落单不派工')
    expect(ticket?.state).toBe('已交付') // 终态锚点（delivered，无前向边=结构性不可派发）

    // PATROL 留痕：class=external 分类型 + 溯源；note 无 job=（SLA 盲区纪律）
    const patrols = eventsOf(s.ledger, 'PATROL')
    expect(patrols).toHaveLength(1)
    const note = patrols[0]?.note ?? ''
    expect(note).toContain('intent=watch-file|webhook|demo|1770000000000#1')
    expect(note).toContain('class=external')
    expect(note).toContain('event=$hook-1')
    expect(note).toContain('dedup=1770000000000#1')
    expect(scanJobKeys(patrols)).toHaveLength(0)

    // 同拍收口：PATROL+CLOSE，零派发账（终态锚点不烧配额）
    expect(report.events.map((e) => e.event)).toEqual(['PATROL', 'CLOSE'])
    expect(eventsOf(s.ledger, 'DISPATCH')).toHaveLength(0)
    expect(s.ledger.listWorkRecords()).toHaveLength(0)
    s.ledger.close()
  })

  it('detail 正文全文落 description（外部事件原文可查）', async () => {
    const s = buildEngineStack('wh-detail')
    s.engine.ingest([webhookIntent({ detail: 'pipeline #42 failed at stage deploy\nlog: exit 1', eventId: '$hook-2', dedupKey: '1770000000001#2' })])
    await s.engine.tick()
    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(1)
    expect(issues[0]?.description).toContain('pipeline #42 failed at stage deploy')
    s.ledger.close()
  })

  it('幂等：同 dedupKey 同拍 ×3 → 单次物化；跨拍重投零物化零错误（patrolKeys append-only）', async () => {
    const s = buildEngineStack('wh-dup')
    const intent = webhookIntent({ dedupKey: '1770000000000#9', eventId: '$hook-dup' })
    s.engine.ingest([intent, intent, intent])
    await s.engine.tick()
    expect(await s.platform.issues.list({})).toHaveLength(1)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(1)
    s.engine.ingest([intent])
    const report2 = await s.engine.tick()
    expect(report2.errors).toEqual([])
    expect(await s.platform.issues.list({})).toHaveLength(1)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(1)
    s.ledger.close()
  })
})

// ————————————————————————— 2. webhook 明报拒收与注入防御 —————————————————————————

describe('webhook 意图：明报拒收 + 注入净化（外部事件按不可信输入对待，21-§三）', () => {
  it('payload 形状不符（title 缺失）→ errors 明报、零物化', async () => {
    const s = buildEngineStack('wh-shape')
    s.engine.ingest([webhookIntent({ title: '', dedupKey: 'k1' })])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('形状不符')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0)
    s.ledger.close()
  })

  it('dedupKey 含分号/换行（PATROL note 键值不可表示）→ 明报拒收、零物化', async () => {
    const s = buildEngineStack('wh-inject-key')
    s.engine.ingest([webhookIntent({ dedupKey: 'bad;job=ghost;intent=fake' })])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('dedupKey 含分号/换行')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0)
    s.ledger.close()
  })

  it('缺 dedupKey → HOLD_INTENT_MALFORMED 前置闸明报（25-§3.4 v1.3，webhook 变体）', async () => {
    const s = buildEngineStack('wh-no-dedup')
    const bare = { ...webhookIntent(), dedupKey: undefined } as unknown as InvokeIntent
    s.engine.ingest([bare])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('缺 dedupKey')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('eventId 注入 ";job="（dedupKey 干净——eventId 只展示不承载幂等键）→ noteSafe 净化为全角；，jobTickets 零命中', async () => {
    // 与 mention 的差异是设计点：mention eventId=dedupKey=幂等键源，含分号整体拒收；
    // webhook 幂等键在 intent.dedupKey（已过可表示性闸），eventId 为展示性溯源——净化后留痕
    const s = buildEngineStack('wh-inject-event')
    s.engine.ingest([webhookIntent({ eventId: 'evt;job=ghost;intent=fake', dedupKey: '1770000000002#3' })])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const patrols = eventsOf(s.ledger, 'PATROL')
    expect(patrols).toHaveLength(1)
    const note = patrols[0]?.note ?? ''
    expect(note).toContain('event=evt；job=ghost；intent=fake')
    expect(scanJobKeys(patrols)).toHaveLength(0)
    s.ledger.close()
  })
})

// ————————————————————————— 3. data-change 端到端（联动单进派发链） —————————————————————————

describe('data-change 意图：端到端联动单（129-§6.1① 物化联动单+路由指派）', () => {
  it('入司事件 → [联动] 单物化（assignee=路由目标、前向态）→ PATROL → DISPATCH（派发链）', async () => {
    const s = buildEngineStack('dc-e2e', { dataChangeRoutes: { 入: 'AGENT-1', 调: 'AGENT-1', 升: 'PRIME-0' } })
    s.engine.ingest([dataChangeIntent({ person: 'AGENT-9', next: '2' })])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])

    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(1)
    const ticket = issues[0]
    expect(ticket?.type).toBe('task')
    expect(ticket?.level).toBe(0)
    expect(ticket?.assignee).toBe('AGENT-1') // 路由表指派（非 defaultPersonId 兜底）
    expect(ticket?.title.startsWith('[联动] AGENT-9 入')).toBe(true)
    expect(ticket?.description).toContain('AGENT-9+入+→2') // 变更指纹溯源
    expect(ticket?.description).toContain('入 → AGENT-1') // 路由依据
    expect(ticket?.state).not.toBe('已交付') // 前向态：联动单是要做工的单（进派发链）

    // PATROL 留痕：class=people-change + 变更明细；note 无 job=
    const patrols = eventsOf(s.ledger, 'PATROL')
    expect(patrols).toHaveLength(1)
    const note = patrols[0]?.note ?? ''
    expect(note).toContain('intent=people-change|data-change|demo|AGENT-9+入+→2')
    expect(note).toContain('class=people-change')
    expect(note).toContain('kind=入')
    expect(note).toContain('person=AGENT-9')
    expect(note).toContain('dedup=AGENT-9+入+→2')
    expect(scanJobKeys(patrols)).toHaveLength(0)

    // decide 主链接住：同拍 DISPATCH（fake adapter 即跑即收）——与 webhook 终态链的分野
    expect(eventsOf(s.ledger, 'DISPATCH').length).toBeGreaterThanOrEqual(1)
    s.ledger.close()
  })

  it('字段级变更（调：level 2→3）渲染 field 与前/后值；linked_ticket 溯源落 description', async () => {
    const s = buildEngineStack('dc-field', { dataChangeRoutes: { 调: 'AGENT-1' } })
    s.engine.ingest([dataChangeIntent({ classifier: '调', person: 'AGENT-1', field: 'level', prev: '2', next: '3', linked_ticket: 'DEM-404' })])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const ticket = (await s.platform.issues.list({}))[0]
    expect(ticket?.title.startsWith('[联动] AGENT-1.level 2→3（调）')).toBe(true)
    expect(ticket?.description).toContain('关联单：DEM-404')
    expect(ticket?.description).toContain('工号=AGENT-1 类型=调 字段=level 前值=2 后值=3')
    s.ledger.close()
  })

  it('幂等：同变更指纹跨拍重投恒只物化一次（129-§6.1 铁律2 重放面）', async () => {
    const s = buildEngineStack('dc-dup', { dataChangeRoutes: { 入: 'AGENT-1' } })
    const intent = dataChangeIntent({ person: 'AGENT-8' })
    s.engine.ingest([intent])
    await s.engine.tick()
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(1)
    s.engine.ingest([intent])
    const report2 = await s.engine.tick()
    expect(report2.errors).toEqual([])
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(1)
    expect(await s.platform.issues.list({})).toHaveLength(1)
    s.ledger.close()
  })
})

// ————————————————————————— 4. data-change 明报拒收（fail-closed 路由闸） —————————————————————————

describe('data-change 意图：明报拒收（fail-closed——宁拒不错派）', () => {
  it('class≠people-change → 明报拒收（v0 只开人事类；其余类归 P2 登记）', async () => {
    const s = buildEngineStack('dc-class', { dataChangeRoutes: { 入: 'AGENT-1' } })
    const bad = dataChangeIntent()
    ;(bad.payload as Record<string, unknown>).class = 'budget-threshold'
    s.engine.ingest([bad])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain("class 'budget-threshold' 不支持")
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('classifier 非七值 → 明报拒收', async () => {
    const s = buildEngineStack('dc-kind', { dataChangeRoutes: { 入: 'AGENT-1' } })
    const bad = dataChangeIntent({ classifier: '迁移' })
    s.engine.ingest([bad])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain("classifier '迁移' 不在人事事件七值")
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('dedupKey≠变更指纹 → 明报拒收（伪造换键重投绕幂等面——铁律2 校验一致）', async () => {
    const s = buildEngineStack('dc-forged', { dataChangeRoutes: { 入: 'AGENT-1' } })
    s.engine.ingest([dataChangeIntent({ dedupKey: 'forged-key' })])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('dedupKey≠变更指纹')
    expect(report.errors.join('\n')).toContain('forged-key vs AGENT-2+入+→')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0)
    s.ledger.close()
  })

  it('路由表未配置 → 明报拒收（登记位归拆单 C；fail-closed 不静默吞变更）', async () => {
    const s = buildEngineStack('dc-noroute')
    s.engine.ingest([dataChangeIntent()])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain("变更类型 '入' 无路由")
    expect(report.errors.join('\n')).toContain('dataChangeRoutes 登记位未配置')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('路由类型未命中（配了 升 没配 入）→ 明报拒收', async () => {
    const s = buildEngineStack('dc-miss', { dataChangeRoutes: { 升: 'PRIME-0' } })
    s.engine.ingest([dataChangeIntent({ classifier: '升', person: 'AGENT-3', prev: '2', next: '3' }), dataChangeIntent()])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain("变更类型 '入' 无路由")
    expect(report.errors.join('\n')).toContain('未命中')
    // 命中行不受殃及：升 路由的单照常物化
    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(1)
    expect(issues[0]?.assignee).toBe('PRIME-0')
    s.ledger.close()
  })

  it('路由目标不在人事索引 → 明报拒收（不落 defaultPersonId 错人面——mention 防错人纪律同款）', async () => {
    const s = buildEngineStack('dc-ghost', { dataChangeRoutes: { 入: 'HR-GHOST' } })
    s.engine.ingest([dataChangeIntent()])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('路由目标 HR-GHOST 不在人事索引')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })
})

// ————————————————————————— 5. 分发表混排零回归 —————————————————————————

describe('消费门：四行混排互不干扰（schedule｜mention｜webhook｜data-change）', () => {
  it('同拍四 kind 各自物化、形态分野正确（终态锚点 vs 派发链）', async () => {
    const s = buildEngineStack('mixed', { dataChangeRoutes: { 入: 'AGENT-1' }, rescanEveryTicks: 1 })
    // 播种样例岗（mention-intents.test.ts 同款——schedule 意图需台账有岗）
    s.ledger.upsertJob({
      job_id: 'health-patrol', company: 'demo', dept: 'departments/工程部',
      cron: '*/5 * * * *', role: 'AGENT-1', level: 2, model_tier: 'low', next_run_at: 0,
    })
    s.engine.ingest([
      {
        kind: 'schedule',
        company: 'demo',
        source: 'scheduler',
        dedupKey: 'health-patrol@2026-10-22T00:00:00.000Z',
        priority: 1,
        payload: { job_id: 'health-patrol' },
      },
      {
        kind: 'mention',
        company: 'demo',
        source: 'matrix',
        dedupKey: '$evt-mixed',
        priority: 1,
        payload: {
          target: 'PRIME-0', mention: '@宰相', text: '混排测试', eventId: '$evt-mixed',
          sender: '@producer:studio.local', room: '!room-1:studio.local',
        },
      },
      webhookIntent({ dedupKey: '1770000000003#4', eventId: '$hook-mixed' }),
      dataChangeIntent({ person: 'AGENT-7' }),
    ])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(4)
    const byPrefix = new Map(issues.map((i) => [i.title.slice(0, i.title.indexOf(' ')), i]))
    expect(byPrefix.get('[定时岗]')?.title.startsWith('[定时岗] health-patrol')).toBe(true)
    expect(byPrefix.get('[@唤醒]')?.assignee).toBe('PRIME-0')
    expect(byPrefix.get('[webhook]')?.state).toBe('已交付') // 终态锚点
    expect(byPrefix.get('[webhook]')?.assignee).toBeUndefined()
    expect(byPrefix.get('[联动]')?.assignee).toBe('AGENT-1') // 路由指派
    // 分野账：webhook 零派发；schedule/mention/data-change 三路进派发链（并发三闸+收割
    // 节拍串行化——多拍放行后断言；DISPATCH 落账 append-only，已派事件不随收口消失）
    for (let i = 0; i < 20; i += 1) {
      s.clock.advance(1000)
      await s.engine.tick()
    }
    const dispatched = new Set(eventsOf(s.ledger, 'DISPATCH').map((e) => e.issue))
    expect(dispatched.has(byPrefix.get('[webhook]')?.id ?? '')).toBe(false)
    expect(dispatched.size).toBeGreaterThanOrEqual(3)
    s.ledger.close()
  })
})
