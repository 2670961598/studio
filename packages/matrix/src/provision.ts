/**
 * 频道供给器（130-P3 频道供给扩展——实现单 studio-dev-174；依据 130 提案 §6.7 全套
 * 八类地图【制作人 2026-10-22 全批】＋DEV-20 §5.1-§5.4 冻结基座照录）。
 *
 * 职责边界（130 §6.7.3 供给工序）：
 *   ③组群/总览/跨部门群 ensure 扩展（org-config groups 声明展开，幂等重跑收敛）
 *   ④单据房间挂派发/CLOSE 相位生命周期（DEV-20 P4/P9/P10 已设计——本件实现）
 *
 * 八类地图（130 §6.7.1，alias ASCII＋CJK 显示名，DEV-20 §5.1 命名法）：
 *   总览 #<slug>-overview｜总览（bot 单向发+制作人+部长——低噪只读）
 *   公司 #<slug>-hall｜大厅（全员）／#<slug>-alert｜告警（全员）
 *   部门 #<slug>-<部门slug>｜<部门名>（每部门一房）
 *   小组 #<slug>-<部门slug>-<组id>｜<组显示名>（org-config groups 声明展开）
 *   需求 #<slug>-<单号小写>｜<单号> ｜ <标题>（派发相位开群/CLOSE 归档只读）
 *   跨部门 #<slug>-xfunc｜跨部门协作（全部门主管+制作人）
 *   父空间（private space）：别名 #<slug>——DEV-20 §5.1 说「无别名」，但幂等重跑
 *   收敛（S8 判负线=重跑漂移）要求可寻址：别名是本件对 §5.1 的唯一偏移（登记项）。
 *
 * 幂等供给算法（DEV-20 §5.4 ensure 语义，P3/P4/P9/P10 共用）：
 *   resolveAlias → 命中：join→补邀缺员（join+invite 名单外才邀——重跑不产生新 invite
 *   事件）→PL 目标快照**全量覆盖**（同值零写；不增量合并——防历史漂移）→（需挂接则）
 *   m.space.child；未命中：createRoom→同后置步。全程可重入：崩溃/重投/重跑收敛同一终态；
 *   「已存在」不是错误是对账输入。
 *
 * PowerLevel 基线（DEV-20 §5.3 照录；130 §6.7.2 bot=每群 creator/admin PL100、
 * 制作人=opengames 神号全知）：三列——大厅/告警列、部门频道列（主管 50/redact 50）、
 * 单据房间列；归档=events_default→50（PL0 只读）。E2EE 恒不启用（21A-§5.7：
 * encryption 事件 PL 100 挡）。
 *
 * 纪律：薄供给层零平台耦合——输入是窄结构快照（CompanySnapshot 的结构子集，
 * boot 组合根负责装配），不 import @studio-next/daemon（依赖方向冻结，docs/20-§十五）。
 * PL 基线/频道规格类型/同值判据拆至 power-levels.ts（20-§十五「先拆再增」）。
 */
import { jsonEqual, powerLevelTarget, powerLevelsMatch, type ChannelMapPlan, type ChannelSpec } from './power-levels.ts'

// 公共 API 同源 re-export（拆件后消费面 import 路径不变——index.ts/测试零改动）
export { powerLevelTarget } from './power-levels.ts'
export type { ChannelKind, PowerLevelColumn, PowerLevelsContent, ChannelSpec, ChannelMapPlan } from './power-levels.ts'

// ————————————————————————— 输入类型（结构子集，零 contract import 也可被其结构满足） —————————————————————————

/** 供给面人员视图（PersonRef 结构子集：id/login/dept/role?/status?） */
export interface ProvisionPerson {
  id: string
  login: string
  dept: string
  role?: string
  status?: string
}

/** 供给面部门视图（DeptNode 结构子集） */
export interface ProvisionDept {
  path: string
  name: string
  leader: string
}

/** 供给面组群声明（OrgGroupDecl 同形——org-config groups 段装载产物） */
export interface ProvisionGroup {
  id: string
  dept: string
  name: string
  leader?: string
  members: readonly string[]
}

