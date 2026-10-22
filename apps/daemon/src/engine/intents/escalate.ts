/**
 * escalate 意图消费件（129-D，studio-dev-181；129-§6.1② 阈值类首开——制作人令
 * 首个业务级 hook 验收样板）+ 132 cost_guard 四档接线（132-§6.4 P2）。
 *
 * 消费门（105-刀A A-2 分发表）：本文件实现 kind='escalate' 的 handler——分类学判别
 * 落 payload.class（129-§6.1 铁律1）：v0 只开 'cost-threshold'（132-C 源已并）；
 * sla 类（jobs-sources 产、payload 无 class）归 105-刀B notify 端口刀——未开即
 * class 级明报丢弃（与既有 kind 级明报同语义，文案细化）。
 *
 * 四档接线（132-§6.4 定稿，route 值域=COST_GUARD_ROUTES 冻结词表）：
 *   dispatch → 物化警戒处置单（129-§6.3 P0-B 元组：assignee=target、priority=3
 *              队首经 intent.priority 抬峰——todo_queue 129-B 机制原样复用）
 *   notify   → notify 出口调用（刀B 登记位）+ PATROL 留痕锚——不物化（129-§6.1②）
 *   dispatch+notify → 物化 + 出口（busy 场景=队首+即时提醒，批示项④——notify 在
 *              消费拍即时发，不等派发）
 *   gate     → 仅留痕锚（hard 线管控=132-C 派发闸四 refusal 联动已落账 R6）
 *
 * 幂等（129-§6.1 铁律2 双层）：源侧 dedupKey=cost:<scope>:<period>:<tier>（132-C
 * 公式——本文件 costThresholdKey 单一实现，源侧同引零漂移）；引擎侧断言
 * dedupKey===公式（伪造源换键重投绕幂等=明报拒收，data-change 指纹同款）+ PATROL
 * note intent=<intentKey> 进 patrolKeys（append-only——同键重投恒只消费一次）。
 *
 * fail-closed（宁拒不错派，mention/data-change 同族纪律）：
 *   - payload 形状不符/class 未开 → 明报丢弃（外部输入不可信）
 *   - route 解析不出（payload 未携且 cost_guard 档位未命中/段未声明）→ 明报拒收
 *   - target 解析不出（payload 未携且 costThresholdTarget 未配）→ 明报拒收
 *   - target 不在人事索引 → 明报拒收（无 defaultPersonId 回退）
 */
import { COST_GUARD_ROUTES, type CostGuardConfig, type CostGuardRoute, type FlowPlatform, type IssueRecord, type InvokeIntent, type OrgHooksDecl, type TicketId } from '@studio-next/contract'
import type { EventRecord } from '@studio-next/contract'
import { noteSafe } from './taxonomy.ts'

/** 成本警戒事实包（132-§6.4 定稿九字段——源侧 cost-guard/source.ts 逐字段冻结） */
export interface CostThresholdFacts {
  scope: string
  period: string
  tier: string
  running_usd: number
  budget_usd: number
  pct: number
  top_consumers: Array<{ person: string; model: string; usd: number }>
  price_snapshot_ref: string
  stale_flag: boolean
}

/** escalate 意图负载（129-§6.1② + C2 注释级约定：route/target 可选覆盖，缺省 org-config 档位/路由表解析） */
export interface EscalateIntentPayload {
  class: 'cost-threshold'
  route?: CostGuardRoute
  target?: string
  facts: CostThresholdFacts
}

/**
 * 结构校验（外部事件内容按不可信输入对待）：非对象/class≠cost-threshold/route 不在
 * 冻结词表/target 空/facts 字段类型不符 → 错误原因串；过 → 收窄为 EscalateIntentPayload。
 * 导出面：cost-guard 源守护测试钉「源侧产物 ↔ 本形状」结构兼容（mention/webhook/data-change 先例同款）。
 */
