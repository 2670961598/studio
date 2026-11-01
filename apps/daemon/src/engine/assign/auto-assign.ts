// ▸ 落仓路径：apps/daemon/src/engine/assign/auto-assign.ts（新文件，全文照抄）
// ▸ engine.ts 接线缝：见 edit-apps-daemon-src-engine-engine.ts.md（薄缝四处）

/**
 * assign/auto-assign —— 自动派工分配器引擎接线（轨2 R1 登记项①，studio-dev-345）
 *
 * 分层：判定=纯函数 core pickAssignee（回放面）；本件=引擎侧运行面装配与两处接线：
 *   - autoAssignPickOf：决策位投影（state-diff，docs/17-§2 相位 2）——给开工门
 *     personIdOf 与同拍占用记账（dispatchPersons）供人选；面关/已指派/失败=undefined
 *     （回退旧链 assignee→defaultPersonId→people[0]，行为零变；失败回退仅作人闸参考，
 *     执行位重算仍失败=顺延——fail-closed 不派缺省人）；
 *   - resolveDispatchPerson：执行位权威（executeDispatch，相位 3）——面开且无
 *     assignee 时选人+**写回平台**（assignee 落平台=镜像/读面分级/房间/续跑链同源，
 *     无一旁路）+游标落账（daemon_kv，部门一键；只在成功写回后 +1——落账纪律）+
 *     note 观测锚 `;autoassign=<工号>`。
 *
 * 在途口径（与人闸快照 personGateSnapshot 同源）：内存 Inflight 各 entry.personId
 * 计数 + 本拍 dispatchPersons 计数——两段式先决后执拍内即时生效（129-§6.2-R3 同款）。
 *
 * 竞态面：执行位取 fresh 后 assignee 已被人指派（决策-执行间隙人工介入）→ 走旧链
 * 尊重人的指派（人的字面 > 自动分配；自动派工只补位，永不覆盖明确指派）。
 *
 * 落位：engine/assign/ 子目录（engine 域平面已满 13 件冻结基线 BC-V3，contrib 模式
 * 新特性开 <域>/<特性>/ 子文件夹）；行预算纪律见 engine.ts 编辑说明（先拆再增）。
 */
import { pickAssignee } from '@studio-next/core'
import type { FlowPlatform, IssueRecord, PersonRef, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import type { EngineConfig, Inflight } from '../tick/types.ts'

/**
 * 分配器选人携带面（决策位 → 执行位同源：dispatchQ 条目字段；两段式先决后执不重算
 * 不漂移——执行失败=下拍重选，游标未前进无烧位）
 */
export interface AutoAssignCarry {
  personId: string
  nextCursor: number
}

/** 引擎运行面（engine.ts 拍作用域装配；people 经 getter——L1 热替换取活名册） */
export interface AssignRuntime {
  people: () => readonly PersonRef[]
  config: EngineConfig
  /** 人闸帽（与人闸快照同一份——分配器与人闸共用一套帽，engine.ts personLimits 直传） */
  personLimits: { overrides: Readonly<Record<string, number>>; defaultLimit: number | undefined }
  inflight: ReadonlyMap<TicketId, Inflight>
  ledger: Ledger
  platform: FlowPlatform
}

/**
 * 派工对象解析链（旧链原样收口，自 engine.ts 拆入——轨2 R1① 归域+行基线清偿）：
 * assignee → defaultPersonId → people[0]。people/defaultPersonId 经 getter 取活值
 * （L1 热替换即随换，语义与原闭包逐字节一致）。
 */
export function personOf(
  people: () => readonly PersonRef[],
  defaultPersonId: () => string,
  issue: { assignee?: string },
): PersonRef | undefined {
  const roster = people()
  return (
    (issue.assignee !== undefined ? roster.find((p) => p.id === issue.assignee) : undefined) ??
    roster.find((p) => p.id === defaultPersonId()) ??
    roster[0]
  )
}

/** 轮转游标持久键（部门一键：部门 A 的轮转不被部门 B 取位扰动；daemon_kv 正式面） */
export function assignCursorKey(dept: string): string {
  return `assign.cursor.v1:${dept}`
}

/** 在工计数投影：内存 Inflight + 本拍已排队派发（与人闸快照同口径同源） */
function inflightProjection(
  rt: AssignRuntime,
  dispatchPersons: ReadonlyMap<TicketId, string>,
): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const entry of rt.inflight.values()) counts[entry.personId] = (counts[entry.personId] ?? 0) + 1
  for (const personId of dispatchPersons.values()) counts[personId] = (counts[personId] ?? 0) + 1
  return counts
}

