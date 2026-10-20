/**
 * gated-platform 测试 —— 写路径网关收口包装器（17-§7「一切平台写入经 wkey 网关」的 daemon 侧机制化）
 *
 * 断言面（对应实现单验收）：
 *   1. 覆盖面结构穷尽：FlowPlatform 全部方法 ∈ 过闸 ∪ 直通（无遗漏、无重叠）
 *   2. 写面被闸：合法 control key 过且底层平台被调（计数 fake 断言调用数+副作用真发生）
 *   3. 坏 token 拒：malformed / 跨单号 / 重放 → gw-verify-* 且**底层平台未被调用**（fail-closed）
 *   4. 读面直通：八读面结果与裸 fake 一致；吊销后读面仍可用（读面与闸无涉的双证）
 *   5. 署名组装：comments.add 的 SignedBody 由包装器统一组装（author/落款=daemon 侧身份，
 *      调用方自带身份被忽略；@action 信封不落库）
 *   6. 控制面 key 生命周期：revoke(CONTROL_TICKET) 后全写面恒拒；一调用一签发（重放直证）
 *   7. 错误两级分类：运行期拒绝=EXTERNAL_REJECT/<gw-*>（ClassifiedError 形）；构造期=CONFIG_INVALID
 *   8. demo e2e 回归：经闸后 create→派发→收割→collect→merge→close 全链仍绿（engine 零改动）
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, FlowPlatform, PersonRef, SignedBody } from '@studio-next/contract'
import { CONTROL_TICKET, createGateway } from '@studio-next/gateway'
import type { Gateway } from '@studio-next/gateway'
import { openLedger, type Ledger } from '@studio-next/store'
import { createGatedPlatform, GATED_WRITE_METHODS, PASSTHROUGH_READ_METHODS } from '../../src/engine/tools/gated-platform.ts'
import { ENGINE_CONFIG_DEFAULTS, createEngine, type Engine } from '../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../src/engine/fakes.ts'
import { createDefaultGateRunner } from '../../src/engine/gate.ts'
import { createDefaultAssembler } from '../../src/engine/prompt-assembly.ts'

const SECRET = new TextEncoder().encode('0123456789abcdef0123456789abcdef')
const CTX = { company: '指尖游戏', dept: '平台部', role: '控制面', level: 9 }
const AUTHOR = 'daemon-ctl'

/** 拨钟网关（控制面实例：ticket=CONTROL_TICKET） */
function makeGateway(): { gw: Gateway; advance(ms: number): void } {
  let now = 1_700_000_000_000
  return { gw: createGateway({ secret: SECRET, clock: () => now, ticket: CONTROL_TICKET, ctx: CTX, author: AUTHOR }), advance: (ms) => (now += ms) }
}

/** 计数 fake 平台：每方法计数 + comments.add 落署名正文（fail-closed 断言的探针） */
interface CountingFake {
  platform: FlowPlatform
  counts: Record<string, number>
  commentBodies: SignedBody[]
}

function countingPlatform(): CountingFake {
  const inner = createFakePlatform()
  const counts: Record<string, number> = {}
  const commentBodies: SignedBody[] = []
  const bump = (k: string): void => {
    counts[k] = (counts[k] ?? 0) + 1
  }
  return {
    counts,
    commentBodies,
    platform: {
      issues: {
        async list(q) {
          bump('issues.list')
          return inner.issues.list(q)
        },
        async get(id) {
          bump('issues.get')
          return inner.issues.get(id)
        },
        async create(input) {
          bump('issues.create')
          return inner.issues.create(input)
        },
        async transition(id, toState) {
          bump('issues.transition')
          return inner.issues.transition(id, toState)
        },
        async setField(id, field, value) {
          bump('issues.setField')
          return inner.issues.setField(id, field, value)
        },
      },
      comments: {
        async add(id, body) {
          bump('comments.add')
          commentBodies.push(body)
          return inner.comments.add(id, body)
        },
        async list(id) {
          bump('comments.list')
          return inner.comments.list(id)
        },
      },
      fields: {
        async schema() {
          bump('fields.schema')
          return inner.fields.schema()
        },
        async provision(map) {
          bump('fields.provision')
          return inner.fields.provision(map)
        },
      },
      kb: {
        async upsert(p, md) {
          bump('kb.upsert')
          return inner.kb.upsert(p, md)
        },
        async search(q) {
          bump('kb.search')
          return inner.kb.search(q)
        },
        async get(p) {
          bump('kb.get')
          return inner.kb.get(p)
        },
      },
      activity: {
        async since(cursor) {
          bump('activity.since')
          return inner.activity.since(cursor)
        },
      },
      links: {
        async link(a, b, type) {
          bump('links.link')
          return inner.links.link(a, b, type)
        },
        async children(id) {
          bump('links.children')
          return inner.links.children(id)
        },
      },
      guards: {
        async install(company, rules) {
          bump('guards.install')
          return inner.guards.install(company, rules)
        },
        async uninstall(company) {
          bump('guards.uninstall')
          return inner.guards.uninstall(company)
        },
      },
    },
  }
}

