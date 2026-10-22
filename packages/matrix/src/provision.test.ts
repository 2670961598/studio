/**
 * provision 单测（130-P3 频道供给扩展，130 提案 §6.7／DEV-20 §5.1-§5.4 冻结基座）：
 * 八类地图规划快照（§6.7.1 全表照录）/ PL 基线三列（§5.3 照录）/ ensure 幂等收敛
 * （§5.4——S8 判负线=重跑漂移：状态机 FakeSynapse 首拍建齐、次拍零写）/ 手工提权
 * 单写者收口 / invite M_FORBIDDEN 吸收 / 单据房间生命周期（D7 成员＋P10 归档只读）。
 * 零真实网络（Structural ProvisionClient 注入——Synapse 未部署，协议形状按本测钉死）。
 */
import { describe, expect, it } from 'vitest'
import {
  ARCHIVED_PREFIX,
  archiveTicketRoom,
  createMatrixProvisionFace,
  ensureCompanyChannels,
  ensureTicketRoom,
  mxidOf,
  planChannelMap,
  powerLevelTarget,
  resolveTicketMembers,
  ticketAliasLocalpart,
  ticketRoomName,
  type ChannelMapInput,
  type ProvisionClient,
} from './provision.ts'

// ————————————————————————— 状态机 FakeSynapse（Structural ProvisionClient） —————————————————————————

interface FakeRoom {
  roomId: string
  alias?: string
  name?: string
  state: Map<string, Record<string, unknown>> // `${type}|${stateKey}` → content
  memberships: Map<string, 'join' | 'invite'> // mxid → membership
}

/** 变更操作日志（幂等判据：重跑拍应为空——读不算漂移） */
type Op = { op: 'createRoom' | 'invite' | 'sendState'; detail: string }

class FakeSynapse implements ProvisionClient {
  rooms: FakeRoom[] = []
  byAlias = new Map<string, FakeRoom>()
  ops: Op[] = []
  private seq = 0
  /** invite 全员 M_FORBIDDEN（服务端名单视图滞后模拟——§5.4 冲突≈已达成吸收面） */
  inviteAlwaysForbidden = false
  /** invite 路由直接置废（模拟网络层硬失败——非 M_FORBIDDEN 如实上抛） */
  inviteHardFail = false

  private roomOf(roomId: string): FakeRoom {
    const r = this.rooms.find((x) => x.roomId === roomId)
    if (r === undefined) throw new Error(`M_NOT_FOUND fake：无房间 ${roomId}（404）`)
    return r
  }

  async createRoom(opts: {
    name: string
    aliasName?: string
    initialState?: ReadonlyArray<{ type: string; stateKey?: string; content: unknown }>
  }): Promise<{ roomId: string }> {
    this.seq += 1
    const room: FakeRoom = {
      roomId: `!r${this.seq}:mx.test`,
      name: opts.name,
      state: new Map(),
      memberships: new Map(),
    }
    if (opts.aliasName !== undefined) {
      room.alias = `#${opts.aliasName}:mx.test`
      this.byAlias.set(room.alias, room)
    }
    // Synapse 形状：name 参数 → m.room.name state 事件；creator（bot 登录态）join +
    // 缺省 PL（与目标基线**有意不同**——首拍必写）
    if (opts.name !== undefined) room.state.set('m.room.name|', { name: opts.name })
    room.memberships.set('@gateway:mx.test', 'join')
    room.state.set('m.room.power_levels|', {
      users_default: 0,
      users: { '@gateway:mx.test': 100 },
      events_default: 0,
      state_default: 50,
      invite: 0,
      kick: 50,
      ban: 50,
      redact: 50,
      events: {},
    })
    for (const ev of opts.initialState ?? []) {
      room.state.set(`${ev.type}|${ev.stateKey ?? ''}`, ev.content as Record<string, unknown>)
    }
    this.rooms.push(room)
    this.ops.push({ op: 'createRoom', detail: `${room.roomId} ${opts.aliasName ?? '(no alias)'}` })
    return { roomId: room.roomId }
  }