/** 频道地图规划输入（boot 从 CompanySnapshot+daemon.yaml 装配；每次 ensure 现取=热重载新鲜面） */
export interface ChannelMapInput {
  /** 公司 slug（别名前缀，如 studio-dev） */
  slug: string
  /** 公司名（父空间显示名） */
  companyName: string
  departments: readonly ProvisionDept[]
  people: readonly ProvisionPerson[]
  /** org-config groups 声明（不声明=undefined=无小组频道） */
  groups?: readonly ProvisionGroup[]
  /** 部门 path → ASCII slug（daemon.yaml matrixDeptMap JSON；缺项落 problems 不炸供给） */
  deptSlugs: Readonly<Record<string, string>>
  /** bot MXID（@studio-gateway:…——房间 creator/admin PL100；serverName 从此派生） */
  botMxid: string
  /** 制作人 MXID（神号全知——每群 PL100；缺省 @opengames:localhost，21A-§2.2） */
  producerMxid: string
}


// ————————————————————————— 小工具 —————————————————————————

/** 工号 → MXID（DEV-20 §5.2 账号映射冻结：localpart=工号小写，login=平台账号锚点） */
export function mxidOf(person: { login: string }, serverName: string): string {
  return `@${person.login}:${serverName}`
}

/** MXID → serverName（@user:server 的 server 段） */
export function serverNameOf(mxid: string): string {
  const idx = mxid.indexOf(':')
  return idx === -1 ? 'localhost' : mxid.slice(idx + 1)
}

/** 别名 localpart（#local:server → local） */
export function aliasLocalpart(alias: string): string {
  const body = alias.startsWith('#') ? alias.slice(1) : alias
  const idx = body.indexOf(':')
  return idx === -1 ? body : body.slice(0, idx)
}

/**
 * 单号 → 频道别名 localpart 段（DEV-20 §5.1/P4 冻结公式：`<slug>-<单号小写化、
 * 非法字符剥除>`；MXID/alias localpart 域 `a-z 0-9 . _ = - / +`——21A-§2.2/§2.4，
 * CJK/大写剥除）。DEV-20 → studio-dev-174 → studio-dev-studio-dev-174：前缀重复是
 * 公式冻结的既视结果（照录不美化——幂等寻址只要确定性）。
 */
export function ticketAliasLocalpart(slug: string, ticket: string): string {
  const cleaned = ticket
    .toLowerCase()
    .replace(/[^a-z0-9._=/+-]/g, '')
    .replace(/^[.=_/-]+|[.=_/-]+$/g, '')
  return `${slug}-${cleaned}`
}

/** 单据房间显示名：`<单号> ｜ <标题截断>`（DEV-20 §5.1 命名法；长标题截 48 防 Synapse name 上限） */
export function ticketRoomName(ticket: string, title: string): string {
  const t = title.trim().replace(/\s+/g, ' ')
  return `${ticket} ｜ ${t.length > 48 ? t.slice(0, 48) + '…' : t}`
}

/** 在册且未退场（status: active|paused|retired——undefined=active 缺省语义，DEV-48） */
function isActive(p: ProvisionPerson): boolean {
  return p.status === undefined || p.status === 'active' || p.status === 'paused'
}

/** 稳定排序去重（成员清单确定性→PL/invite 目标态稳定→重跑零漂移） */
function dedupSorted(xs: readonly string[]): string[] {
  return [...new Set(xs)].sort()
}

function isNotFoundError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('M_NOT_FOUND') || msg.includes('404')
}

function isAlreadyInRoomError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('M_FORBIDDEN')
}


// ————————————————————————— 八类地图规划（纯函数） —————————————————————————

/**
 * 公司频道地图规划（130 §6.7.1 全表展开）。成员推导：
 *   总览 = 全部门主管＋制作人（bot 单向发——低噪只读面）
 *   大厅/告警 = 在册全员＋制作人（神号全知进每群——§6.7.2）
 *   部门 = 该部门在册全员＋制作人；moderator=部门主管（50 槽）
 *   小组 = 声明成员＋制作人；moderator=声明组长（部门频道列照录——未声明组长则 50 槽空缺）
 *   跨部门 = 全部门主管＋制作人（studio-dev 实例=研发部长 ENG-0＋PRIME-0——§6.7.1 表）
 * 部门缺 deptSlugs 映射 → 落 problems（软失败：该房不供给，其余照供）。
 */