/** 已建单的闸后栈（多数用例的前置：T-1 在平台上） */
function gatedWithTicket(): { cp: CountingFake; gated: FlowPlatform; gw: Gateway } {
  const cp = countingPlatform()
  const { gw } = makeGateway()
  const gated = createGatedPlatform(cp.platform, gw, { ctx: CTX, author: AUTHOR })
  return { cp, gated, gw }
}

describe('覆盖面：FlowPlatform 全方法二分（过闸 ∪ 直通，结构穷尽）', () => {
  test('十七方法无遗漏无重叠——裸 fake 的方法键集 == 两清单并集', () => {
    const actual = new Set<string>()
    for (const [face, methods] of Object.entries(createFakePlatform())) {
      for (const name of Object.keys(methods as Record<string, unknown>)) actual.add(`${face}.${name}`)
    }
    const declared = new Set<string>([...GATED_WRITE_METHODS, ...PASSTHROUGH_READ_METHODS])
    expect(actual).toEqual(declared)
    expect(actual.size).toBe(17)
    expect(GATED_WRITE_METHODS.filter((m) => (PASSTHROUGH_READ_METHODS as readonly string[]).includes(m))).toEqual([])
  })
})

describe('写面被闸：合法 control key 过且底层平台被调（副作用真发生）', () => {
  test('issues.create：过闸建单（计数 +1，返回记录）', async () => {
    const { cp, gated } = gatedWithTicket()
    const rec = await gated.issues.create({ title: '闸后建单', type: 'task', level: 0 })
    expect(cp.counts['issues.create']).toBe(1)
    expect(rec.id).toBe('T-1')
    expect(rec.state).toBe('新单')
  })

  test('issues.transition / issues.setField：过闸迁移与字段写', async () => {
    const { cp, gated } = gatedWithTicket()
    const rec = await gated.issues.create({ title: 't', type: 'task', level: 0 })
    expect((await gated.issues.transition(rec.id, '已派发')).state).toBe('已派发')
    await gated.issues.setField(rec.id, 'lane', 'extra')
    expect((await gated.issues.get(rec.id)).lane).toBe('extra')
    expect(cp.counts['issues.transition']).toBe(1)
    expect(cp.counts['issues.setField']).toBe(1)
  })

  test('links.link：过闸建链（children 回读验证）', async () => {
    const { cp, gated } = gatedWithTicket()
    const parent = await gated.issues.create({ title: '父', type: 'task', level: 0 })
    const child = await gated.issues.create({ title: '子', type: 'task', level: 0, parent: parent.id })
    await gated.links.link(parent.id, child.id, 'parent-child')
    expect(await gated.links.children(parent.id)).toEqual([child.id])
    expect(cp.counts['links.link']).toBe(1)
  })

  test('comments.add：署名组装形状——author/落款=daemon 侧身份，调用方自带身份被忽略，@action 信封不落库', async () => {
    const { cp, gated } = gatedWithTicket()
    const rec = await gated.issues.create({ title: 't', type: 'task', level: 0 })
    await gated.comments.add(rec.id, { author: 'FAKER', body: '完成，证据已落盘', signature: '[伪造·落款]' })
    expect(cp.commentBodies).toEqual([{ author: AUTHOR, body: '完成，证据已落盘', signature: '[指尖游戏·平台部·控制面·9]' }])
    // 平台侧回读（读面直通）：author=工号派生口径
    expect((await gated.comments.list(rec.id))[0]?.author).toBe(AUTHOR)
    expect(cp.counts['comments.add']).toBe(1)
  })

  test('kb.upsert / fields.provision / guards.install / guards.uninstall：逐一过闸', async () => {
    const { cp, gated } = gatedWithTicket()
    await gated.kb.upsert('kb/patrol.md', '# 巡逻纪要')
    expect(await gated.kb.get('kb/patrol.md')).toBe('# 巡逻纪要')
    await gated.fields.provision({ fields: { dept: '部门' }, states: ['新单', '已派发'], stateFlow: { 新单: ['已派发'] } })
    await gated.guards.install('demo', [{ from: '新单', to: '已派发' }])
    await gated.guards.uninstall('demo')
    expect(cp.counts['kb.upsert']).toBe(1)
    expect(cp.counts['fields.provision']).toBe(1)
    expect(cp.counts['guards.install']).toBe(1)
    expect(cp.counts['guards.uninstall']).toBe(1)
  })

  test('一调用一签发：连续多次写均过（每次现铸新 key，nonce 不相撞）', async () => {
    const { cp, gated } = gatedWithTicket()
    const rec = await gated.issues.create({ title: 't', type: 'task', level: 0 })
    await gated.issues.transition(rec.id, '已派发')
    await gated.issues.transition(rec.id, '证据就绪')
    await gated.issues.setField(rec.id, 'lane', 'core')
    expect(cp.counts['issues.transition']).toBe(2)
    expect(cp.counts['issues.setField']).toBe(1)
  })
})

