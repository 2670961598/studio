/**
 * engine/runtime/flow.ts —— 定流／派工对象解析／最新工时行（原 createEngine 内小闭包）
 *
 * 三面都是**纯读**闭包（无事件无迁移）：定流解析序与 decide 步2 同函数（T:<type> 优先→
 * L:<level> 回退，DEV-43）；派工对象链 assignee→defaultPersonId→people[0]（体拆入
 * assign/auto-assign.ts，热替换经 getter 取活值）；最新工时行=work_records 按
 * started_at 升序取末（studio-dev-505 活性锚）。
 */
import type { PersonRef, TicketId } from '@studio-next/contract'
import type { StateFlow } from '@studio-next/core'
import { DEFAULT_FLOW_TABLE, resolveTicketFlow } from '@studio-next/core'
import type { WorkRecord } from '@studio-next/store'
import { personOf } from '../assign/auto-assign.ts'
import type { EngineRuntime } from './types.ts'

/** 派工对象解析链（assignee→defaultPersonId→people[0]）——体在 assign/auto-assign.ts，语义逐字节一致 */
export function resolvePerson(rt: EngineRuntime, issue: { assignee?: string }): PersonRef | undefined {
  return personOf(() => rt.people, () => rt.config.defaultPersonId, issue)
}

/** 定流（DEV-43 解析序与 decide 步2 同函数：T:<type> 优先→L:<level> 回退，永不漂移） */
export function flowOf(rt: EngineRuntime, issue: { type?: string; level?: number }): StateFlow | undefined {
  return resolveTicketFlow(rt.config.flows ?? DEFAULT_FLOW_TABLE, issue.type, issue.level)
}

/**
 * 该单最新工时行（work_record；listWorkRecords 按 started_at 升序——取末即最新）。
 * 用途：无在途句柄时的活性锚与「worker 确定性消亡（interrupted）」判定（studio-dev-505）。
 */
export function latestRecordOf(rt: EngineRuntime, ticket: TicketId): WorkRecord | undefined {
  const records = rt.ledger.listWorkRecords({ issue: ticket })
  return records[records.length - 1]
}
