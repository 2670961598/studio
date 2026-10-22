/**
 * events-index —— events 派生索引（幂等依据；每拍重建，可重放）。
 *
 * 引擎每拍从台账全量事件流重建本索引：attempt 计数/在工键/闭集/STALL 连击/PATROL
 * 物化键，以及 DEV-49 A4 双哨键（未知态哨 `ticket|state` 键、巡逻核漂移状态名键——
 * docs/52-§十；哨体=sentinels.ts）。纯函数（事件数组入、索引出）——上移出 engine.ts
 * =尺寸基线清偿（docs/20-§十五.三），行为零变更。
 *
 * studio-dev-141（2026-10-21，123 号卡 3.5h 实证）：在工键（seenKeys）增加第二条
 * 释放路径——STALL 咬合（kill 面收口锚）即释放（见 STALL_KILL_CLOSE_ANCHOR）。
 * 此前唯一释放路径=GATE_PASS/GATE_FAIL 结论事件；kill 面（R-B 在途语义：四要件
 * 不可判、不落 GATE_FAIL 不结算预算）两皆无 → 上誓消费键滞留 seenKeys → 回退回
 * 初态的单 rescan 兜底（DEV-42①，docs/17-§2 相位 2 前置③）被 DEDUP_NOOP 压制
 * ——dedup 键对「同单回到同状态」的回退迁移与首发不可区分（docs/22-§三.2 幂等
 * 口径的本意是防同誓 replay，不是防回滚重派）。无外部活动时最长卡数小时（真机
 * 逃生门=平台侧偶发活动，机制上不保证；fake 平台 transition 产活动故既有测试
 * 面从未暴露——stall-response kill 面用例经 activity 通道逃生而绿）。
 *
 * studio-dev-171（批示归一层，docs/18-§2.5）：directiveKeys（批示评论消费键，
 * append-only）+ directiveStandingOf（批示站立：APPROVE verb 置位 / DISPATCH 清零）
 * ——批准站立喂相位 2 approved 入参；打回/拆单/搁置站立抑制 5a 自动呈批。
 */
import type { EventRecord, TicketId } from '@studio-next/contract'
import { DIRECTIVE_VERBS, type DirectiveVerb } from '../directive/index.ts'

/**
 * STALL 咬合（kill 面）收口锚——executeStallResponse A 面 note 独有子串
 * （studio-dev-141 键释放依据；events-index 派生与 engine note 构造两侧共用，
 * 单一源防漂移）。只叫告警（「看门狗告警第 N/M 次」）、B 面消亡（「GATE_FAIL
 * 收口」）、GATE 面事件均不含此串——锚唯一定位 kill 面收口。
 */
export const STALL_KILL_CLOSE_ANCHOR = '工位收口 interrupted'

