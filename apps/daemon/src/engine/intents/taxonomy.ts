/**
 * 意图分类学消费件（129-§6.1，studio-dev-166=拆单 A）——webhook｜data-change 两 kind 的
 * 纯函数契约面 + 消费 handler 工厂。
 *
 * 从 engine.ts 拆出（20-§十五.三.3 尺寸门「先拆再增」）：本文件零 IO 决策（落单动作经
 * deps.platform 注入），engine.ts 只注册分发表行（105-刀A A-2 普适分发表口径不变）。
 *
 * 规格（129 提案 §6.1，制作人 2026-10-22 全批）：
 *   - ③ 外部类（webhook）：消费=只落单不派工（22-§二 原语义）——落终态锚点（delivered
 *     无前向边=结构性不可派发，DEV-40 patrol 工件先例），decide 恒走回收 CLOSE：同拍
 *     物化→PATROL→回收，事件即记录；人工分诊通道=平台复活（改态+评论→重进决策，
 *     docs/49 复活令口径）。派工升级链（payload 指定路由）=批示⑥ **缓开**（P2 防外部
 *     输入伪造派工）——本文件留登记位无实现面。双链收口（129 P1-A/C9）：API 触发端点
 *     与 watch-file 同产 webhook 意图走 ingest 统一链（同语义一条链，旁路直落单面收口）。
 *   - ① 数据变更类（data-change）：消费=物化联动单（对账/更新）→路由表定 assignee→
 *     前向态进派发链（联动单是要做工的单——P0-A 样板「新人入司→HF-1 收件箱自动出现
 *     对账单」即此链）。dedupKey=变更指纹 `person+classifier+prev→next`（铁律2 幂等
 *     双层：源侧设置、引擎校验一致——防伪造换键重投）。people-change 源与 org-config
 *     hooks.data_change.routes 接线归拆单 C（本文件只留引擎侧路由登记位）。
 *   - 全部外部内容按不可信输入对待（21-§三，watch-file 任意 JSON 透传同面）：标题截断
 *     入题、全文只进 description、动态字段入 PATROL note 前净化；PATROL note 不含 job=
 *     字段（jobs-sources jobTickets 正则只认 job= 前缀——对 SLA 扫描器结构性不可见）。
 */
import type { FlowPlatform, IssueRecord, InvokeIntent, TicketId } from '@studio-next/contract'
import type { EventRecord } from '@studio-next/contract'
import { DEFAULT_FLOW_TABLE, flowAnchors, HR_EVENT_KINDS, resolveTicketFlow, type FlowTable, type HrEventKind } from '@studio-next/core'

// ————————————————————————— 契约件：payload 形状与校验 —————————————————————————

/**
 * mention 意图负载形状（105-刀A，语义定稿=③ 混合）：结构对齐 @studio-next/matrix 的
 * MentionPayload——daemon 不 import 适配器包（25-§一.2 依赖方向，判负线⑦），按契约
 * payload=unknown 做结构校验；两形状的兼容性由组合根守护测试钉死（apps/boot）。
 */
export interface MentionIntentPayload {
  /** 唤醒目标工号（@宰相/@制作人 等角色词已经源侧 roles 映射成工号） */
  target: string
  /** 唤醒词原文（如 @ENG-3 / @宰相） */
  mention: string
  /** 消息全文（m.text；仅文本可唤起，21-§三） */
  text: string
  /** Matrix eventId——幂等键源（dedupKey=eventId 源侧设置，21A-§5.10 勘误后口径） */
  eventId: string
  /** 发送者 MXID（溯源） */
  sender: string
  /** 房间 ID（溯源，S1 要求单据可查到 roomId） */
  room: string
  /** 频道名（溯源；源侧可缺） */
  channel?: string
}