  async resolveAlias(alias: string): Promise<string> {
    const r = this.byAlias.get(alias)
    if (r === undefined) throw new Error('M_NOT_FOUND：别名未挂（404）')
    return r.roomId
  }

  async joinRoom(roomIdOrAlias: string): Promise<void> {
    const r = this.rooms.find((x) => x.roomId === roomIdOrAlias) ?? this.byAlias.get(roomIdOrAlias)
    if (r === undefined) throw new Error('M_NOT_FOUND：无房间（404）')
    r.memberships.set('@gateway:mx.test', 'join') // 幂等重入（不记 op——重跑零漂移判据）
  }

  async invite(roomId: string, userId: string): Promise<void> {
    const r = this.roomOf(roomId)
    if (this.inviteHardFail) throw new Error('M_UNKNOWN：invite 网络故障')
    const cur = r.memberships.get(userId)
    if (cur === 'join' || cur === 'invite') throw new Error('M_FORBIDDEN：已在房/已受邀')
    if (this.inviteAlwaysForbidden) throw new Error('M_FORBIDDEN：名单视图滞后（吸收面）')
    r.memberships.set(userId, 'invite')
    this.ops.push({ op: 'invite', detail: `${roomId} ${userId}` })
  }

  async listMembers(roomId: string, membership: 'join' | 'invite' | 'leave' | 'ban'): Promise<string[]> {
    const r = this.roomOf(roomId)
    if (membership !== 'join' && membership !== 'invite') return []
    return [...r.memberships.entries()].filter(([, m]) => m === membership).map(([mxid]) => mxid)
  }

  async getFullPowerLevels(roomId: string): Promise<Record<string, unknown>> {
    const r = this.roomOf(roomId)
    return { ...(r.state.get('m.room.power_levels|') as Record<string, unknown>) }
  }

  async getStateEvent(roomId: string, type: string, stateKey: string): Promise<Record<string, unknown>> {
    const r = this.roomOf(roomId)
    const hit = r.state.get(`${type}|${stateKey}`)
    if (hit === undefined) throw new Error('M_NOT_FOUND：无此 state（404）')
    return { ...hit }
  }

  async sendStateEvent(roomId: string, type: string, stateKey: string, content: unknown): Promise<void> {
    const r = this.roomOf(roomId)
    r.state.set(`${type}|${stateKey}`, content as Record<string, unknown>)
    this.ops.push({ op: 'sendState', detail: `${roomId} ${type} ${stateKey}` })
  }

  /** 测试钩：清 op 日志（分拍断言用） */
  resetOps(): void {
    this.ops = []
  }
}

// ————————————————————————— studio-dev 实例形夹具 —————————————————————————

const BOT = '@gateway:mx.test'
const PRODUCER = '@opengames:localhost'

const PEOPLE = [
  { id: 'ENG-0', login: 'eng-0', dept: 'departments/研发部', role: '研发部长' },
  { id: 'PLN-1', login: 'pln-1', dept: 'departments/研发部', role: '策划' },
  { id: 'ENG-6', login: 'eng-6', dept: 'departments/研发部', role: '程序工程师' },
  { id: 'QA-1', login: 'qa-1', dept: 'departments/研发部', role: 'QA' },
  { id: 'HR-1', login: 'hr-1', dept: 'departments/研发部', role: '人事财务岗', status: 'retired' },
] as const

function inputOf(over: Partial<ChannelMapInput> = {}): ChannelMapInput {
  return {
    slug: 'studio-dev',
    companyName: 'StudioNext 开发公司',
    departments: [{ path: 'departments/研发部', name: '研发部', leader: 'ENG-0' }],
    people: PEOPLE.map((p) => ({ ...p })),
    groups: [
      { id: 'pln', dept: 'departments/研发部', name: '研发部-策划组', leader: 'PLN-1', members: ['PLN-1'] },
      { id: 'eng', dept: 'departments/研发部', name: '研发部-工程组', members: ['ENG-6'] },
      { id: 'qa', dept: 'departments/研发部', name: '研发部-质检组', members: ['QA-1'] },
    ],
    invitePaceMs: 0,
    deptSlugs: { 'departments/研发部': 'rd' },
    botMxid: BOT,
    producerMxid: PRODUCER,
    ...over,
  }
}