/** events 派生索引（幂等依据；每拍重建，可重放） */
export interface EventIndex {
  /** DISPATCH 计数（attempt=计数+1） */
  attemptOf(ticket: TicketId): number
  /** 在工意图键集（DISPATCH 已消费且无结论——重复活动 noop；结论=GATE_PASS/GATE_FAIL 或 STALL 咬合收口，studio-dev-141） */
  seenKeys: readonly string[]
  /** 已 CLOSE 单（不再进 state-diff 候选；CLOSE 后有 RESUME 即释放——复活一等语义 DEV-42②） */
  closed: ReadonlySet<TicketId>
  /**
   * 同 attempt 内 STALL 告警计数（DEV-44 咬合阈依据）：最近一次 DISPATCH 之后的 STALL
   * 事件数（事件派生可重放；重派新 DISPATCH 落账即归零——attempt 作用域，不跨誓累计）。
   */
  stallStrikesOf(ticket: TicketId): number
  /**
   * 本单未释放的消费键（最近一次 DISPATCH 的 intent 键，结论事件未落=未释放；DEV-44）：
   * 在工喽数豁免用——见相位 2 decide 输入装配处的看门狗喂数豁免注记。
   */
  seenKeyOf(ticket: TicketId): string | null
  /** schedule 意图已物化键集（PATROL 留痕派生，append-only 不释放——重投不重跑） */
  patrolKeys: ReadonlySet<string>
  /**
   * 未知态哨已告警键集（DEV-49 A4，docs/52-§十）：键=`${ticket}|${state}`——ESCALATE
   * 事件 note 携 `UNKNOWN_STATE;state=<s>` 派生（PATROL 键同法），append-only 不释放：
   * 每单每态只告一次（治存量后不再刷屏；新回流态=新键=新告）。
   */
  unknownStateAlarmed: ReadonlySet<string>
  /**
   * 白名单态已观察键集（127-C 州表卫生）：FOREIGN_KNOWN 事件 note 携
   * `FOREIGN_KNOWN;state=<s>` 派生，键=`${ticket}|${state}`——观察级也每单每态
   * 一次（append-only 不释放，与 unknownStateAlarmed 独立两集：降级不吞历史告警，
   * 白名单摘除后 ESCALATE 键仍在——不回灌刷屏）。
   */
  foreignKnownAlarmed: ReadonlySet<string>
  /**
   * 状态集巡逻核已告警状态名集（DEV-49 A4）：ESCALATE 事件 note 携
   * `UNKNOWN_STATUS;status=<name>` 派生——每漂移状态名只告一次。
   */
  statusSetDriftAlarmed: ReadonlySet<string>
  /**
   * C2 声明缺失向已告状态名集（studio-dev-126）：ESCALATE note 携
   * `DECLARED_STATUS_MISSING;status=<name>` 派生——每状态名只告一次。
   */
  declaredStatusMissingAlarmed: ReadonlySet<string>
  /**
   * C2 平台额外向已告状态名集（studio-dev-126）：ESCALATE note 携
   * `PLATFORM_STATUS_EXTRA;status=<name>` 派生——每状态名只告一次。
   */
  platformStatusExtraAlarmed: ReadonlySet<string>
  /**
   * 已消费批示评论键集（studio-dev-171 批示归一层，docs/18-§2.5）：APPROVE/ESCALATE
   * note 携 `directive=<评论id>` 派生（PATROL 键同法，append-only 不释放）——每条批示
   * 评论恰消费一次：拒/畸形也算消费（不重放不刷屏）；同单新活动重拉评论列表时
   * 旧批示靠本键防重放（尤其 L2 交付批位防陈旧批准误批）。
   */
  directiveKeys: ReadonlySet<string>
  /**
   * 批示站立（docs/18-§2.5）：单据最近一次合法批示动词——APPROVE note `verb=<v>`
   * 置位、DISPATCH 清零（批准被派发消费；L2 第二道待批不吃陈旧批准）。资格拒/畸形
   * （ESCALATE）不站立。null=无站立。消费面：相位 2 approved 入参（=批准）与
   * 5a submit_approval 回弹抑制（打回/拆单/搁置站立期不自动呈批）。
   */
  directiveStandingOf(ticket: TicketId): DirectiveVerb | null
  /**
   * 岗单锚（studio-dev-196 模型档执行面）：单据 PATROL note 携 `job=<id>`（jobs
   * 物化口径，jobs-sources jobTickets 同法）→ 该岗 id；非岗单/未物化=undefined。
   * 消费面：模型档解析第 2 级（岗单随行 model_tier 落档——ledger.getJob 读面）。
   */
  jobAnchorOf(ticket: TicketId): string | undefined
}

/** note 分号对解析（PATROL intent= 键同法）：取 `k=` 值，无则 undefined */
function noteField(note: string | undefined, key: string): string | undefined {
  return note?.split(';').find((s) => s.startsWith(`${key}=`))?.slice(key.length + 1)
}

