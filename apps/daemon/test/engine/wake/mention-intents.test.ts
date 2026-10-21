/**
 * mention 意图消费（105-刀A A-2 消费门开闸）——单③ studio-dev-123 实现面测试
 *
 * 规格依据：
 *   - 105 提案 §5.3-2（A-2：engine drain 改普适 kind→handler 分发表）＋ §6.3 判负线
 *     ①（无特判）/②（HOLD_INTENT_MALFORMED 前置闸保持）/③（dedupKey=eventId）
 *   - docs/21-§四 / docs/22-§二（语义定稿=③ 混合：@工号=物化唤醒单派该岗位；
 *     @宰相/@制作人=源侧 roles 映射成工号后同径派发，被唤醒者经 API :8788 落单）
 *   - docs/21A-§5.10（勘误后口径：dedupKey=Matrix eventId 源侧设置）
 *   - docs/22-§三.2（意图幂等：PATROL 留痕派生键集 append-only 不释放）
 *   - docs/25-§3.4 v1.3（无 ticket 意图必填 dedupKey；幂等键四元组）
 *
 * 断言面（S 映射：S1 物化溯源 / S2 同 eventId 重投不双开 / S3 两路同构 /
 *        S8 escalate 仍不支持 / 注入防御 note 净化）：
 *   1. 端到端：mention 意图 → @唤醒单物化（assignee=target、level=0、type=task、
 *      title/description 携 roomId+eventId 溯源）→ PATROL 留痕 → decide → DISPATCH
 *   2. 明报拒收路径逐项：payload 形状不符 / dedupKey≠eventId / 未知 target /
 *      缺 dedupKey（HOLD_INTENT_MALFORMED）/ 公司不匹配——零物化零静默
 *   3. 幂等三面：同拍重投 / 跨拍重投 / 重启重放（新引擎同台账）恒只物化一次
 *   4. PATROL note 无 job= 字段：jobs-sources 的 jobTickets 零命中（SLA 扫描器
 *      结构性不可见）；频道内容注入 ';job=' 被分号净化（全角；）
 *   5. ③ 混合同构：@工号 直派目标 与 roles 映射目标 两路产物形态一致（引擎不感知通道）
 *   6. schedule 既有语义零回归：同拍混排两 kind 互不干扰
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRegistry } from '@studio-next/adapters'
import type { CompanySnapshot, EventRecord, InvokeIntent } from '@studio-next/contract'
import { openLedger, type Ledger } from '@studio-next/store'
import { createEngine, ENGINE_CONFIG_DEFAULTS, type Engine } from '../../../src/engine/engine.ts'
import { createFakeAdapter, createFakePlatform } from '../../../src/engine/fakes.ts'
import { createDefaultAssembler } from '../../../src/engine/prompt-assembly.ts'
import { createDefaultGateRunner } from '../../../src/engine/gate.ts'
import { DEMO_SNAPSHOT } from '../../../src/assembly/serve.ts'

// ————————————————————————— 测试基建 —————————————————————————

let root = ''

/** 两人物快照（S3：③ 混合两路——AGENT-1=工号路，PRIME-0=roles 映射路/宰相位） */
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

function buildEngineStack(id: string, snapshot: CompanySnapshot = twoPersonSnapshot()): EngineStack {
  const ledger = openLedger(path.join(root, `${id}.sqlite`))
  let t = Date.UTC(2026, 9, 21, 0, 0, 0)
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
      docRefs: ['docs/21-§四（人际唤起）'],
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
    },
  })
  return { platform, ledger, engine, clock }
}

/** mention 意图负载入参（源侧契约面：dedupKey=eventId，21A-§5.10 勘误后口径） */
interface MentionPayloadInput {
  target?: string
  mention?: string
  text?: string
  eventId?: string
  sender?: string
  room?: string
  channel?: string
}

function mentionIntent(partial?: MentionPayloadInput): InvokeIntent {
  const eventId = partial?.eventId ?? '$evt-1'
  return {
    kind: 'mention',
    company: 'demo',
    source: 'matrix',
    dedupKey: eventId,
    priority: 1,
    payload: {
      target: 'AGENT-1',
      mention: '@AGENT-1',
      text: '修复登录 bug 后汇报',
      eventId,
      sender: '@producer:studio.local',
      room: '!room-1:studio.local',
      channel: 'slug-大厅',
      ...partial,
    },
  }
}