// ————————————————————————— PL 基线（DEV-20 §5.3 照录） —————————————————————————

describe('powerLevelTarget（§5.3 三列基线照录）', () => {
  it('大厅/告警列：redact=100、无 50 槽、producer=100（creator 隐含）、结构性事件全 100', () => {
    const t = powerLevelTarget('hall', { botMxid: BOT, producerMxid: PRODUCER })
    expect(t).toEqual({
      users_default: 0,
      users: { [PRODUCER]: 100 }, // creator(bot) 隐含 PL100 不列（2026-10-23 修正——Synapse 禁列 creator）
      events_default: 0,
      state_default: 100,
      invite: 100,
      kick: 100,
      ban: 100,
      redact: 100,
      events: {
        'm.room.name': 100,
        'm.room.canonical_alias': 100,
        'm.room.power_levels': 100,
        'm.room.history_visibility': 100,
        'm.room.tombstone': 100,
        'm.room.encryption': 100,
        'm.room.server_acl': 100,
        'm.space.child': 100,
      },
    })
  })

  it('部门频道列：redact=50＋主管 50 槽（21-§三:24 撤回处置面）', () => {
    const t = powerLevelTarget('dept', { botMxid: BOT, producerMxid: PRODUCER, moderatorMxid: '@eng-0:mx.test' })
    expect(t.redact).toBe(50)
    expect(t.users['@eng-0:mx.test']).toBe(50)
  })

  it('单据房间列：redact=100、无 50 槽', () => {
    const t = powerLevelTarget('ticket', { botMxid: BOT, producerMxid: PRODUCER })
    expect(t.redact).toBe(100)
    expect(Object.keys(t.users)).toHaveLength(1) // 仅 producer——creator 隐含不列
  })
})

// ————————————————————————— 八类地图规划（130 §6.7.1 全表） —————————————————————————