export function checkEscalatePayload(payload: unknown): EscalateIntentPayload | string {
  if (typeof payload !== 'object' || payload === null) return 'payload 非对象'
  const p = payload as Record<string, unknown>
  if (p.class !== 'cost-threshold') {
    return `class '${String(p.class)}' 不支持（v0 只开 cost-threshold——129-§6.1 分类学②；sla 类归 105-刀B notify 端口刀）`
  }
  if (p.route !== undefined && !COST_GUARD_ROUTES.includes(p.route as CostGuardRoute)) {
    return `route '${String(p.route)}' 不在冻结词表（${COST_GUARD_ROUTES.join('/')}——132-§6.4 P2）`
  }
  if (p.target !== undefined && (typeof p.target !== 'string' || p.target === '')) return 'target 缺失或非字符串'
  const f = p.facts
  if (typeof f !== 'object' || f === null) return 'facts 缺失或非对象'
  const facts = f as Record<string, unknown>
  for (const key of ['scope', 'period', 'tier'] as const) {
    if (typeof facts[key] !== 'string' || (facts[key] as string) === '') return `facts.${key} 缺失或非字符串`
  }
  for (const key of ['running_usd', 'budget_usd', 'pct'] as const) {
    if (typeof facts[key] !== 'number' || !Number.isFinite(facts[key] as number)) return `facts.${key} 非有限数`
  }
  if (!Array.isArray(facts.top_consumers)) return 'facts.top_consumers 非数组'
  for (const c of facts.top_consumers) {
    if (typeof c !== 'object' || c === null) return 'facts.top_consumers 条目非对象'
    const cell = c as Record<string, unknown>
    if (typeof cell.person !== 'string' || cell.person === '') return 'facts.top_consumers.person 缺失或非字符串'
    if (typeof cell.model !== 'string' || cell.model === '') return 'facts.top_consumers.model 缺失或非字符串'
    if (typeof cell.usd !== 'number' || !Number.isFinite(cell.usd as number)) return 'facts.top_consumers.usd 非有限数'
  }
  if (typeof facts.price_snapshot_ref !== 'string') return 'facts.price_snapshot_ref 非字符串'
  if (typeof facts.stale_flag !== 'boolean') return 'facts.stale_flag 非布尔'
  return payload as EscalateIntentPayload
}

/**
 * 幂等键公式（129-§6.1 铁律2 引擎面，逐字对齐 132-§6.4：`cost:<scope>:<period>:<tier>`）。
 * 源侧契约：cost-threshold 源产意图时按本公式设置 dedupKey（本函数单一实现同引——
 * dataChangeFingerprint 先例）；升档=新 key 必醒、同档同锚只告一次。
 */
export function costThresholdKey(facts: { scope: string; period: string; tier: string }): string {
  return `cost:${facts.scope}:${facts.period}:${facts.tier}`
}

/**
 * notify 出口交接件（105-刀B notify 链的登记位——129 plan 行 85「同分发表行、互补
 * 不冲突」）：结构化交接，刀B 接 IM 链时零重解析。v0 serve 接 daemon log 行；
 * S7 判负线=fake 出口收到。
 */
export interface CostThresholdNotice {
  class: 'cost-threshold'
  scope: string
  period: string
  tier: string
  route: CostGuardRoute
  pct: number
  runningUsd: number
  budgetUsd: number
  target: string
  dedupKey: string
  source: string
  staleFlag: boolean
}

/**
 * cost-threshold 缺省路由合并（129-D；serve 装配缝，mergeDataChangeRoutes 姊妹件）：
 * org-config `hooks.cost_threshold`（规范位）+ daemon.yaml `costThresholdTarget`/
 * `costThresholdLane`（逃生位）——daemon 值整体覆盖（单值位，dataChangeRoutes 是表才
 * 逐键）；全缺=空片（引擎侧 fail-closed 明报拒收——缺省路由表没配等于警戒面哑火）。
 */
export function mergeCostThresholdDefaults(
  hooks: OrgHooksDecl | undefined,
  daemonTarget: string | undefined,
  daemonLane: string | undefined,
): { costThresholdTarget?: string; costThresholdLane?: string } {
  const target = daemonTarget ?? hooks?.cost_threshold?.target
  const lane = daemonLane ?? hooks?.cost_threshold?.lane
  return {
    ...(target !== undefined ? { costThresholdTarget: target } : {}),
    ...(lane !== undefined ? { costThresholdLane: lane } : {}),
  }
}

/**
 * 成本警戒 notify 出口（129-D）：v0 接 daemon log 行——刀B IM 链的登记位（结构化
 * 交接件 CostThresholdNotice 零重解析；接线时换出口不动消费面）。
 */
export function createCostNotifyOutlet(log: (line: string) => void): (notice: CostThresholdNotice) => void {
  return (n): void => {
    log(`[cost-notify] ${n.tier} 档 ${n.scope}（${n.pct}% running=$${n.runningUsd}/budget=$${n.budgetUsd}）→ ${n.target}${n.staleFlag ? '（含 unpriced/stale 格）' : ''} [${n.dedupKey}]`)
  }
}

/** 警戒处置单标题：一眼可辨（scope/档名/百分比——[联动] 同款摘录律） */
function escalateTicketTitle(p: EscalateIntentPayload): string {
  return `[警戒] ${p.facts.scope} ${p.facts.tier}（${p.facts.pct}%）`
}

