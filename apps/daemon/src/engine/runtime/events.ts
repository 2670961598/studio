/**
 * engine/runtime/events.ts —— 事件落账／镜像 upsert／迁移宿主（原 createEngine 内三闭包）
 *
 * 20-§十五「按域拆件、零行为变更」：函数体自 engine.ts 逐字迁移，唯一差异是外部引用经
 * `rt`（EngineRuntime）取——`appendEvent` 仍是唯一写口（appended=false 不入拍汇报），
 * actor 取构造期校验后的写署名（SEC-FC-06），镜像 created 仍以 updated 近似（拟稿见
 * engine.ts 头注）。
 */
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import type { WorkTransitionHost } from '../work/transition.ts'
import { evtDept, evtLevel } from '../sentinel/shape.ts'
import type { EngineEventExtra, EngineRuntime } from './types.ts'

/** 事件落账（appendEvent=唯一写口；appended=false 不入拍汇报）；actor=构造期校验后写署名（SEC-FC-06） */
export function emitEvent(
  rt: EngineRuntime,
  name: EventRecord['event'],
  issue: IssueRecord,
  attempt: number,
  tickEvents: EventRecord[],
  extra?: EngineEventExtra,
): EventRecord {
  const ts = rt.now()
  const rec: EventRecord = {
    id: rt.makeId(ts),
    ts,
    company: rt.config.company,
    issue: issue.id,
    event: name,
    actor: rt.writeActor,
    attempt,
    level: evtLevel(issue),
    dept: evtDept(issue, rt.config.deptFallback),
    tokens: extra?.tokens ?? { input: 0 },
    ...(extra?.cost_usd !== undefined ? { cost_usd: extra.cost_usd } : {}),
    ...(extra?.duration_ms !== undefined ? { duration_ms: extra.duration_ms } : {}),
    ...(extra?.size !== undefined ? { size: extra.size } : {}),
    ...(extra?.payload_hash !== undefined ? { payload_hash: extra.payload_hash } : {}),
    ...(extra?.note !== undefined ? { note: extra.note } : {}),
    ...(extra?.causation_id !== undefined ? { causation_id: extra.causation_id } : {}),
  }
  if (rt.ledger.appendEvent(rec).appended) tickEvents.push(rec)
  return rec
}

/** ticket_mirror upsert（IssueRecord→镜像列；created 以 updated 近似——拟稿见头注） */
export function syncMirror(rt: EngineRuntime, issue: IssueRecord): void {
  const updatedMs = Date.parse(issue.updated)
  const safe = Number.isNaN(updatedMs) ? rt.now() : updatedMs
  rt.ledger.upsertTicketMirror({
    issue: issue.id,
    company: rt.config.company,
    created: safe,
    updated: safe,
    state: issue.state,
    type: issue.type ?? 'task',
    dept: evtDept(issue, rt.config.deptFallback),
    level: evtLevel(issue),
    dispatcher: rt.writeActor,
    ...(issue.parent !== undefined ? { parent: issue.parent } : {}),
    ...(issue.lane !== undefined ? { lane: issue.lane } : {}),
    // 队列归属键（129-§6.2-R3：assignee 复用不新建）——todo_queue 投影 person 列的
    // 镜像源（store v8 列）；派发侧 resolvePerson 同源链（assignee→defaultPersonId）
    ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
  })
}

/**
 * 状态迁移执行宿主（IMPL-06-02）：迁移→镜像→触发记录顺序归 work/transition.ts，
 * 本件只把引擎闭包绑到本拍事件流（三闭包＝platform／syncMirror／emit，与拆前同源）。
 */
export function transitionHostOf(rt: EngineRuntime, tickEvents: EventRecord[]): WorkTransitionHost {
  return {
    platform: rt.platform,
    syncMirror: (issue) => syncMirror(rt, issue),
    emit: (name, issue, attempt, extra) => emitEvent(rt, name, issue, attempt, tickEvents, extra),
  }
}