describe('planChannelMap（§6.7.1 八类地图＋父空间）', () => {
  it('studio-dev 实例形：八类频道别名/显示名/成员列全量快照', () => {
    const plan = planChannelMap(inputOf())
    expect(plan.space).toEqual({ alias: '#studio-dev:mx.test', name: 'StudioNext 开发公司' })
    expect(plan.problems).toEqual([])
    const byAlias = new Map(plan.channels.map((c) => [c.alias, c]))
    // 总览｜大厅｜告警｜部门 rd｜小组 rd-pln/rd-eng/rd-qa｜跨部门 = 8 房
    expect([...byAlias.keys()].sort()).toEqual(
      [
        '#studio-dev-overview:mx.test',
        '#studio-dev-hall:mx.test',
        '#studio-dev-alert:mx.test',
        '#studio-dev-rd:mx.test',
        '#studio-dev-rd-pln:mx.test',
        '#studio-dev-rd-eng:mx.test',
        '#studio-dev-rd-qa:mx.test',
        '#studio-dev-xfunc:mx.test',
      ].sort(),
    )
    // 成员推导：总览=主管+制作人；大厅/告警=在册全员（retired 剔除）+制作人（成员序=去重排序稳定序）
    expect(byAlias.get('#studio-dev-overview:mx.test')).toMatchObject({ name: '总览', members: ['@eng-0:mx.test', PRODUCER] })
    expect(byAlias.get('#studio-dev-hall:mx.test')?.members).toEqual([
      '@eng-0:mx.test', '@eng-6:mx.test', PRODUCER, '@pln-1:mx.test', '@qa-1:mx.test',
    ])
    expect(byAlias.get('#studio-dev-alert:mx.test')?.name).toBe('告警')
    // 部门频道：在册部门全员+制作人；50 槽=部门主管
    expect(byAlias.get('#studio-dev-rd:mx.test')).toMatchObject({
      name: '研发部', moderatorMxid: '@eng-0:mx.test', power: 'dept',
      members: ['@eng-0:mx.test', '@eng-6:mx.test', PRODUCER, '@pln-1:mx.test', '@qa-1:mx.test'],
    })
    // 小组频道：声明成员+制作人；组长 50 槽（未声明组长=槽空缺，不炸）
    expect(byAlias.get('#studio-dev-rd-pln:mx.test')).toMatchObject({
      name: '研发部-策划组', moderatorMxid: '@pln-1:mx.test', members: [PRODUCER, '@pln-1:mx.test'],
    })
    expect(byAlias.get('#studio-dev-rd-eng:mx.test')).toMatchObject({ name: '研发部-工程组', members: ['@eng-6:mx.test', PRODUCER] })
    expect(byAlias.get('#studio-dev-rd-eng:mx.test')?.moderatorMxid).toBeUndefined()
    // 跨部门：全部门主管+制作人（studio-dev 实例=研发部长，§6.7.1 表）
    expect(byAlias.get('#studio-dev-xfunc:mx.test')).toMatchObject({ name: '跨部门协作', members: ['@eng-0:mx.test', PRODUCER] })
  })

  it('部门缺 deptSlugs 映射：落 problems 软失败（该房不供给，其余照供）', () => {
    const plan = planChannelMap(inputOf({ invitePaceMs: 0,
    deptSlugs: {} }))
    expect(plan.channels.every((c) => c.kind !== 'dept' && c.kind !== 'group')).toBe(true)
    expect(plan.problems.some((p) => p.includes('departments/研发部') && p.includes('deptSlugs'))).toBe(true)
  })

  it('groups 未声明：无小组频道（org-config 声明面=唯一来源，不猜）', () => {
    const { groups: _g, ...noGroups } = inputOf() // 键整删（exactOptionalPropertyTypes 面）
    const plan = planChannelMap(noGroups)
    expect(plan.channels.every((c) => c.kind !== 'group')).toBe(true)
    expect(plan.channels).toHaveLength(5) // 总览/大厅/告警/部门/跨部门
  })
})

// ————————————————————————— ensure 幂等收敛（§5.4——S8 判负线=重跑漂移） —————————————————————————

describe('ensureCompanyChannels（§5.4 ensure：首拍建齐→重拍零写）', () => {
  it('首拍：空间+8 房建齐、缺员邀齐、PL 全量覆盖、空间挂子', async () => {
    const syn = new FakeSynapse()
    const report = await ensureCompanyChannels(syn, inputOf())
    expect(report).toMatchObject({ ensured: 8, created: 8 })
    expect(report.problems).toEqual([])
    expect(report.failures).toEqual([])
    expect(syn.byAlias.get('#studio-dev:mx.test')).toBeDefined() // 父空间（m.space）
    expect(syn.byAlias.get('#studio-dev-overview:mx.test')?.memberships.get(PRODUCER)).toBe('invite')
    expect(syn.byAlias.get('#studio-dev-rd:mx.test')?.memberships.get('@eng-0:mx.test')).toBe('invite')
    // PL 覆盖到位（部门频道 50 槽）
    const rd = syn.byAlias.get('#studio-dev-rd:mx.test')
    const pl = rd?.state.get('m.room.power_levels|') as { redact: number; users: Record<string, number> }
    expect(pl.redact).toBe(50)
    expect(pl.users['@eng-0:mx.test']).toBe(50)
    // 空间挂子：8 子房 m.space.child state
    const space = syn.byAlias.get('#studio-dev:mx.test')
    expect([...space?.state.keys() ?? []].filter((k) => k.startsWith('m.space.child|')).length).toBe(8)
  })

  it('重拍零写（S8 收敛判负线：重跑无 create/invite/state 写）', async () => {
    const syn = new FakeSynapse()
    await ensureCompanyChannels(syn, inputOf())
    syn.resetOps()
    const report = await ensureCompanyChannels(syn, inputOf())
    expect(report).toMatchObject({ ensured: 8, created: 0 })
    expect(syn.ops).toEqual([]) // 读不算漂移——变更面为空
  })

  it('手工提权漂移：重拍下拍覆盖收回（单写者收口——§5.4 全量覆盖不增量合并）', async () => {
    const syn = new FakeSynapse()
    await ensureCompanyChannels(syn, inputOf())
    const hall = syn.byAlias.get('#studio-dev-hall:mx.test') as FakeRoom
    const pl = hall.state.get('m.room.power_levels|') as { users: Record<string, number> }
    pl.users['@hacker:mx.test'] = 100 // 手工提权（非目标态）
    syn.resetOps()
    const report = await ensureCompanyChannels(syn, inputOf())
    expect(report.ensured).toBe(8)
    const after = hall.state.get('m.room.power_levels|') as { users: Record<string, number> }
    expect(after.users['@hacker:mx.test']).toBeUndefined()
    expect(syn.ops.filter((o) => o.op === 'sendState' && o.detail.includes('power_levels'))).toHaveLength(1)
  })

  it('invite M_FORBIDDEN 吸收（名单视图滞后≈目标态已达成，不炸供给）', async () => {
    const syn = new FakeSynapse()
    syn.inviteAlwaysForbidden = true
    const report = await ensureCompanyChannels(syn, inputOf())
    expect(report.failures).toEqual([]) // 冲突被吸收——其余供给面完好
    expect(report.ensured).toBe(8)
  })

  it('invite 硬失败：该房落 failures 不炸其余供给（软失败面）', async () => {
    const syn = new FakeSynapse()
    syn.inviteHardFail = true
    const report = await ensureCompanyChannels(syn, inputOf())
    expect(report.failures.length).toBeGreaterThan(0)
    expect(report.failures[0]).toContain('M_UNKNOWN')
  })
})