describe('坏 token 拒：fail-closed——底层平台未被调用', () => {
  test('garbage token → gw-verify-malformed；create/transition/add 三写面计数零增', async () => {
    const cp = countingPlatform()
    const { gw } = makeGateway()
    const gated = createGatedPlatform(cp.platform, gw, { ctx: CTX, author: AUTHOR, mintControlKey: () => 'garbage' })
    await expect(gated.issues.create({ title: 't', level: 0 })).rejects.toThrow(/gw-verify-malformed/)
    await expect(gated.issues.transition('T-1', '已派发')).rejects.toThrow(/gw-verify-malformed/)
    await expect(gated.comments.add('T-1', { author: AUTHOR, body: 'x', signature: 's' })).rejects.toThrow(/gw-verify-malformed/)
    expect(cp.counts['issues.create'] ?? 0).toBe(0)
    expect(cp.counts['issues.transition'] ?? 0).toBe(0)
    expect(cp.counts['comments.add'] ?? 0).toBe(0)
  })

  test('按单 wkey 跨控制面闸 → gw-verify-ticket-mismatch；底层未调', async () => {
    const cp = countingPlatform()
    const { gw } = makeGateway()
    // 按单 key（单号 2-100）打到控制面闸（CONTROL_TICKET 实例）——单号绑定互斥
    const perTicket = gw.issue({ ticket: '2-100', scope: ['comment'], ttl: '5m', nonce: 'n-x' })
    const gated = createGatedPlatform(cp.platform, gw, { ctx: CTX, author: AUTHOR, mintControlKey: () => perTicket })
    await expect(gated.kb.upsert('kb/a.md', 'x')).rejects.toThrow(/gw-verify-ticket-mismatch/)
    expect(cp.counts['kb.upsert'] ?? 0).toBe(0)
  })

  test('同 token 重放 → gw-verify-replay（固定铸器直证「一调用一签发」的必要性）；底层未调', async () => {
    const cp = countingPlatform()
    const { gw } = makeGateway()
    const fixed = gw.issueControlKey()
    const gated = createGatedPlatform(cp.platform, gw, { ctx: CTX, author: AUTHOR, mintControlKey: () => fixed })
    await gated.issues.create({ title: '第一次过', level: 0 })
    await expect(gated.issues.create({ title: '第二次必拒', level: 0 })).rejects.toThrow(/gw-verify-replay/)
    expect(cp.counts['issues.create']).toBe(1)
  })
})