/** 事件流 → 派生索引（engine 原 indexEvents 上移；行为零变更） */
export function buildEventIndex(events: readonly EventRecord[]): EventIndex {
  const dispatchCount = new Map<TicketId, number>()
  const lastDispatch = new Map<TicketId, { ts: number; key: string | null }>()
  const lastOutcome = new Map<TicketId, number>()
  const closed = new Set<TicketId>()
  const patrolKeys = new Set<string>()
  const unknownStateAlarmed = new Set<string>()
  const foreignKnownAlarmed = new Set<string>()
  const statusSetDriftAlarmed = new Set<string>()
  const declaredStatusMissingAlarmed = new Set<string>()
  const platformStatusExtraAlarmed = new Set<string>()
  const stallStrikes = new Map<TicketId, number>()
  const directiveKeys = new Set<string>()
  const directiveStanding = new Map<TicketId, DirectiveVerb>()
  const jobAnchors = new Map<TicketId, string>()
  for (const e of events) {
    if (e.event === 'DISPATCH') {
      dispatchCount.set(e.issue, (dispatchCount.get(e.issue) ?? 0) + 1)
      const key = e.note?.split(';').find((s) => s.startsWith('intent='))?.slice('intent='.length) ?? null
      lastDispatch.set(e.issue, { ts: e.ts, key })
      // 新 attempt 开工：STALL 连击归零（attempt 作用域计数——DEV-44 咬合阈）
      stallStrikes.set(e.issue, 0)
      // 批示站立清零（studio-dev-171，docs/18-§2.5）：批准被派发消费——L2 第二道
      // 待批（同状态名复现）不吃陈旧批准；打回/拆单站立经派发自然翻篇（重派=新誓）
      directiveStanding.delete(e.issue)
    } else if (e.event === 'GATE_PASS' || e.event === 'GATE_FAIL') {
      lastOutcome.set(e.issue, Math.max(lastOutcome.get(e.issue) ?? 0, e.ts))
    } else if (e.event === 'CLOSE') {
      closed.add(e.issue)
    } else if (e.event === 'RESUME') {
      // 复活一等语义（DEV-42②）：RESUME=复活锚点——CLOSE 后落 RESUME 即出闭集
      // （事件流序 last-write-wins：复活→再走单→再 CLOSE→再入闭集，循环可重放）。
      // 原口径 closed 不释放：平台侧复活（态改回流程态+评论，docs/49 复活令）被
      // 闭集永拦在决策外（实测 studio-dev-51/57 复活无效）。
      closed.delete(e.issue)
    } else if (e.event === 'PATROL') {
      // schedule 意图物化留痕（append-only 不释放）：同键意图恒只物化一次——
      // 与 DISPATCH 键的「结论后释放」语义相反（定时触发=markRan 已记账，重投不得重跑）
      const key = noteField(e.note, 'intent')
      if (key !== undefined) patrolKeys.add(key)
      // 岗单锚（studio-dev-196）：PATROL note 携 job=<id> 即岗物化单——last-write-wins
      //（jobs-sources jobTickets 同口径；每岗每拍恒同单号，覆盖幂等）
      const job = noteField(e.note, 'job')
      if (job !== undefined) jobAnchors.set(e.issue, job)
    } else if (e.event === 'FOREIGN_KNOWN') {
      // 127-C 州表卫生白名单态观察键（append-only 不释放）：note 携 FOREIGN_KNOWN;state=<s>
      const st = noteField(e.note, 'state')
      if (st !== undefined) foreignKnownAlarmed.add(`${e.issue}|${st}`)
    } else if (e.event === 'APPROVE') {
      // 批示消费锚（studio-dev-171，docs/18-§2.5）：APPROVE note `DIRECTIVE;` 前缀
      // 携 verb/directive——verb 置站立（DISPATCH 清零），directive 入消费键
      //（append-only；拒/畸形的 ESCALATE 面同键不站立）
      if (e.note !== undefined && e.note.startsWith('DIRECTIVE')) {
        const id = noteField(e.note, 'directive')
        if (id !== undefined) directiveKeys.add(id)
        const verb = noteField(e.note, 'verb')
        if (verb !== undefined && (DIRECTIVE_VERBS as readonly string[]).includes(verb)) {
          directiveStanding.set(e.issue, verb as DirectiveVerb)
        }
      }
    } else if (e.event === 'ESCALATE') {
      // 批示归一消费键（ESCALATE 面：资格拒/畸形/边未声明——拒也算消费不重放）
      if (e.note !== undefined && e.note.startsWith('DIRECTIVE')) {
        const id = noteField(e.note, 'directive')
        if (id !== undefined) directiveKeys.add(id)
      }
      // DEV-49 A4 哨键派生（PATROL 键同法，append-only）：未知态哨键=`ticket|state`
      // （每单每态一次）；巡逻核键=漂移状态名（每状态名一次）
      if (e.note?.startsWith('UNKNOWN_STATE;') === true) {
        const st = noteField(e.note, 'state')
        if (st !== undefined) unknownStateAlarmed.add(`${e.issue}|${st}`)
      } else if (e.note?.startsWith('UNKNOWN_STATUS;') === true) {
        const st = noteField(e.note, 'status')
        if (st !== undefined) statusSetDriftAlarmed.add(st)
      } else if (e.note?.startsWith('DECLARED_STATUS_MISSING;') === true) {
        const st = noteField(e.note, 'status')
        if (st !== undefined) declaredStatusMissingAlarmed.add(st)
      } else if (e.note?.startsWith('PLATFORM_STATUS_EXTRA;') === true) {
        const st = noteField(e.note, 'status')
        if (st !== undefined) platformStatusExtraAlarmed.add(st)
      }
    } else if (e.event === 'STALL') {
      if ((lastDispatch.get(e.issue) ?? { ts: 0 }).ts < e.ts) {
        // DEV-44 咬合阈计数：在工期（最近 DISPATCH 后）STALL 告警逐次累计——
        // 重派后新 DISPATCH 归零（attempt 作用域），事件派生可重放
        stallStrikes.set(e.issue, (stallStrikes.get(e.issue) ?? 0) + 1)
      }
      // studio-dev-141：STALL 咬合（kill 面收口锚）= 该誓在工生命终结——消费键释放。
      // 实证（123 号卡 3.5h）：上誓由 mirror rescan 派发（DISPATCH 携 mirror 键）→
      // 咬合 kill 面回滚首批位，无 GATE_PASS/GATE_FAIL（R-B 在途语义：四要件不可判、
      // 不冒认失败）→ 键滞留 seenKeys → 回退态单 rescan 兜底恒 DEDUP_NOOP，无外部
      // 活动时最长卡数小时。修法语义：键释放≠收割结论——interrupted 不落 GATE_FAIL、
      // 不结算预算、断路面不动（咬合仍 countsTowardBreaker，防「挂死-杀-重派」无限
      // 循环由断路器守）；释放只表达「该誓已了结，重派是新誓唤起非 replay」——与
      // GATE_FAIL 释放面同族。22-§三.2 幂等口径不破：同誓内（DISPATCH 落账至咬合间）
      // 100 重复意图仍只唤起一次。事件流派生可重放：存量咬合事件（含 123 号卡
      // 16:59:09 那条）重放即释放，修复上线后下一节流拍 rescan 自愈。
      if ((e.note ?? '').includes(STALL_KILL_CLOSE_ANCHOR)) {
        lastOutcome.set(e.issue, Math.max(lastOutcome.get(e.issue) ?? 0, e.ts))
      }
    }
  }
  const seen: string[] = []
  for (const [ticket, last] of lastDispatch) {
    if (last.key !== null && (lastOutcome.get(ticket) ?? 0) <= last.ts) seen.push(last.key)
  }
  return {
    attemptOf: (ticket: TicketId): number => (dispatchCount.get(ticket) ?? 0) + 1,
    seenKeys: seen,
    closed,
    stallStrikesOf: (ticket: TicketId): number => stallStrikes.get(ticket) ?? 0,
    seenKeyOf: (ticket: TicketId): string | null => {
      const last = lastDispatch.get(ticket)
      if (last === undefined || last.key === null) return null
      return (lastOutcome.get(ticket) ?? 0) <= last.ts ? last.key : null
    },
    patrolKeys,
    unknownStateAlarmed,
    foreignKnownAlarmed,
    statusSetDriftAlarmed,
    declaredStatusMissingAlarmed,
    platformStatusExtraAlarmed,
    directiveKeys,
    directiveStandingOf: (ticket: TicketId): DirectiveVerb | null => directiveStanding.get(ticket) ?? null,
    jobAnchorOf: (ticket: TicketId): string | undefined => jobAnchors.get(ticket),
  }
}