// ————————————————————————— 单据房间（D7 成员＋P10 归档只读） —————————————————————————

describe('ticket 命名与成员解析（DEV-20 §5.1/P4＋D7 v1.1）', () => {
  it('单号别名段：小写化＋非法字符剥除（DEV-20 → studio-dev-dev-20 照录公式）', () => {
    expect(ticketAliasLocalpart('studio-dev', 'DEV-20')).toBe('studio-dev-dev-20')
    expect(ticketAliasLocalpart('studio-dev', 'studio-dev-174')).toBe('studio-dev-studio-dev-174')
    expect(ticketAliasLocalpart('studio-dev', '任务#九')).toBe('studio-dev-') // CJK/非法全剥
  })

  it('显示名：<单号> ｜ <标题>（48 字截断）', () => {
    expect(ticketRoomName('DEV-20', '频道供给')).toBe('DEV-20 ｜ 频道供给')
    const long = 'x'.repeat(60)
    expect(ticketRoomName('DEV-20', long)).toBe(`DEV-20 ｜ ${'x'.repeat(48)}…`)
  })

  it('D7 成员：派工对象+部门主管+策划最低工号+QA 最低工号+制作人', () => {
    const r = resolveTicketMembers(inputOf(), { dept: 'departments/研发部', assignee: 'ENG-6' })
    expect(r.members).toEqual(['@eng-0:mx.test', '@eng-6:mx.test', PRODUCER, '@pln-1:mx.test', '@qa-1:mx.test'])
    expect(r.moderatorMxid).toBe('@eng-0:mx.test')
    expect(r.note).toBe('')
  })

  it('部门未登记：软退化（派工对象+制作人）＋note 明报不炸', () => {
    const r = resolveTicketMembers(inputOf(), { dept: 'departments/不存在', assignee: 'ENG-6' })
    expect(r.members).toEqual(['@eng-6:mx.test', PRODUCER])
    expect(r.note).toContain('未登记')
  })

  it('派工对象不在索引：仅 bot+制作人（软退化）', () => {
    const r = resolveTicketMembers(inputOf(), { assignee: 'GHOST-9' })
    expect(r.members).toEqual([PRODUCER])
    expect(r.note).toContain('不在人员索引')
  })
})