/**
 * 结构校验（频道内容按不可信输入对待，21-§三）：非对象/必填字符串缺失 → 错误原因串；
 * 过 → 收窄为 MentionIntentPayload（不拷贝、不猜未知字段——透传溯源原文）。
 * 导出面：组合根 apps/boot 的守护测试用它钉「matrix MentionPayload ↔ 本形状」结构
 * 兼容（两包互不 import，形状契约由组合根守）。
 */
export function checkMentionPayload(payload: unknown): MentionIntentPayload | string {
  if (typeof payload !== 'object' || payload === null) return 'payload 非对象'
  const p = payload as Record<string, unknown>
  for (const key of ['target', 'mention', 'text', 'eventId', 'sender', 'room'] as const) {
    if (typeof p[key] !== 'string') return `${key} 缺失或非字符串`
  }
  if (p.channel !== undefined && typeof p.channel !== 'string') return 'channel 非字符串'
  return payload as MentionIntentPayload
}

/** 正文摘录：空白折叠取前 40 字（标题一眼可辨；超长截断，全文在 description） */
function mentionExcerpt(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 40)
}

/** @唤醒单标题（S1：单据可查、带溯源锚点；105-刀A 逐字搬迁——引擎消费 handler 在 engine.ts） */
export function mentionTicketTitle(p: MentionIntentPayload): string {
  const excerpt = mentionExcerpt(p.text)
  return excerpt === '' ? `[@唤醒] ${p.mention}` : `[@唤醒] ${p.mention} ${excerpt}`
}

/** @唤醒单描述：roomId+eventId+sender 溯源 + ③ 混合语义注 + 正文全文（105-刀A 逐字搬迁） */
export function mentionTicketDescription(p: MentionIntentPayload): string {
  return [
    `唤醒来源：Matrix 频道（room=${p.room}${p.channel !== undefined ? ` channel=${p.channel}` : ''}）`,
    `事件：${p.eventId}（幂等键源 dedupKey=eventId，21A-§5.10 勘误后口径）`,
    `发送者：${p.sender}`,
    `唤醒词：${p.mention}（③ 混合语义：@工号=物化唤醒单派该岗位；@宰相/@制作人=API 落单通道）`,
    '正文：',
    p.text,
  ].join('\n')
}

/**
 * webhook 意图负载形状（129-§6.1③ 外部类）：对外 API 触发端点与 watch-file 同一形状
 * 契约（双链收口——同一语义一条链）。外部事件内容按不可信输入对待（21-§三同纪律）。
 */
export interface WebhookIntentPayload {
  /** 事件标题/摘要（必填——落单标题主体；不可信，40 字截断） */
  title: string
  /** 事件详情正文（可选——落单 description 主体；外部系统给的原文） */
  detail?: string
  /** 外部事件 id（可选——展示性溯源；幂等键承载在 intent.dedupKey，此处不参与判定） */
  eventId?: string
}

/**
 * 结构校验（外部事件内容按不可信输入对待）：非对象/title 缺失或非字符串 → 错误原因串；
 * 过 → 收窄为 WebhookIntentPayload（不拷贝、不猜未知字段）。导出面：拆单 C/API 触发端点
 * 的守护测试用它钉「源侧产物 ↔ 本形状」结构兼容（mention/boot 先例同款）。
 */
export function checkWebhookPayload(payload: unknown): WebhookIntentPayload | string {
  if (typeof payload !== 'object' || payload === null) return 'payload 非对象'
  const p = payload as Record<string, unknown>
  if (typeof p.title !== 'string' || p.title.trim() === '') return 'title 缺失或非字符串'
  if (p.detail !== undefined && typeof p.detail !== 'string') return 'detail 非字符串'
  if (p.eventId !== undefined && typeof p.eventId !== 'string') return 'eventId 非字符串'
  return payload as WebhookIntentPayload
}

/**
 * data-change 意图负载形状（129-§6.1① 数据变更类；首类=people-change——挂 DEV-48
 * peopleDiff 出口双写，源归拆单 C）。字段对齐 core PeopleChange（personId/kind/field/
 * prev/next）：classifier=人事事件七值（HR_EVENT_KINDS 单一冻结源同引，零重复值域）。
 */