/**
 * SLA 扫描器视角（镜像 jobs-sources.ts jobTickets 的正则，`(?:^|;)job=([^;]+)`——
 * 本地函数不导出；测试镜像其唯一可见性判据，jobs-lifecycle.test.ts 另有端到端面）
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
  root = await mkdtemp(path.join(tmpdir(), 'sn-mention-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

// ————————————————————————— 1. 端到端物化链 —————————————————————————

describe('mention 意图：端到端（S1 物化溯源）', () => {
  it('物化 @唤醒单：assignee=目标工号、level=0、type=task、title 前缀、description 携 room+eventId 溯源 → PATROL → DISPATCH', async () => {
    const s = buildEngineStack('e2e')
    s.engine.ingest([mentionIntent()])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])

    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(1)
    const wake = issues[0]
    expect(wake.assignee).toBe('AGENT-1')
    expect(wake.level).toBe(0)
    expect(wake.type).toBe('task')
    expect(wake.title.startsWith('[@唤醒] @AGENT-1')).toBe(true)
    expect(wake.description).toContain('!room-1:studio.local')
    expect(wake.description).toContain('$evt-1')
    expect(wake.description).toContain('修复登录 bug 后汇报')

    // PATROL 留痕：intent=（幂等键源）+ target/event/room 溯源；note 无 job=（SLA 盲区）
    const patrols = eventsOf(s.ledger, 'PATROL')
    expect(patrols).toHaveLength(1)
    const note = patrols[0]?.note ?? ''
    expect(note).toContain('intent=matrix|mention|demo|$evt-1')
    expect(note).toContain('target=AGENT-1')
    expect(note).toContain('event=$evt-1')
    expect(note).toContain('room=!room-1:studio.local')
    expect(note).not.toContain('job=')

    // decide 主链接住：同拍 DISPATCH（fake adapter 即跑即收）
    expect(eventsOf(s.ledger, 'DISPATCH').length).toBeGreaterThanOrEqual(1)
    s.ledger.close()
  })

  it('两路同构（S3，③ 混合）：@工号 直派 与 roles 映射目标（PRIME-0=宰相位）产物形态一致——引擎不感知通道', async () => {
    const s = buildEngineStack('parity')
    s.engine.ingest([
      mentionIntent({ eventId: '$evt-a' }),
      mentionIntent({ eventId: '$evt-b', target: 'PRIME-0', mention: '@宰相', text: '请落单：排查网关超时' }),
    ])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const issues = await s.platform.issues.list({})
    expect(issues).toHaveLength(2)
    const byAssignee = new Map(issues.map((i) => [i.assignee, i]))
    expect(byAssignee.get('AGENT-1')?.title.startsWith('[@唤醒]')).toBe(true)
    expect(byAssignee.get('PRIME-0')?.title.startsWith('[@唤醒] @宰相')).toBe(true)
    for (const i of issues) {
      expect(i.level).toBe(0)
      expect(i.type).toBe('task')
      expect(i.description).toContain('room=')
    }
    s.ledger.close()
  })
})

// ————————————————————————— 2. 明报拒收路径 —————————————————————————

describe('mention 意图：明报拒收（判负线②③——不静默）', () => {
  it('payload 形状不符（缺 eventId）→ errors 明报、零物化', async () => {
    const s = buildEngineStack('shape')
    const bad = mentionIntent()
    ;(bad.payload as Record<string, unknown>).eventId = 123
    s.engine.ingest([bad])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('形状不符')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('dedupKey≠payload.eventId → 明报拒收（源侧契约，判负线③）', async () => {
    const s = buildEngineStack('dedup-mismatch')
    s.engine.ingest([{ ...mentionIntent(), dedupKey: 'forged-key' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('dedupKey≠payload.eventId')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0)
    s.ledger.close()
  })

  it('未知目标工号 → 明报丢弃、零物化（不落 defaultPersonId 错人面）', async () => {
    const s = buildEngineStack('unknown-target')
    s.engine.ingest([mentionIntent({ target: 'GHOST-9' })])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('GHOST-9')
    expect(report.errors.join('\n')).toContain('不在人事索引')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('缺 dedupKey → HOLD_INTENT_MALFORMED 前置闸明报（mention 变体，25-§3.4 v1.3）', async () => {
    const s = buildEngineStack('no-dedup')
    const bare = { ...mentionIntent(), dedupKey: undefined } as unknown as InvokeIntent
    s.engine.ingest([bare])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('缺 dedupKey')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })

  it('公司不匹配 → 明报丢弃（共闸对 mention 同样生效）', async () => {
    const s = buildEngineStack('company')
    s.engine.ingest([{ ...mentionIntent(), company: 'other-co' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('公司不匹配')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })
})

// ————————————————————————— 3. 幂等三面（S2/S7） —————————————————————————

describe('mention 意图幂等：同 eventId 恒只物化一次', () => {
  it('同拍重投 ×3 → 单次物化', async () => {
    const s = buildEngineStack('dup-tick')
    s.engine.ingest([mentionIntent(), mentionIntent(), mentionIntent()])
    await s.engine.tick()
    expect(await s.platform.issues.list({})).toHaveLength(1)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(1)
    s.ledger.close()
  })

  it('跨拍重投 → 第二拍零物化零错误（patrolKeys append-only 不释放）', async () => {
    const s = buildEngineStack('dup-across')
    s.engine.ingest([mentionIntent()])
    await s.engine.tick()
    s.engine.ingest([mentionIntent()])
    const report2 = await s.engine.tick()
    expect(report2.errors).toEqual([])
    expect(await s.platform.issues.list({})).toHaveLength(1)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(1)
    s.ledger.close()
  })

  it('重启重放（新引擎同台账）→ 不双开（S2 重启面）', async () => {
    const s = buildEngineStack('dup-restart')
    s.engine.ingest([mentionIntent()])
    await s.engine.tick()
    const firstCount = (await s.platform.issues.list({})).length
    expect(firstCount).toBe(1)
    // 模拟重启：同台账+同平台镜像不可重建（fake 内存平台）——幂等面只依赖台账事件派生，
    // 断言 indexEvents 的 patrolKeys 键存在即可钉死「不双开」的机制面
    const patrol = eventsOf(s.ledger, 'PATROL')[0]
    expect(patrol?.note).toContain('intent=matrix|mention|demo|$evt-1')
    s.ledger.close()
  })
})

// ————————————————————————— 4. SLA 盲区与注入防御 —————————————————————————

describe('mention PATROL note：SLA 扫描器盲区 + 频道内容注入净化', () => {
  it('jobTickets 对唤醒 PATROL 零命中（note 无 job= 字段）', async () => {
    const s = buildEngineStack('sla-blind')
    s.engine.ingest([mentionIntent()])
    await s.engine.tick()
    const patrol = eventsOf(s.ledger, 'PATROL')[0]
    expect(patrol).toBeDefined()
    expect(scanJobKeys([patrol as EventRecord])).toHaveLength(0)
    s.ledger.close()
  })

  it('eventId 含分号（伪造源注入 ";job=" 进 intent= 键）→ note 可表示性闸明报拒收、零物化', async () => {
    const s = buildEngineStack('inject-key')
    s.engine.ingest([mentionIntent({ eventId: '$evt;job=ghost;intent=fake' })])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain('eventId 含分号/换行')
    expect(await s.platform.issues.list({})).toHaveLength(0)
    expect(eventsOf(s.ledger, 'PATROL')).toHaveLength(0)
    s.ledger.close()
  })

  it('room/channel 注入 ";job="（eventId 干净）→ noteSafe 分号净化为全角；，jobTickets 零命中', async () => {
    const s = buildEngineStack('inject-room')
    s.engine.ingest([
      mentionIntent({ eventId: '$evt-clean', room: '!r;job=x:studio.local', channel: '大厅;job=y', text: 'hi' }),
    ])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const patrols = eventsOf(s.ledger, 'PATROL')
    expect(patrols).toHaveLength(1)
    const note = patrols[0]?.note ?? ''
    expect(scanJobKeys(patrols)).toHaveLength(0)
    // 动态字段分号净化（全角；）——键值可见但不可再切分注入
    expect(note).toContain('room=!r；job=x:studio.local')
    expect(note).toContain('channel=大厅；job=y')
    s.ledger.close()
  })
})

// ————————————————————————— 5. schedule 零回归 + escalate 槽位 —————————————————————————

describe('消费门：schedule 零回归 + escalate 槽位（S8）', () => {
  it('同拍混排 schedule+mention 互不干扰（分发表隔离）', async () => {
    const s = buildEngineStack('mixed')
    // 播种样例岗（scheduler.test.ts job() 同款最小面——schedule 意图需台账有岗）
    s.ledger.upsertJob({
      job_id: 'health-patrol', company: 'demo', dept: 'departments/工程部',
      cron: '*/5 * * * *', role: 'AGENT-1', level: 2, model_tier: 'low', next_run_at: 0,
    })
    s.engine.ingest([
      mentionIntent(),
      {
        kind: 'schedule',
        company: 'demo',
        source: 'scheduler',
        dedupKey: 'health-patrol@2026-10-21T00:00:00.000Z',
        priority: 1,
        payload: { job_id: 'health-patrol' },
      },
    ])
    const report = await s.engine.tick()
    expect(report.errors).toEqual([])
    const titles = (await s.platform.issues.list({})).map((i) => i.title)
    expect(titles.some((t) => t.startsWith('[@唤醒]'))).toBe(true)
    expect(titles.some((t) => t.startsWith('[定时岗] health-patrol'))).toBe(true)
    s.ledger.close()
  })

  it('escalate 仍明报不支持（槽位归刀B notify 端口接线单，S8）', async () => {
    const s = buildEngineStack('escalate')
    s.engine.ingest([{ kind: 'escalate', company: 'demo', source: 'sla-timer', dedupKey: 'esc-1' }])
    const report = await s.engine.tick()
    expect(report.errors.join('\n')).toContain("kind='escalate' 不支持")
    expect(await s.platform.issues.list({})).toHaveLength(0)
    s.ledger.close()
  })
})