/** 警戒处置单描述：分类学+幂等键+路由依据+指派依据+事实包明细 */
function escalateTicketDescription(p: EscalateIntentPayload, route: CostGuardRoute, target: string): string {
  const f = p.facts
  return [
    `警戒来源：cost-threshold（阈值类——129-§6.1②；触发条件归 132-§6.4）`,
    `幂等键：${costThresholdKey(f)}（dedupKey 源侧设置，引擎校验一致——129-§6.1 铁律2）`,
    `路由：${f.tier} 档 route=${route}（org-config cost_guard.alert_tiers 四档接线——132-§6.4 P2）`,
    `指派：${target}（payload.target 缺省路由表——hooks.cost_threshold.target，129-§6.3 P0-B）`,
    '事实包：',
    `  scope=${f.scope} period=${f.period} tier=${f.tier}`,
    `  running=$${f.running_usd} budget=$${f.budget_usd} pct=${f.pct}% stale=${f.stale_flag ? 1 : 0}`,
    ...(f.top_consumers.length === 0 ? [] : ['  top_consumers：', ...f.top_consumers.map((c) => `    ${c.person} ${c.model} $${c.usd}`)]),
    `  price_snapshot_ref=${f.price_snapshot_ref}`,
    '语义：警戒处置单（dispatch 链——达档即醒，129-§6.3 P0-B 样板）；notify 投递链归 105-刀B。',
  ].join('\n')
}

/** PATROL note（词表冻结复用，不新增名）：动态字段全过 noteSafe；note 不含 job=（SLA 盲区纪律） */
function patrolNote(intentKey: string, p: EscalateIntentPayload, route: CostGuardRoute, dedupKey: string, source: string, extra: string): string {
  const f = p.facts
  return (
    `intent=${noteSafe(intentKey)};class=cost-threshold;route=${noteSafe(route)};` +
    `scope=${noteSafe(f.scope)};period=${noteSafe(f.period)};tier=${noteSafe(f.tier)};pct=${f.pct};` +
    `dedup=${noteSafe(dedupKey)};来源=${noteSafe(source)}${extra}`
  )
}

/** 留痕锚（非物化路由挂心跳哨兵单——源侧 ESCALATE 同锚）：synthetic 记录只服务 makeEvent（读 id/level/dept），不入镜像不建单 */
function heartbeatAnchor(id: string): IssueRecord {
  return { id, title: '成本警戒留痕锚（心跳哨兵）', state: '心跳', updated: '' }
}

/**
 * 消费依赖（engine tick 作用域注入——本文件零引擎内部状态持有）：
 *   - costGuard：org-config cost_guard 段活取（热重载感知 getter——四档接线随配置即时生效）
 *   - config.costThresholdTarget/Lane：缺省路由表/泳道落位（org hooks 规范位+daemon.yaml 逃生位合并结果）
 *   - notify：刀B 登记位出口（未接线=留痕 note 记未接线，不算错误——登记位语义）
 */
export interface EscalateConsumerDeps {
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
  config: { costThresholdTarget?: string; costThresholdLane?: string }
  people: ReadonlyArray<{ id: string; dept?: string }>
  departments?: ReadonlyArray<{ path: string; lanes: readonly string[] }>
  costGuard: () => CostGuardConfig | undefined
  notify?: (notice: CostThresholdNotice) => void
  errors: string[]
  drainSeen: Set<string>
  candidates: Array<{ ticket: TicketId; intent: InvokeIntent }>
  onMutation: () => void
  /**
   * 队列峰值优先级登记位（P0-B「priority=3 置顶」）：物化拍登记 intent.priority 峰——
   * 引擎侧延拍并入携带态（物化拍新单不在拍首活集，直接触钟会被投影 GC 当拍删条）。
   * 不注入=峰值丢失（重扫意图低优——警戒单混入常规队尾，队首语义失效）。
   */
  touch?: (ticket: TicketId, intent: InvokeIntent) => void
}

