/**
 * work/transition —— 工作状态迁移编排挂点（REC-WORK-06 的 daemon 侧执行缝）
 *
 * 规格依据（实现单引用——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-06-02（engine 拆分·工作与判定域；领土 `engine/work/`）；
 *   - docs/v2/14 §1.4（PORT-WORK `transition`：REC-WORK-06「trigger_ref 必填且为前置记录」）
 *     ＋§1.3（PORT-HR `transitionLifecycle` 同族形状——两域共用「迁移＝决定、执行＝框架」）；
 *   - docs/v2/11 §5.2 REC-WORK-06（一条迁移一个身份；只能由 §14.1 表指定生产者与前置驱动；
 *     **执行体/宿主事件不是迁移的生产者**；事件是迁移的留痕不是驱动——v2/07 §三总规则）；
 *     §14.1 M-01..M-29（状态集与边语义主表；本件不重述状态字面量）；
 *   - 既有实现锚（语义逐字保持，20-§十五「先拆再增」）：docs/17-§2 七相位（呈批/复验/
 *     回收三相位边）、docs/17-§7（关单即吊销）、docs/43-§五（工位原位归档）、
 *     DEV-46（GATE_FAIL 回滚首批位）、DEV-44（STALL 咬合回滚）。
 *
 * 分工（纯编排，零判定复制）：
 *   - **迁移合法性/边表在 core flows/decide**（本件不判定 from→to；只把 decide 已产出的
 *     Action.toState / 流锚点落到平台，并按既有顺序落触发记录）；
 *   - 触发记录（GATE_FAIL/QA_PASS/STALL/CLOSE）的事件名、attempt、note 由调用方（引擎
 *     相位缝）给足——本件只保证「迁移 → 镜像同步 → 触发记录」的**顺序不漂移**；
 *   - 判据源不在这里：五门/验收/收割四要件分别为 core work-readiness、core 判定与
 *     engine 收割域（06-03）——本件不碰。
 *
 * 顺序不变量（与拆前 engine.ts 内联体逐字一致）：
 *   ① 有迁移面：`platform.issues.transition` → `syncMirror`（镜像拍末真态）→ 触发记录；
 *   ② 无迁移面（等级未登记流等）：不触平台、只落触发记录（载体=拍首镜像）；
 *   ③ 事件落账失败不吞、不重排（异常上抛给相位 catch——既有错误码面不变）。
 * 纪律：零 IO 判断、零时钟（attempt/时点由调用方传）、不持引擎状态（闭包注入）。
 */
import type { EventRecord, FlowPlatform, IssueRecord, TicketId } from '@studio-next/contract'
import { flowAnchors, type Action, type StateFlow } from '@studio-next/core'
import type { TickActionResult } from '../tick-report/types.ts'

// ————————————————————————— 事件面 —————————————————————————

/**
 * 触发记录附加列（EventRecord 既有可选列的子集；本件只透传不造值）。
 * tokens/cost_usd/duration_ms/size/payload_hash 属收割/派发面，note 是迁移理由主承载。
 */
export interface WorkEventExtra {
  readonly tokens?: EventRecord['tokens']
  readonly cost_usd?: number
  readonly duration_ms?: number
  readonly size?: number
  readonly payload_hash?: string
  readonly note?: string
  readonly causation_id?: string
}

/** 触发记录写入闭包（engine 侧＝makeEvent + 本拍 tickEvents；返回落账后的事件记录） */
export type WorkEventEmitter = (
  name: EventRecord['event'],
  issue: IssueRecord,
  attempt: number,
  extra?: WorkEventExtra,
) => EventRecord

// ————————————————————————— 迁移执行缝 —————————————————————————

/** 迁移执行宿主（engine 每拍构造一次；全部为闭包读/写，不持状态副本） */
export interface WorkTransitionHost {
  readonly platform: Pick<FlowPlatform, 'issues'>
  readonly syncMirror: (issue: IssueRecord) => void
  readonly emit: WorkEventEmitter
}

