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

/** ticket_mirror 期望行（IssueRecord→镜像列；created 以 updated 近似——拟稿见头注） */
export interface MirrorRowLike {
  readonly issue: string
  readonly company: string
  readonly created: number
  readonly updated: number
  readonly state: string
  readonly type: string
  readonly dept: string
  readonly level: number
  readonly dispatcher: string
  readonly parent?: string | null
  readonly lane?: string | null
  readonly assignee?: string | null
}

/** 由 IssueRecord 计算期望镜像行（纯函数；collect 增量比对与 syncMirror 共用单一源） */
export function mirrorRecordOf(rt: EngineRuntime, issue: IssueRecord): MirrorRowLike {
  const updatedMs = Date.parse(issue.updated)
  const safe = Number.isNaN(updatedMs) ? rt.now() : updatedMs
  return {
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
    ...(issue.assignee !== undefined ? { assignee: issue.assignee } : {}),
  }
}

/**
 * 现有镜像行 vs 期望行是否有差异（studio-dev-790 v3 增量 upsert）：全字段比较，
 * 相同=跳过写（可重建投影语义不变；GC 仍按平台活动集全量对账删除）。
 */
export function mirrorRowDiffers(
  current: (Partial<MirrorRowLike> & { issue?: unknown }) | undefined,
  next: MirrorRowLike,
): boolean {
  if (current === undefined) return true
  const cur = current as Partial<MirrorRowLike>
  const same = (a: unknown, b: unknown): boolean => (a ?? null) === (b ?? null)
  return !(
    same(cur.company, next.company) &&
    same(cur.created, next.created) &&
    same(cur.updated, next.updated) &&
    same(cur.state, next.state) &&
    same(cur.type, next.type) &&
    same(cur.dept, next.dept) &&
    same(cur.level, next.level) &&
    same(cur.dispatcher, next.dispatcher) &&
    same(cur.parent ?? null, next.parent ?? null) &&
    same(cur.lane ?? null, next.lane ?? null) &&
    same(cur.assignee ?? null, next.assignee ?? null)
  )
}

/**
 * 增量镜像 upsert（studio-dev-790 v3）：与现有 ticket_mirror 行全字段比对，未变跳过写。
 * 可重建投影语义不变：本拍平台全量对账仍完成；删除残行归 mirror GC（runMirrorGcTick）。
 * @returns 实际写入行数（观测/测试用）
 */
export function syncMirrorsIncremental(rt: EngineRuntime, issues: readonly IssueRecord[]): number {
  const current = new Map(rt.ledger.listTicketMirrors().map((row) => [row.issue, row]))
  let writes = 0
  for (const issue of issues) {
    const next = mirrorRecordOf(rt, issue)
    if (!mirrorRowDiffers(current.get(issue.id), next)) continue
    syncMirror(rt, issue)
    writes += 1
  }
  return writes
}

/** ticket_mirror upsert（IssueRecord→镜像列；created 以 updated 近似——拟稿见头注） */
export function syncMirror(rt: EngineRuntime, issue: IssueRecord): void {
  rt.ledger.upsertTicketMirror(mirrorRecordOf(rt, issue))
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