export function planChannelMap(input: ChannelMapInput): ChannelMapPlan {
  const server = serverNameOf(input.botMxid)
  const alias = (local: string) => `#${local}:${server}`
  const problems: string[] = []
  const peopleById = new Map(input.people.map((p) => [p.id, p]))
  const activePeople = input.people.filter(isActive)
  const leaderIds = dedupSorted(input.departments.map((d) => d.leader))
  const leaderMxids = leaderIds
    .filter((id) => peopleById.has(id))
    .map((id) => mxidOf(peopleById.get(id) as ProvisionPerson, server))
  const producer = input.producerMxid

  const channels: ChannelSpec[] = []
  let order = 0
  const push = (spec: Omit<ChannelSpec, 'order'>) => {
    channels.push({ ...spec, order: order += 1 })
  }

  // 总览（本提案新增行）：制作人总览频道——bot 单向发（F1 announce- 法，低噪只读）
  push({ kind: 'overview', alias: alias(`${input.slug}-overview`), name: '总览', members: dedupSorted([...leaderMxids, producer]), power: 'hall' })
  // 公司两房（DEV-20 §5.1 已设计照录）
  push({
    kind: 'hall', alias: alias(`${input.slug}-hall`), name: '大厅',
    members: dedupSorted([...activePeople.map((p) => mxidOf(p, server)), producer]), power: 'hall',
  })
  push({
    kind: 'alert', alias: alias(`${input.slug}-alert`), name: '告警',
    members: dedupSorted([...activePeople.map((p) => mxidOf(p, server)), producer]), power: 'hall',
  })
  // 部门频道（每部门一房）
  for (const dept of input.departments) {
    const deptSlug = input.deptSlugs[dept.path]
    if (deptSlug === undefined) {
      problems.push(`部门 ${dept.path} 无 deptSlugs 映射（daemon.yaml matrixDeptMap）——部门频道不供给`)
      continue
    }
    const members = activePeople.filter((p) => p.dept === dept.path).map((p) => mxidOf(p, server))
    push({
      kind: 'dept', alias: alias(`${input.slug}-${deptSlug}`), name: dept.name,
      members: dedupSorted([...members, producer]), power: 'dept',
      ...(peopleById.has(dept.leader) ? { moderatorMxid: mxidOf(peopleById.get(dept.leader) as ProvisionPerson, server) } : {}),
    })
  }
  // 小组频道（本提案新增：org-config groups 声明展开——130 §6.7.1 小组三行）
  if (input.groups !== undefined) {
    for (const group of input.groups) {
      const deptSlug = input.deptSlugs[group.dept]
      if (deptSlug === undefined) {
        problems.push(`组 ${group.id}（${group.name}）的部门 ${group.dept} 无 deptSlugs 映射——小组频道不供给`)
        continue
      }
      const memberMxids = group.members
        .filter((id) => peopleById.has(id) && isActive(peopleById.get(id) as ProvisionPerson))
        .map((id) => mxidOf(peopleById.get(id) as ProvisionPerson, server))
      push({
        kind: 'group', alias: alias(`${input.slug}-${deptSlug}-${group.id}`), name: group.name,
        members: dedupSorted([...memberMxids, producer]), power: 'dept',
        ...(group.leader !== undefined && peopleById.has(group.leader)
          ? { moderatorMxid: mxidOf(peopleById.get(group.leader) as ProvisionPerson, server) }
          : {}),
      })
    }
  }
  // 跨部门协作群（本提案新增行）：全部门主管＋制作人
  push({ kind: 'xfunc', alias: alias(`${input.slug}-xfunc`), name: '跨部门协作', members: dedupSorted([...leaderMxids, producer]), power: 'hall' })

  return { space: { alias: alias(input.slug), name: input.companyName }, channels, problems }
}

// ————————————————————————— ensure（幂等供给，DEV-20 §5.4） —————————————————————————

/** 供给器消费的 MatrixClient 结构面（MatrixClient 满足；测试可注入 fake） */
export interface ProvisionClient {
  createRoom(opts: {
    name: string
    aliasName?: string
    visibility?: 'public' | 'private'
    preset?: 'private_chat' | 'public_chat' | 'trusted_private_chat'
    initialState?: ReadonlyArray<{ type: string; stateKey?: string; content: unknown }>
    creationContent?: Readonly<Record<string, unknown>>
  }): Promise<{ roomId: string }>
  resolveAlias(alias: string): Promise<string>
  joinRoom(roomIdOrAlias: string): Promise<void>
  invite(roomId: string, userId: string): Promise<void>
  listMembers(roomId: string, membership: 'join' | 'invite' | 'leave' | 'ban'): Promise<string[]>
  getFullPowerLevels(roomId: string): Promise<Record<string, unknown>>
  sendStateEvent(roomId: string, type: string, stateKey: string, content: unknown): Promise<void>
  getStateEvent(roomId: string, type: string, stateKey: string): Promise<Record<string, unknown>>
}