/** escalate 消费 handler（129-D）：结构闸→幂等键断言→route 解析→target 解析→四档动作分发 */
export function createEscalateConsumer(deps: EscalateConsumerDeps): (intent: InvokeIntent, intentKey: string) => Promise<void> {
  return async (intent: InvokeIntent, intentKey: string): Promise<void> => {
    const checked = checkEscalatePayload(intent.payload)
    if (typeof checked === 'string') {
      deps.errors.push(`意图消费：escalate 意图 payload 形状不符（${checked}）——丢弃`)
      return
    }
    // 幂等键引擎面断言（铁律2）：dedupKey===公式——不一致=伪造绕幂等面或源侧漂移，明报拒收
    const key = costThresholdKey(checked.facts)
    if (intent.dedupKey !== key) {
      deps.errors.push(
        `意图消费：escalate 意图 dedupKey≠警戒键（${String(intent.dedupKey)} vs ${key}）——丢弃（幂等键源侧契约 cost:<scope>:<period>:<tier>，129-§6.1 铁律2）`,
      )
      return
    }
    // route 解析（四档接线）：payload 覆盖 > org-config 档位（活取——热重载随换）；解析不出=明报拒收
    const tierRoute = deps.costGuard()?.alertTiers.find((t) => t.tier === checked.facts.tier)?.route
    const route = checked.route ?? tierRoute
    if (route === undefined) {
      deps.errors.push(
        `意图消费：escalate 警戒档 '${checked.facts.tier}' 无 route（payload 未携带且 cost_guard 档位未命中${deps.costGuard() === undefined ? '（段未声明）' : ''}——配置漂移明报，不猜默认）——丢弃`,
      )
      return
    }
    // gate 档：仅留痕（闸四 hard 线 refusal 联动已由 132-C 派发闸执行——R6；消费面重复物化/通知无益）
    if (route === 'gate') {
      deps.makeEvent('PATROL', heartbeatAnchor(intent.ticket ?? '-'), 1, deps.tickEvents, {
        note: patrolNote(intentKey, checked, route, key, intent.source, ';动作=留痕（闸四 refusal 联动归 132-C 派发闸）'),
      })
      deps.onMutation()
      deps.drainSeen.add(intentKey)
      return
    }
    // target 解析（缺省路由表）：payload 覆盖 > costThresholdTarget；解析不出/不在册=明报拒收（防错人纪律）
    const target = checked.target ?? deps.config.costThresholdTarget
    if (target === undefined) {
      deps.errors.push(
        `意图消费：escalate 警戒无指派目标（payload.target/costThresholdTarget 均缺——org-config hooks.cost_threshold 归 129-D 接线）——丢弃`,
      )
      return
    }
    const person = deps.people.find((p) => p.id === target)
    if (person === undefined) {
      deps.errors.push(`意图消费：escalate 指派目标 ${target} 不在人事索引——丢弃（路由表漂移明报，不回退）`)
      return
    }
    // notify 出口（刀B 登记位）：消费拍即时发（busy 场景=队首+即时提醒，批示项④——不等派发）
    const notifyWired = deps.notify !== undefined
    const fireNotify = (): void => {
      if (deps.notify === undefined) return
      deps.notify({
        class: 'cost-threshold',
        scope: checked.facts.scope,
        period: checked.facts.period,
        tier: checked.facts.tier,
        route,
        pct: checked.facts.pct,
        runningUsd: checked.facts.running_usd,
        budgetUsd: checked.facts.budget_usd,
        target,
        dedupKey: key,
        source: intent.source,
        staleFlag: checked.facts.stale_flag,
      })
    }
    try {
      if (route === 'notify') {
        // notify 档：不物化（129-§6.1②：notify→刀B 链）——出口+留痕锚挂心跳哨兵单
        fireNotify()
        deps.makeEvent('PATROL', heartbeatAnchor(intent.ticket ?? '-'), 1, deps.tickEvents, {
          note: patrolNote(intentKey, checked, route, key, intent.source, `;notify=${notifyWired ? '已发出口' : '未接线'}`),
        })
        deps.onMutation()
        deps.drainSeen.add(intentKey)
        return
      }
      // dispatch｜dispatch+notify：物化警戒处置单（129-§6.3 P0-B 元组）
      const lane = deps.config.costThresholdLane ?? deps.departments?.find((d) => d.path === person.dept)?.lanes[0]
      const created = await deps.platform.issues.create({
        title: escalateTicketTitle(checked),
        description: escalateTicketDescription(checked, route, target),
        type: 'task',
        level: 0,
        assignee: target,
        ...(person.dept !== undefined ? { dept: person.dept } : {}),
      })
      // 泳道落位（130-P2 split setField 先例）：错位会跨部占道（lane 租约独占）——显式配置优先，
      // 未配回退 target 部门首泳道；再无=不设（派发回退 defaultLane 现状）
      if (lane !== undefined) {
        await deps.platform.issues.setField(created.id, 'lane', lane)
        deps.syncMirror({ ...created, lane })
      } else {
        deps.syncMirror(created)
      }
      if (route === 'dispatch+notify') fireNotify()
      // PATROL 留痕：同键重投/源重放恒只物化一次；note 不含 job=（SLA 盲区纪律）
      deps.makeEvent('PATROL', created, 1, deps.tickEvents, {
        note: patrolNote(intentKey, checked, route, key, intent.source, route === 'dispatch+notify' ? `;notify=${notifyWired ? '已发出口' : '未接线'}` : ''),
      })
      deps.onMutation()
      deps.drainSeen.add(intentKey)
      // 收件箱队首（129-§6.3 P0-B「priority=3 置顶」）：intent.priority=3（源侧 escalate
      // 高优口径）经消费位登记峰值——引擎侧延拍并入携带态（129-B 机制复用）；candidates
      // 供拍内派发取单（派发面 fetch 兜底同拍可取新单）
      deps.touch?.(created.id, intent)
      deps.candidates.push({ ticket: created.id, intent })
    } catch (err) {
      deps.errors.push(`意图消费：escalate 警戒处置单物化失败（${key}）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