describe('ensureTicketRoom / archiveTicketRoom（派发开群→CLOSE 归档生命周期）', () => {
  it('派发：按 D7 开房（别名/显示名/成员/PL 基线）＋重拍零写', async () => {
    const syn = new FakeSynapse()
    const r1 = await ensureTicketRoom(syn, inputOf(), { ticket: 'DEV-20', title: '频道供给', dept: 'departments/研发部', assignee: 'ENG-6' })
    expect(r1.created).toBe(true)
    expect(r1.alias).toBe('#studio-dev-dev-20:mx.test')
    const room = syn.byAlias.get(r1.alias) as FakeRoom
    expect(room.name).toBe('DEV-20 ｜ 频道供给')
    expect(room.memberships.get('@pln-1:mx.test')).toBe('invite')
    const pl = room.state.get('m.room.power_levels|') as { redact: number; users: Record<string, number> }
    expect(pl.redact).toBe(100)
    expect(pl.users[PRODUCER]).toBe(100)
    // 重拍（同单重派/重跑）：零写收敛
    syn.resetOps()
    const r2 = await ensureTicketRoom(syn, inputOf(), { ticket: 'DEV-20', title: '频道供给', dept: 'departments/研发部', assignee: 'ENG-6' })
    expect(r2.created).toBe(false)
    expect(syn.ops).toEqual([])
  })

  it('归档：events_default→50＋[已归档] 前缀；重复归档零写（幂等）', async () => {
    const syn = new FakeSynapse()
    await ensureTicketRoom(syn, inputOf(), { ticket: 'DEV-20', title: '频道供给', dept: 'departments/研发部', assignee: 'ENG-6' })
    const a1 = await archiveTicketRoom(syn, inputOf(), { ticket: 'DEV-20' })
    expect(a1).toMatchObject({ archived: true, found: true })
    const room = syn.byAlias.get('#studio-dev-dev-20:mx.test') as FakeRoom
    const pl = room.state.get('m.room.power_levels|') as { events_default: number }
    expect(pl.events_default).toBe(50) // PL0 只读
    const nameState = room.state.get('m.room.name|') as { name: string }
    expect(nameState.name).toBe(`${ARCHIVED_PREFIX}DEV-20 ｜ 频道供给`)
    syn.resetOps()
    const a2 = await archiveTicketRoom(syn, inputOf(), { ticket: 'DEV-20' })
    expect(a2.archived).toBe(true)
    expect(syn.ops).toEqual([]) // 已归档再归档：零写
  })

  it('房间不存在：no-op 对账输入（开房面失败的归档不炸）', async () => {
    const syn = new FakeSynapse()
    const a = await archiveTicketRoom(syn, inputOf(), { ticket: 'DEV-404' })
    expect(a).toMatchObject({ archived: false, found: false })
    expect(a.note).toContain('不存在')
  })
})

// ————————————————————————— boot 装配面（组合根结构同形） —————————————————————————

describe('createMatrixProvisionFace（boot 组合根消费面）', () => {
  it('三面委托：ensureCompanyChannels/onDispatched/onClosed', async () => {
    const syn = new FakeSynapse()
    const face = createMatrixProvisionFace(syn, { snapshot: () => inputOf() })
    const report = await face.ensureCompanyChannels()
    expect(report.ensured).toBe(8)
    await face.onDispatched({ ticket: 'DEV-20', title: '频道供给', dept: 'departments/研发部', assignee: 'ENG-6' })
    expect(syn.byAlias.get('#studio-dev-dev-20:mx.test')).toBeDefined()
    await face.onClosed({ ticket: 'DEV-20' })
    const room = syn.byAlias.get('#studio-dev-dev-20:mx.test') as FakeRoom
    expect((room.state.get('m.room.power_levels|') as { events_default: number }).events_default).toBe(50)
  })

  it('mxidOf：login=工号锚点映射（DEV-20 §5.2 冻结）', () => {
    expect(mxidOf({ login: 'eng-6' }, 'mx.test')).toBe('@eng-6:mx.test')
  })
})