export interface DataChangeIntentPayload {
  /** 分类学细类（129-§6.1 铁律1：分类学落 payload.class，kind 只是消费路由键）：v0 只开人事类 */
  class: 'people-change'
  /** 变更类型（人事事件七值：入/调/升/降/停/复/退——HR_EVENT_KINDS 值域） */
  classifier: HrEventKind
  /** 变动主体工号（C1-02：工号=永不变主键） */
  person: string
  /** 变动字段维（level/dept/status/name/login/role；入/退汇总事件='*'；缺省 '*'） */
  field?: string
  /** 前值（入=null；渲染标量文本） */
  prev?: string | null
  /** 后值（退=null） */
  next?: string | null
  /** 关联单号（可选——peopleDiff 溯源的镜像单/对账锚） */
  linked_ticket?: string
}

/**
 * 结构校验：非对象/class≠people-change/classifier 不在七值/person 空 → 错误原因串；
 * 过 → 收窄为 DataChangeIntentPayload。导出面：拆单 C people-change 源的守护测试钉
 * 「peopleDiff 产物 ↔ 本形状」结构兼容（mention/boot 先例同款）。
 */
export function checkDataChangePayload(payload: unknown): DataChangeIntentPayload | string {
  if (typeof payload !== 'object' || payload === null) return 'payload 非对象'
  const p = payload as Record<string, unknown>
  if (p.class !== 'people-change') return `class '${String(p.class)}' 不支持（v0 只开 people-change——129-§6.1 分类学①；其余类归 P2 登记）`
  if (typeof p.classifier !== 'string' || !HR_EVENT_KINDS.includes(p.classifier as HrEventKind)) {
    return `classifier '${String(p.classifier)}' 不在人事事件七值（${HR_EVENT_KINDS.join('/')}）`
  }
  if (typeof p.person !== 'string' || p.person === '') return 'person 缺失或非字符串'
  if (p.field !== undefined && typeof p.field !== 'string') return 'field 非字符串'
  if (p.prev !== undefined && p.prev !== null && typeof p.prev !== 'string') return 'prev 非字符串/null'
  if (p.next !== undefined && p.next !== null && typeof p.next !== 'string') return 'next 非字符串/null'
  if (p.linked_ticket !== undefined && typeof p.linked_ticket !== 'string') return 'linked_ticket 非字符串'
  return payload as DataChangeIntentPayload
}

/**
 * 变更指纹（129-§6.1 铁律2 幂等双层的引擎面公式，逐字对齐提案：`person+type+prev→next`）。
 * 源侧契约（拆单 C people-change 源）：产意图时按本公式设置 dedupKey；引擎消费面断言
 * dedupKey===指纹（mention dedupKey=eventId 同款防伪造面——伪造源换键重投绕幂等=明报拒收）。
 * prev/next 缺省（undefined/null）渲染空串——指纹只认值，不认字段携带形态。
 */
export function dataChangeFingerprint(p: {
  person: string
  classifier: string
  prev?: string | null
  next?: string | null
}): string {
  return `${p.person}+${p.classifier}+${p.prev ?? ''}→${p.next ?? ''}`
}

/**
 * data-change 路由表解析（129-A 引擎侧登记位的扁平配置形态；matrixRoles 同款 `词=工号`
 * 分号对——daemon.yaml 扁平 YAML 不收嵌套）：`入=HR-1;升=PLN-1` → Record。坏形态
 * （无 = /空类型/空工号/同类型重复）CONFIG_INVALID 明报；类型值域校验归引擎路由闸
 * （HR_EVENT_KINDS 七值——未知类型落「未命中」明报拒收，不在这里猜）。空/未配=undefined。
 */