/** 游标读（daemon_kv；坏值视同 0——fail-closed 不猜） */
function readCursor(rt: AssignRuntime, dept: string): number {
  const raw = rt.ledger.kvGet(assignCursorKey(dept))
  const n = raw !== null ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/**
 * 决策位分配器投影：面开且无 assignee → 选中人携带（personId+nextCursor）；否则
 * undefined（面关/已指派=旧链；分配器失败=undefined——调用面回退旧链仅作人闸参考，
 * 真正的失败处理归执行位 resolveDispatchPerson 权威重算）。
 */
export function autoAssignPickOf(
  rt: AssignRuntime,
  issue: { dept?: string; assignee?: string },
  dispatchPersons: ReadonlyMap<TicketId, string>,
): AutoAssignCarry | undefined {
  if (rt.config.autoAssign !== true || issue.assignee !== undefined) return undefined
  const dept = issue.dept ?? rt.config.deptFallback
  const result = pickAssignee({
    dept,
    people: rt.people(),
    inflightByPerson: inflightProjection(rt, dispatchPersons),
    limits: {
      ...(Object.keys(rt.personLimits.overrides).length > 0 ? { overrides: rt.personLimits.overrides } : {}),
      ...(rt.personLimits.defaultLimit !== undefined ? { defaultLimit: rt.personLimits.defaultLimit } : {}),
    },
    cursor: readCursor(rt, dept),
  })
  return result.ok ? { personId: result.personId, nextCursor: result.nextCursor } : undefined
}

export type DispatchPersonResolution =
  | { ok: true; person: PersonRef; autoAssignNote?: string }
  | { ok: false; detail: string }

/**
 * 派发执行位选人（权威）：面开且无 assignee → 决策携带优先（先决后执同源），无携带
 * 则重算一次；成功=写回平台+游标落账+本地补值+note 锚；仍失败=fail-closed 顺延明细
 * （不回退缺省人——错人比不派更糟）。面关/已指派=旧链 personOf。
 */
export async function resolveDispatchPerson(
  rt: AssignRuntime,
  args: {
    ticket: TicketId
    fresh: IssueRecord
    carried?: AutoAssignCarry
    dispatchPersons?: ReadonlyMap<TicketId, string>
  },
): Promise<DispatchPersonResolution> {
  if (rt.config.autoAssign === true && args.fresh.assignee === undefined) {
    const pick =
      args.carried ??
      autoAssignPickOf(rt, args.fresh, args.dispatchPersons ?? new Map<TicketId, string>())
    if (pick === undefined) {
      return {
        ok: false,
        detail: '自动派工无候选人（部门无人在帽下：no-people/dept-empty/no-active/all-at-cap 之一）——顺延不丢单（fail-closed 不回退缺省人）',
      }
    }
    const chosen = rt.people().find((p) => p.id === pick.personId)
    if (chosen === undefined) {
      return { ok: false, detail: `自动派工选人 ${pick.personId} 不在人事索引——顺延（人员配置漂移明报，不猜缺省人）` }
    }
    await rt.platform.issues.setField(args.ticket, 'assignee', chosen.id)
    rt.ledger.kvSet(assignCursorKey(chosen.dept), String(pick.nextCursor))
    args.fresh.assignee = chosen.id // 下游（tier/readTier/rooms）与镜像经平台回读同源
    return { ok: true, person: chosen, autoAssignNote: `;autoassign=${chosen.id}` }
  }
  const person = personOf(rt.people, () => rt.config.defaultPersonId, args.fresh)
  if (person === undefined) return { ok: false, detail: '人员索引为空（people 未注入）——不派工' }
  return { ok: true, person }
}