/**
 * 一条迁移单（两种合法形态）：
 *   - 迁移面：`toState` 给定（decide 产出的目标态或流锚点），触发记录可选；
 *   - 无迁移面：`toState` 缺省且必带 `carrier`＋`event`（如等级未登记流的 GATE_FAIL
 *     留痕、CLOSE 终态回收——平台态不变，只落触发记录）。
 */
export type WorkTransitionOrder =
  | {
      readonly ticket: TicketId
      readonly attempt: number
      readonly toState: string
      readonly carrier?: IssueRecord
      readonly event?: { readonly name: EventRecord['event']; readonly extra?: WorkEventExtra }
    }
  | {
      readonly ticket: TicketId
      readonly attempt: number
      readonly toState?: undefined
      readonly carrier: IssueRecord
      readonly event: { readonly name: EventRecord['event']; readonly extra?: WorkEventExtra }
    }

/** 迁移执行结果（issue=迁移后镜像或事件载体；event=本次触发记录） */
export interface WorkTransitionResult {
  readonly issue: IssueRecord
  readonly transitioned: boolean
  readonly event?: EventRecord
}

/**
 * 状态迁移编排（单一出口）：迁移 → 镜像 → 触发记录。
 * `toState` 缺省＝无迁移面（只落触发记录）；平台迁移异常原样上抛（调用方相位 catch）。
 */
export async function applyWorkTransition(
  host: WorkTransitionHost,
  order: WorkTransitionOrder,
): Promise<WorkTransitionResult> {
  const issue = order.toState === undefined ? order.carrier : await host.platform.issues.transition(order.ticket, order.toState)
  if (order.toState !== undefined) host.syncMirror(issue)
  if (order.event === undefined) return { issue, transitioned: order.toState !== undefined }
  const event = host.emit(order.event.name, issue, order.attempt, order.event.extra)
  return { issue, transitioned: order.toState !== undefined, event }
}

// ————————————————————————— 相位执行（呈批/复验/回收） —————————————————————————

/** 相位宿主（在迁移宿主之上补拍内读面与明报面；engine 每拍构造一次） */
export interface WorkPhaseHost extends WorkTransitionHost {
  /** 该单在册誓号（事件 attempt 列；RESUME/QA/CLOSE 同源） */
  readonly attemptOf: (ticket: TicketId) => number
  /** 流解析（T:<type> 优先→L<level> 回退；flow 缺＝等级未登记流） */
  readonly flowOf: (issue: IssueRecord) => StateFlow | undefined
  /** 拍错误面（明报不吞） */
  readonly errors: string[]
  /** 动作结果面（tick 返回结构化 actions 的伴生结果） */
  readonly actionResults: TickActionResult[]
  /** 有账面动作的拍不落心跳（mutations 计数） */
  readonly onMutation: () => void
}

/** 派发前置呈批动作（core decide 产出；v0 直迁平台、事件名待批示） */
export type ApprovalAction = Extract<Action, { type: 'submit_approval' }>
/** 证据就绪→复验通过动作（收割相位 QA 面） */
export type CollectAction = Extract<Action, { type: 'collect' }>
/** 已交付→关单回收动作（终态无平台迁移） */
export type RecycleAction = Extract<Action, { type: 'recycle' }>

/**
 * 相位 3 呈批迁移（原 engine 内联体逐字保持）：transition → 镜像 → 计账/结果。
 * v0 直迁平台不落事件（呈批事件名待批示；真路径＝网关动作词 GW_*，v0 无网关不伪造）。
 */