/** 一房供给结果（created=本拍新建（对账观测）；ensured 恒真=已在对账输入） */
export interface EnsureRoomResult {
  roomId: string
  created: boolean
}

/** state 同值零写（GET 比 → 不一致才 PUT）——§5.4 重跑零漂移的省写面 */
async function putStateIfChanged(
  client: ProvisionClient,
  roomId: string,
  type: string,
  stateKey: string,
  target: unknown,
): Promise<boolean> {
  try {
    const current = await client.getStateEvent(roomId, type, stateKey)
    if (jsonEqual(current, target)) return false
  } catch (err) {
    if (!isNotFoundError(err)) throw err // 404=无此 state → 落 PUT
  }
  await client.sendStateEvent(roomId, type, stateKey, target)
  return true
}

/** 父空间 ensure（别名 #<slug> 寻址——幂等；DEV-20 §5.1 唯一登记偏移：空间挂别名） */
export async function ensureSpace(client: ProvisionClient, spec: { alias: string; name: string }): Promise<EnsureRoomResult> {
  let roomId: string | undefined
  try {
    roomId = await client.resolveAlias(spec.alias)
  } catch (err) {
    if (!isNotFoundError(err)) throw err
  }
  if (roomId !== undefined) {
    await client.joinRoom(roomId)
    await putStateIfChanged(client, roomId, 'm.room.name', '', { name: spec.name })
    return { roomId, created: false }
  }
  const created = await client.createRoom({
    name: spec.name,
    aliasName: aliasLocalpart(spec.alias),
    visibility: 'private',
    creationContent: { type: 'm.space' },
  })
  return { roomId: created.roomId, created: true }
}

/** 单房 ensure（§5.4 全语义：resolve→join→补邀缺员→PL 全量覆盖→visibility 同值零写） */
export async function ensureChannel(
  client: ProvisionClient,
  spec: ChannelSpec,
  ids: { botMxid: string; producerMxid: string },
): Promise<EnsureRoomResult> {
  let roomId: string | undefined
  try {
    roomId = await client.resolveAlias(spec.alias)
  } catch (err) {
    if (!isNotFoundError(err)) throw err
  }
  let created = false
  if (roomId !== undefined) {
    await client.joinRoom(roomId) // 幂等重入（bot=creator/admin；别名被夺的异常面走 throw）
  } else {
    const res = await client.createRoom({
      name: spec.name,
      aliasName: aliasLocalpart(spec.alias),
      visibility: 'private',
      preset: 'private_chat',
      initialState: [{ type: 'm.room.history_visibility', content: { history_visibility: 'shared' } }],
    })
    roomId = res.roomId
    created = true
  }
  // 补邀缺员（join+invite 名单外才邀——重跑不产生新 invite 事件；M_FORBIDDEN≈已达成）
  const [joined, invited] = await Promise.all([
    client.listMembers(roomId, 'join'),
    client.listMembers(roomId, 'invite'),
  ])
  const present = new Set([...joined, ...invited])
  for (const member of spec.members) {
    if (present.has(member)) continue
    try {
      await client.invite(roomId, member)
    } catch (err) {
      if (!isAlreadyInRoomError(err)) throw err
    }
  }
  // PL 目标快照全量覆盖（同值零写；moderator 50 槽按列基线）
  const target = powerLevelTarget(spec.power, { ...ids, ...(spec.moderatorMxid !== undefined ? { moderatorMxid: spec.moderatorMxid } : {}) })
  const current = await client.getFullPowerLevels(roomId)
  if (!powerLevelsMatch(current, target)) {
    await client.sendStateEvent(roomId, 'm.room.power_levels', '', target)
  }
  // 显示名与 history_visibility 同值零写（createRoom initialState 已写=新建拍零写）
  await putStateIfChanged(client, roomId, 'm.room.name', '', { name: spec.name })
  await putStateIfChanged(client, roomId, 'm.room.history_visibility', '', { history_visibility: 'shared' })
  return { roomId, created }
}

/** 父空间挂子房（m.space.child 同值零写；via=本服，order=规划稳定序） */
async function ensureSpaceChild(
  client: ProvisionClient,
  spaceRoomId: string,
  childRoomId: string,
  order: number,
  serverName: string,
): Promise<void> {
  await putStateIfChanged(client, spaceRoomId, 'm.space.child', childRoomId, { via: [serverName], order })
}

/** 公司频道地图供给报告（serve 启动期/热重载落日志观测面；failures=软失败明细） */
export interface CompanyChannelsReport {
  ensured: number
  created: number
  problems: readonly string[]
  failures: readonly string[]
}