export function parseDataChangeRoutes(raw: string | undefined): Record<string, string> | undefined {
  if (raw === undefined || raw.trim() === '') return undefined
  const routes: Record<string, string> = {}
  for (const item of raw.split(';')) {
    const entry = item.trim()
    if (entry === '') continue
    const idx = entry.indexOf('=')
    const kind = idx > 0 ? entry.slice(0, idx).trim() : ''
    const person = idx > 0 ? entry.slice(idx + 1).trim() : ''
    if (kind === '' || person === '') {
      throw new Error(`CONFIG_INVALID：dataChangeRoutes 条目「${entry}」须为 变更类型=工号 形态（分号分隔，如 入=HR-1;升=PLN-1——类型=人事事件七值）`)
    }
    if (routes[kind] !== undefined) {
      throw new Error(`CONFIG_INVALID：dataChangeRoutes 类型「${kind}」重复路由（${routes[kind]} vs ${person}）`)
    }
    routes[kind] = person
  }
  return Object.keys(routes).length > 0 ? routes : undefined
}

// ————————————————————————— 渲染件：标题/描述构造 —————————————————————————

/** PATROL note 动态字段净化：分号/换行替换（键值分隔符与 note 行结构不可被外部内容注入） */
export function noteSafe(value: string): string {
  return value.replaceAll(';', '；').replaceAll('\n', ' ').replaceAll('\r', ' ')
}

/** webhook 落单标题：外部事件摘要 40 字截断（mention 同款摘录律——标题一眼可辨） */
function webhookTicketTitle(p: WebhookIntentPayload): string {
  const excerpt = p.title.replace(/\s+/g, ' ').trim().slice(0, 40)
  return excerpt === '' ? '[webhook] （空标题）' : `[webhook] ${excerpt}`
}

/** webhook 落单描述：源+事件 id+幂等键溯源 + 只落单语义注 + 详情全文 */
function webhookTicketDescription(p: WebhookIntentPayload, source: string, dedupKey: string | undefined): string {
  return [
    `事件来源：${source}（外部事件——按不可信输入对待，21-§三）`,
    `事件 id：${p.eventId ?? '（未携带）'}（幂等键 dedupKey=${String(dedupKey)}——源侧指纹，129-§6.1③）`,
    '语义：只落单不派工（docs/22-§二 原语义；129-A 落单链收口）——本单为事件记录，平台侧人工分诊；'
      + '复活（改态+评论，docs/49 复活令口径）即进工作链。',
    ...(p.detail === undefined ? [] : ['详情：', p.detail]),
  ].join('\n')
}

/** data-change 联动单标题：变更渲染（工号+类型+prev→next；字段级带 field 维） */
function dataChangeTicketTitle(p: DataChangeIntentPayload): string {
  const field = p.field ?? '*'
  const prev = p.prev ?? '∅'
  const next = p.next ?? '∅'
  return field === '*'
    ? `[联动] ${p.person} ${p.classifier}（${prev}→${next}）`
    : `[联动] ${p.person}.${field} ${prev}→${next}（${p.classifier}）`
}

/** data-change 联动单描述：分类学+指纹溯源 + 路由依据 + 变更明细 */
function dataChangeTicketDescription(p: DataChangeIntentPayload, source: string, dedupKey: string, assignee: string): string {
  return [
    `变更来源：${source}（数据变更类——129-§6.1①；首类 people-change 挂 hr-sync peopleDiff 出口）`,
    `变更指纹：${dedupKey}（dedupKey=person+classifier+prev→next 源侧设置，引擎校验一致——129-§6.1 铁律2）`,
    `路由：${p.classifier} → ${assignee}（dataChangeRoutes 路由表——org-config hooks.data_change.routes 的引擎登记位，拆单 C 接线）`,
    ...(p.linked_ticket === undefined ? [] : [`关联单：${p.linked_ticket}`]),
    '明细：',
    `  工号=${p.person} 类型=${p.classifier} 字段=${p.field ?? '*'} 前值=${p.prev ?? '∅'} 后值=${p.next ?? '∅'}`,
  ].join('\n')
}