describe('控制面 key 生命周期：吊销后全拒（kill switch）', () => {
  test('revoke(CONTROL_TICKET) 后九写面全拒（gw-verify-revoked）且底层计数不变', async () => {
    const { cp, gated, gw } = gatedWithTicket()
    const rec = await gated.issues.create({ title: 't', type: 'task', level: 0 }) // 吊销前正常
    gw.revoke(CONTROL_TICKET)
    const before = { ...cp.counts }
    await expect(gated.issues.create({ title: 'x', level: 0 })).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.issues.transition(rec.id, '已派发')).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.issues.setField(rec.id, 'lane', 'core')).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.comments.add(rec.id, { author: AUTHOR, body: 'x', signature: 's' })).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.kb.upsert('kb/a.md', 'x')).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.fields.provision({ fields: {}, states: [], stateFlow: {} })).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.links.link('T-1', 'T-1', 'relates-to')).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.guards.install('demo', [])).rejects.toThrow(/gw-verify-revoked/)
    await expect(gated.guards.uninstall('demo')).rejects.toThrow(/gw-verify-revoked/)
    expect(cp.counts).toEqual(before) // 吊销后零新增调用（含吊销前那次 create 的 1）
  })

  test('吊销后读面仍直通（读与闸无涉的双证）', async () => {
    const { gated, gw } = gatedWithTicket()
    const rec = await gated.issues.create({ title: 't', type: 'task', level: 0 })
    gw.revoke(CONTROL_TICKET)
    expect((await gated.issues.get(rec.id)).id).toBe(rec.id)
    expect((await gated.issues.list({})).length).toBe(1)
    expect((await gated.comments.list(rec.id)).length).toBe(0)
    expect((await gated.activity.since(null)).items.length).toBeGreaterThan(0)
    expect((await gated.fields.schema()).length).toBeGreaterThan(0)
  })
})

describe('读面直通：结果与裸 fake 一致', () => {
  test('八读面（list/get/comments.list/fields.schema/kb.search/kb.get/activity.since/links.children）形状与裸实现一致', async () => {
    const { gated } = gatedWithTicket()
    const rec = await gated.issues.create({ title: '读面对照', type: 'task', level: 0 })
    const child = await gated.issues.create({ title: '子', type: 'task', level: 0, parent: rec.id })
    await gated.comments.add(rec.id, { author: AUTHOR, body: '正文', signature: 's' })
    await gated.kb.upsert('kb/x.md', '内容片段')

    const list = await gated.issues.list({ stateIn: ['新单'] })
    expect(list.map((i) => i.id)).toEqual([rec.id, child.id])
    expect(await gated.issues.get(rec.id)).toMatchObject({ id: rec.id, title: '读面对照' })
    expect((await gated.comments.list(rec.id)).map((c) => c.body)).toEqual(['正文'])
    expect((await gated.fields.schema()).map((f) => f.name)).toContain('state')
    expect((await gated.kb.search('片段')).map((h) => h.path)).toEqual(['kb/x.md'])
    expect(await gated.kb.get('kb/x.md')).toBe('内容片段')
    const page = await gated.activity.since(null)
    expect(page.items.length).toBeGreaterThanOrEqual(4) // 2 建单 + 1 评论 + 1 kb（写面副产活动）
    expect(page.nextCursor).not.toBeNull()
    expect(await gated.links.children(rec.id)).toEqual([child.id])
  })
})