/** 全图 ensure（③工序：启动期/热重载调用——任何单房失败落 failures 不炸其余供给） */
export async function ensureCompanyChannels(client: ProvisionClient, input: ChannelMapInput): Promise<CompanyChannelsReport> {
  const plan = planChannelMap(input)
  const server = serverNameOf(input.botMxid)
  const problems = [...plan.problems]
  const failures: string[] = []
  let spaceRoomId: string | undefined
  try {
    const space = await ensureSpace(client, plan.space)
    spaceRoomId = space.roomId
  } catch (err) {
    failures.push(`space(${plan.space.alias})：${err instanceof Error ? err.message : String(err)}`)
  }
  let ensured = 0
  let created = 0
  for (const channel of plan.channels) {
    try {
      const res = await ensureChannel(client, channel, { botMxid: input.botMxid, producerMxid: input.producerMxid })
      ensured += 1
      if (res.created) created += 1
      if (spaceRoomId !== undefined) {
        await ensureSpaceChild(client, spaceRoomId, res.roomId, channel.order, server)
      }
    } catch (err) {
      failures.push(`${channel.alias}（${channel.kind}）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { ensured, created, problems, failures }
}

// ————————————————————————— 单据房间（④工序：派发开群/CLOSE 归档） —————————————————————————

/**
 * 单据房间成员解析（DEV-20 D7 v1.1＋130 §6.7.1 需求行列的引擎可推导面）：
 *   派工对象＋其部门主管（部长）＋策划最低工号＋QA 最低工号＋bot＋producer。
 * 130 行原文「策划（提案人＋组长）＋部长＋被派研发＋QA＋bot」中的提案人/策划组长在
 * 引擎面不可推导（提案人数据不在镜像；组长=组角色）——登记为后续刀补全面；studio-dev
 * 实例上策划最低工号=PLN-1=130 §5.0 首任策划组长建议人选，落点重合。
 * 部门缺省回落派工对象人档 dept；部门未登记 → 仅派工对象+制作人（软退化不炸）。
 */
export function resolveTicketMembers(
  input: ChannelMapInput,
  args: { dept?: string; assignee: string },
): { members: readonly string[]; moderatorMxid?: string; deptPath?: string; note: string } {
  const server = serverNameOf(input.botMxid)
  const peopleById = new Map(input.people.map((p) => [p.id, p]))
  const assignee = peopleById.get(args.assignee)
  if (assignee === undefined) {
    return {
      members: [input.producerMxid],
      note: `派工对象 ${args.assignee} 不在人员索引——房间仅 bot+制作人（供给面软退化）`,
    }
  }
  const deptPath = args.dept ?? assignee.dept
  const dept = input.departments.find((d) => d.path === deptPath)
  const ids = new Set<string>([assignee.id])
  let moderatorMxid: string | undefined
  if (dept !== undefined) {
    ids.add(dept.leader)
    moderatorMxid = peopleById.has(dept.leader) ? mxidOf(peopleById.get(dept.leader) as ProvisionPerson, server) : undefined
  }
  const lowestByRole = (role: string): string | undefined => {
    const candidates = input.people.filter((p) => p.dept === deptPath && p.role === role && isActive(p)).map((p) => p.id).sort()
    return candidates[0]
  }
  const planner = lowestByRole('策划')
  if (planner !== undefined) ids.add(planner)
  const qa = lowestByRole('QA')
  if (qa !== undefined) ids.add(qa)
  const mxids = dedupSorted([...[...ids].filter((id) => peopleById.has(id)).map((id) => mxidOf(peopleById.get(id) as ProvisionPerson, server)), input.producerMxid])
  const missing = dept === undefined ? `部门 ${deptPath} 未登记——部长/策划/QA 席位缺供` : ''
  return {
    members: mxids,
    ...(moderatorMxid !== undefined ? { moderatorMxid } : {}),
    deptPath,
    note: missing,
  }
}

/** 单据房间 ensure（派发相位挂钩；幂等——重派/重跑收敛同房） */
export async function ensureTicketRoom(
  client: ProvisionClient,
  input: ChannelMapInput,
  args: { ticket: string; title: string; dept?: string; assignee: string },
): Promise<EnsureRoomResult & { alias: string; note: string }> {
  const server = serverNameOf(input.botMxid)
  const resolved = resolveTicketMembers(input, args)
  const alias = `#${ticketAliasLocalpart(input.slug, args.ticket)}:${server}`
  const spec: ChannelSpec = {
    kind: 'ticket',
    alias,
    name: ticketRoomName(args.ticket, args.title),
    members: resolved.members,
    ...(resolved.moderatorMxid !== undefined ? { moderatorMxid: resolved.moderatorMxid } : {}),
    power: 'ticket',
    order: 0,
  }
  const res = await ensureChannel(client, spec, { botMxid: input.botMxid, producerMxid: input.producerMxid })
  // 单据房间挂父空间（DEV-20 §5.1 挂接列）；失败面同房本体分离——挂接失败只记 note
  let note = resolved.note
  try {
    const space = await ensureSpace(client, { alias: `#${input.slug}:${server}`, name: input.companyName })
    await ensureSpaceChild(client, space.roomId, res.roomId, 1000, server)
  } catch (err) {
    note = `${note}${note === '' ? '' : '；'}空间挂接失败：${err instanceof Error ? err.message : String(err)}`
  }
  return { ...res, alias, note }
}

/** 归档只读标记前缀（P10：关单即归档，房间保留可读——21-§二:18） */
export const ARCHIVED_PREFIX = '[已归档] '

/**
 * 单据房间归档（CLOSE 相位挂钩；P10：PL events_default→50＋名称 [已归档] 前缀；幂等
 * 重复 PUT 同值收敛）。房间不存在（开房失败/未开）=对账输入不是错误——no-op 返回。
 */
export async function archiveTicketRoom(
  client: ProvisionClient,
  input: ChannelMapInput,
  args: { ticket: string },
): Promise<{ archived: boolean; found: boolean; note: string }> {
  const server = serverNameOf(input.botMxid)
  const alias = `#${ticketAliasLocalpart(input.slug, args.ticket)}:${server}`
  let roomId: string
  try {
    roomId = await client.resolveAlias(alias)
  } catch (err) {
    if (isNotFoundError(err)) return { archived: false, found: false, note: `房间 ${alias} 不存在——无房可归档（开房面失败的对账输入，不是错误）` }
    throw err
  }
  // PL events_default→50（只读化：PL0 不可发言）——全量目标快照口径（同值零写；含
  // events_default=50 的目标与现状全键比较，漂移/未归档均收敛到归档基线）
  const target = powerLevelTarget('ticket', { botMxid: input.botMxid, producerMxid: input.producerMxid })
  target.events_default = 50
  const current = await client.getFullPowerLevels(roomId)
  if (!powerLevelsMatch(current, target)) {
    await client.sendStateEvent(roomId, 'm.room.power_levels', '', target)
  }
  // 名称前缀（幂等：已带前缀不重写）
  let name: string | undefined
  try {
    const state = await client.getStateEvent(roomId, 'm.room.name', '')
    if (typeof state['name'] === 'string') name = state['name']
  } catch (err) {
    if (!isNotFoundError(err)) throw err
  }
  if (name === undefined || !name.startsWith(ARCHIVED_PREFIX)) {
    await client.sendStateEvent(roomId, 'm.room.name', '', { name: `${ARCHIVED_PREFIX}${name ?? ticketAliasLocalpart(input.slug, args.ticket)}` })
  }
  return { archived: true, found: true, note: `${alias} 归档只读（events_default→50）` }
}

// ————————————————————————— boot 组合根装配面（daemon 结构同形——零 import 互认） —————————————————————————

/**
 * daemon 侧 MatrixRoomFace 的结构实现（apps/boot 组合根装配；ensureCompanyChannels/
 * onDispatched/onClosed 三面——serve/engine 经结构同形接口消费，docs/20-§十五 依赖方向）。
 * snapshot 每次调用现取（热重载新鲜面——L1 公司目录热替换后下拍供给即收敛）。
 */
export function createMatrixProvisionFace(client: ProvisionClient, opts: { snapshot: () => ChannelMapInput }) {
  return {
    async ensureCompanyChannels(): Promise<CompanyChannelsReport> {
      return await ensureCompanyChannels(client, opts.snapshot())
    },
    async onDispatched(args: { ticket: string; title: string; dept?: string; assignee: string }): Promise<void> {
      // 硬失败（网络/权限）上抛→engine 落 ESCALATE 明报不阻派发；软失败（席位缺供
      // 等对账性 note）随返回值静默——供给面观测走 ensureCompanyChannels 报告与台账
      await ensureTicketRoom(client, opts.snapshot(), args)
    },
    async onClosed(args: { ticket: string }): Promise<void> {
      await archiveTicketRoom(client, opts.snapshot(), args)
    },
  }
}