export async function runApprovalTransitions(
  host: WorkPhaseHost,
  queue: readonly ApprovalAction[],
): Promise<number> {
  let approvals = 0
  for (const action of queue) {
    try {
      await applyWorkTransition(host, {
        ticket: action.ticket,
        attempt: host.attemptOf(action.ticket),
        toState: action.toState,
      })
      approvals += 1
      host.onMutation()
      host.actionResults.push({
        ticket: action.ticket,
        actionType: action.type,
        ok: true,
        detail: `呈批→${action.toState}（v0 直迁，事件名待批示）`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      host.errors.push(`呈批迁移失败 ${action.ticket}：${msg}`)
      host.actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
    }
  }
  return approvals
}

/**
 * 相位 4 收尾·复验通过面（collect 动作）：取拍末真态定流 → 迁复验锚点 → QA_PASS 留痕。
 * 等级未登记流＝明报跳过（不猜终态；既有错误码面不变）。
 */
export async function runCollectTransitions(
  host: WorkPhaseHost,
  queue: readonly CollectAction[],
): Promise<number> {
  let collected = 0
  for (const action of queue) {
    try {
      const fresh = await host.platform.issues.get(action.ticket)
      const flow = host.flowOf(fresh)
      if (flow === undefined) {
        host.errors.push(`collect：单 ${action.ticket} 等级未登记流`)
        host.actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: '等级未登记流' })
        continue
      }
      const anchors = flowAnchors(flow)
      await applyWorkTransition(host, {
        ticket: action.ticket,
        attempt: host.attemptOf(action.ticket),
        toState: anchors.verified,
        event: { name: 'QA_PASS', extra: { note: '证据就绪→复验通过（收割相位 QA 面）' } },
      })
      collected += 1
      host.onMutation()
      host.actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `→${anchors.verified}` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      host.errors.push(`collect 失败 ${action.ticket}：${msg}`)
      host.actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
    }
  }
  return collected
}

/** 回收相位宿主（泳道/凭据/房间三副面——按域闭包注入，本件不 import 引擎状态） */
export interface WorkRecycleHost extends WorkPhaseHost {
  readonly defaultLane: string
  /** 泳道释放（engine 包装：lanes.release(lane, ticket)） */
  readonly releaseLane: (ticket: TicketId, lane: string) => void
  /** 关单凭据吊销（17-§7「关单即吊销」；false=未签发过凭据——note 证据面） */
  readonly revokeCredential: (ticket: TicketId) => boolean
  /** 单据房间归档（失败 ESCALATE 不阻回收；缺省＝面未开） */
  readonly closeRoom?: (ticket: TicketId, carrier: IssueRecord, attempt: number) => Promise<void>
}

/**
 * 相位 6 回收（原 engine 内联体逐字保持）：已交付为终态、无平台迁移——释放泳道
 * ＋关单吊销凭证（17-§7）＋CLOSE 留痕＋房间归档（幂等，失败不阻回收）。
 * 工位＝**原位**归档（DEV-28/docs/43-§五）：tickets/<单号>/att<N> 证据不动（台账
 * report_ref/summary_ref 引用不断链）、员工家永不删。
 */
export async function runRecycleTransitions(
  host: WorkRecycleHost,
  queue: readonly RecycleAction[],
): Promise<number> {
  let recycled = 0
  for (const action of queue) {
    try {
      const fresh = await host.platform.issues.get(action.ticket)
      const lane = fresh.lane ?? host.defaultLane
      host.releaseLane(action.ticket, lane)
      const wkeyRevoked = host.revokeCredential(action.ticket)
      const attempt = host.attemptOf(action.ticket)
      await applyWorkTransition(host, {
        ticket: action.ticket,
        attempt,
        carrier: fresh,
        event: {
          name: 'CLOSE',
          extra: {
            note: `交付回收：泳道释放、工位原位归档=.AIWS 家保留（docs/43-§五；会话归档归后续刀）${wkeyRevoked ? '；wkey=关单吊销（17-§7）' : ''}`,
          },
        },
      })
      if (host.closeRoom !== undefined) await host.closeRoom(action.ticket, fresh, attempt)
      recycled += 1
      host.onMutation()
      host.actionResults.push({ ticket: action.ticket, actionType: action.type, ok: true, detail: `lane=${lane} 释放` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      host.errors.push(`recycle 失败 ${action.ticket}：${msg}`)
      host.actionResults.push({ ticket: action.ticket, actionType: action.type, ok: false, detail: msg })
    }
  }
  return recycled
}