// ————————————————————————— 消费 handler 工厂 —————————————————————————

/**
 * 消费依赖（engine tick 作用域注入——本文件零引擎内部状态持有）：
 *   - platform/syncMirror/makeEvent/tickEvents：落单+镜像+PATROL 留痕面
 *   - config：flows（终态锚点解析）+ dataChangeRoutes（路由登记位）
 *   - errors/drainSeen/candidates/onMutation：共闸四件（明报/幂等/候选/计数）
 */
export interface IntentConsumerDeps {
  platform: FlowPlatform
  syncMirror: (issue: IssueRecord) => void
  makeEvent: (
    name: EventRecord['event'],
    issue: IssueRecord,
    attempt: number,
    tickEvents: EventRecord[],
    extra?: { note?: string },
  ) => void
  tickEvents: EventRecord[]
  config: { flows?: FlowTable; dataChangeRoutes?: Readonly<Record<string, string>> }
  people: ReadonlyArray<{ id: string }>
  errors: string[]
  drainSeen: Set<string>
  candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
  onMutation: () => void
}

/**
 * webhook 消费 handler（129-A）：外部事件**只落单不派工**——落终态锚点（patrol 工件
 * 先例：delivered 无前向边=结构性不可派发），decide 恒走回收 CLOSE。dedupKey=事件指纹
 * 源侧设置（watch-file=mtime#行号；API=幂等键同源）——引擎不猜公式（各源指纹域不同），
 * 只做可表示性闸（dedupKey 含分号/换行即拒收——PATROL note 键值物理约束，mention
 * eventId 同款防御纵深）。
 */