describe('错误两级分类（17-§9 通道对齐）', () => {
  test('运行期拒绝：ClassifiedError 形（category=EXTERNAL_REJECT、subcause=gw-*）', async () => {
    const cp = countingPlatform()
    const { gw } = makeGateway()
    const gated = createGatedPlatform(cp.platform, gw, { ctx: CTX, author: AUTHOR, mintControlKey: () => 'garbage' })
    const err = await gated.issues.create({ title: 't', level: 0 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(Error)
    const classified = err as Error & { category?: string; subcause?: string; detail?: string }
    expect(classified.category).toBe('EXTERNAL_REJECT')
    expect(classified.subcause).toMatch(/^gw-verify-/)
    expect(classified.detail).toContain('底层平台未被调用')
    expect(classified.message).toMatch(/^EXTERNAL_REJECT\/gw-/)
  })

  test('构造期非法：空工号/坏署名上下文抛 CONFIG_INVALID（两级分类的构造级）', () => {
    const cp = countingPlatform()
    const { gw } = makeGateway()
    expect(() => createGatedPlatform(cp.platform, gw, { ctx: CTX, author: '' })).toThrowError(/CONFIG_INVALID\/gwp-empty-author/)
    expect(() => createGatedPlatform(cp.platform, gw, { ctx: { ...CTX, company: '' }, author: AUTHOR })).toThrowError(/CONFIG_INVALID\/gw-signature-/)
    expect(() => createGatedPlatform(cp.platform, gw, { ctx: { ...CTX, level: 0 }, author: AUTHOR })).toThrowError(/CONFIG_INVALID\/gw-signature-bad-level/)
  })
})

// ————————————————————————— demo e2e 回归：经闸全链 —————————————————————————

/** 手工最小快照（serve.ts DEMO_SNAPSHOT 同形——单部门单人） */
const SNAPSHOT: CompanySnapshot = {
  slug: 'gated-demo',
  name: 'Gated 演示公司',
  level: 2,
  charter: 'charter.md',
  platform: { platform: 'localfile' },
  departments: [
    { name: '工程部', path: 'departments/工程部', parent: null, leader: 'AGENT-1', level: 2, lanes: ['core'], functions: ['交付'], relations: [] },
  ],
  people: [{ id: 'AGENT-1', name: '示例工程师', login: 'agent-1', level: 2, dept: 'departments/工程部' } as PersonRef],
  jobs: [],
}

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-gated-e2e-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('demo e2e 回归：经闸后全链仍绿（engine 零改动，包装器透明）', () => {
  let ledger: Ledger
  let engine: Engine
  let cp: CountingFake
  let gated: FlowPlatform
  let mints: number
  /** engine 与 gateway 共用的时间源（每拍步进——收割静默判定与 key 时效同一时钟） */
  let now: number

  beforeAll(() => {
    ledger = openLedger(path.join(root, 'gated-e2e.sqlite'))
    cp = countingPlatform()
    now = Date.parse('2026-10-16T00:00:00.000Z')
    const gw = createGateway({ secret: SECRET, clock: () => now, ticket: CONTROL_TICKET, ctx: CTX, author: AUTHOR })
    mints = 0
    gated = createGatedPlatform(cp.platform, gw, {
      ctx: CTX,
      author: AUTHOR,
      mintControlKey: (): string => {
        mints += 1
        return gw.issueControlKey()
      },
    })
    const registry = createRegistry()
    registry.register(createFakeAdapter(), { default: true })
    engine = createEngine({
      platform: gated,
      ledger,
      registry,
      assembler: createDefaultAssembler({
        fwkVersion: 'v0.5-demo',
        frameworkPrompts: '你是 demo worker：按任务书产出 REPORT 与 summary。',
        snapshot: SNAPSHOT,
        acceptance: ['echo demo-ok'],
        docRefs: ['docs/17-§2（主循环七相位）'],
      }),
      gateRunner: createDefaultGateRunner(),
      clock: (): number => now,
      config: {
        ...ENGINE_CONFIG_DEFAULTS,
        company: SNAPSHOT.slug,
        rootDir: path.join(root, 'ws'),
        defaultPersonId: (SNAPSHOT.people[0] as PersonRef).id,
        deptFallback: SNAPSHOT.departments[0]?.path ?? 'departments/工程部',
        defaultLane: SNAPSHOT.departments[0]?.lanes[0] ?? 'core',
      },
      people: SNAPSHOT.people,
    })
  })

  afterAll(() => {
    ledger.close()
  })

  test('全链五拍：DISPATCH → GATE_PASS → QA_PASS → MERGE → CLOSE（平台状态同步迁移，零错误）', async () => {
    const created = await gated.issues.create({ title: '闸后全链单', type: 'task', level: 0, dept: 'departments/工程部', assignee: 'AGENT-1' })
    const states: string[] = ['已派发', '证据就绪', '复验通过', '已交付', '已交付']
    const events: string[] = []
    for (let i = 0; i < 5; i += 1) {
      now += 1000
      const report = await engine.tick()
      expect(report.errors).toEqual([])
      events.push(...report.events.filter((e) => e.issue === created.id).map((e) => e.event))
      expect((await gated.issues.get(created.id)).state).toBe(states[i])
    }
    expect(events.filter((e) => e !== 'HEARTBEAT')).toEqual(['DISPATCH', 'GATE_PASS', 'QA_PASS', 'MERGE', 'CLOSE'])
    expect((await gated.issues.get(created.id)).state).toBe('已交付')
  })

  test('经闸写计数与铸 key 计数对账：1 建单 + 4 迁移 = 5 铸（读面零铸）', () => {
    expect(cp.counts['issues.create']).toBe(1)
    expect(cp.counts['issues.transition']).toBe(4)
    expect(mints).toBe(5)
  })
})