export function createWebhookConsumer(deps: IntentConsumerDeps): (intent: InvokeIntent, intentKey: string) => Promise<void> {
  return async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    const checked = checkWebhookPayload(intent.payload)
    if (typeof checked === 'string') {
      deps.errors.push(`意图消费：webhook 意图 payload 形状不符（${checked}）——丢弃（外部事件按不可信输入对待，21-§三）`)
      return
    }
    if (typeof intent.dedupKey === 'string' && /[;\r\n]/.test(intent.dedupKey)) {
      deps.errors.push('意图消费：webhook 意图 dedupKey 含分号/换行（PATROL note 键值不可表示）——丢弃')
      return
    }
    // —— 派工链登记位（批示⑥ 缓开，129-§9⑥：P2 防外部输入伪造派工）——
    // 129-§6.1③：payload 指定路由表条目可升级派工单（前向态物化+assignee 指派）。
    // 本刀恒走落单链（终态锚点结构性不派发）；开闸刀在此登记：
    //   ① org-config hooks.webhook.dispatch_routes 注册名白名单（外部输入只可引用注册名，
    //      不可直写工号）；② 命中路由→前向态物化（mention 形态）；③ 对抗测试
    //   （伪造 route/未知注册名明报拒收）。登记位无实现面——占位即边界。
    try {
      // 落单流：type='task'/level=0 走类型优先解析（与岗单/唤醒单同一函数同一序）；
      // L0 流可解析→落终态锚点（结构性不可派发）；流缺失→不指定落位（decide
      // NOOP_UNKNOWN_FLOW 经 noop 观测面可见，不静默——patrol 同款守卫）。
      const l0Flow = resolveTicketFlow(deps.config.flows ?? DEFAULT_FLOW_TABLE, 'task', 0)
      const created = await deps.platform.issues.create({
        title: webhookTicketTitle(checked),
        description: webhookTicketDescription(checked, intent.source, intent.dedupKey),
        type: 'task',
        level: 0,
        ...(l0Flow !== undefined ? { initialState: flowAnchors(l0Flow).delivered } : {}),
      })
      deps.syncMirror(created)
      // PATROL 留痕（幂等键层，append-only 不释放）：note 不含 job= 字段（SLA 盲区纪律
      // 同 mention）；外部内容经 noteSafe 净化，防注入 job=/intent= 键。
      deps.makeEvent('PATROL', created, 1, deps.tickEvents, {
        note:
          `intent=${noteSafe(intentKey)};class=external;event=${checked.eventId !== undefined ? noteSafe(checked.eventId) : '∅'};` +
          `dedup=${typeof intent.dedupKey === 'string' ? noteSafe(intent.dedupKey) : '∅'};来源=${noteSafe(intent.source)}`,
      })
      deps.onMutation()
      deps.drainSeen.add(intentKey)
      deps.candidates.push({ ticket: created.id, intent })
    } catch (err) {
      deps.errors.push(`意图消费：webhook 落单物化失败（dedup=${String(intent.dedupKey)}）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * data-change 消费 handler（129-A）：物化**联动单**→路由表定 assignee（fail-closed 无
 * 兜底——宁拒不错派；mention 防错人纪律同款）→前向态进派发链（联动单是要做工的单，
 * 非留痕工件）。dedupKey=变更指纹源侧契约（铁律2）：不一致=伪造绕幂等面或源侧漂移，
 * 明报拒收不静默（mention dedupKey=eventId 同款）。
 */
export function createDataChangeConsumer(deps: IntentConsumerDeps): (intent: InvokeIntent, intentKey: string) => Promise<void> {
  return async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    const checked = checkDataChangePayload(intent.payload)
    if (typeof checked === 'string') {
      deps.errors.push(`意图消费：data-change 意图 payload 形状不符（${checked}）——丢弃`)
      return
    }
    const fingerprint = dataChangeFingerprint(checked)
    if (intent.dedupKey !== fingerprint) {
      deps.errors.push(
        `意图消费：data-change 意图 dedupKey≠变更指纹（${String(intent.dedupKey)} vs ${fingerprint}）——丢弃（指纹源侧契约，129-§6.1 铁律2）`,
      )
      return
    }
    // 路由闸（fail-closed）：路由表登记位未配/类型未命中→明报拒收（宁拒不错派；拆单 C
    // 配 org-config 路由后即通）；目标必须命中人事索引（defaultPersonId 回退会把配置
    // 漂移落错人——联动单不适用）
    const routes = deps.config.dataChangeRoutes
    const assignee = routes?.[checked.classifier]
    if (assignee === undefined) {
      deps.errors.push(
        `意图消费：data-change 变更类型 '${checked.classifier}' 无路由（dataChangeRoutes 登记位${routes === undefined ? '未配置' : '未命中'}；org-config hooks.data_change.routes 归拆单 C）——丢弃`,
      )
      return
    }
    if (!deps.people.some((p) => p.id === assignee)) {
      deps.errors.push(`意图消费：data-change 路由目标 ${assignee} 不在人事索引——丢弃（路由表漂移明报，不回退）`)
      return
    }
    try {
      const created = await deps.platform.issues.create({
        title: dataChangeTicketTitle(checked),
        description: dataChangeTicketDescription(checked, intent.source, fingerprint, assignee),
        type: 'task',
        level: 0,
        assignee,
      })
      deps.syncMirror(created)
      // PATROL 留痕：同指纹重投/源重放恒只物化一次；note 不含 job=（SLA 盲区纪律）；
      // person/classifier 为受验字段（七值/工号域）仍过 noteSafe 统一净化。
      deps.makeEvent('PATROL', created, 1, deps.tickEvents, {
        note:
          `intent=${noteSafe(intentKey)};class=people-change;kind=${noteSafe(checked.classifier)};` +
          `person=${noteSafe(checked.person)};field=${noteSafe(checked.field ?? '*')};dedup=${noteSafe(intent.dedupKey ?? '')};来源=${noteSafe(intent.source)}`,
      })
      deps.onMutation()
      deps.drainSeen.add(intentKey)
      deps.candidates.push({ ticket: created.id, intent })
    } catch (err) {
      deps.errors.push(`意图消费：data-change 联动单物化失败（指纹=${fingerprint}）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
