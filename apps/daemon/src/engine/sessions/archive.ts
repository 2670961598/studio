/**
 * engine/sessions/archive —— 会话归档接线体（studio-dev-551）
 *
 * 依据（实现单引用）：
 *   - docs/17-§2 主循环七相位（派发/收割/看护的落点）；
 *   - docs/17-§3 sessions 行（归档索引列集零变更）；
 *   - docs/17-§6 收割四要件（记录落库在判定**之后**，写失败不倒推 GATE 结论）；
 *   - docs/v2/07-§五 EXEC-04（会话证据归档收割入台账＝V07-P2-2 追账项）。
 *
 * 相位映射（生产写者=本件）：
 *   3 派发  startSessionArchive：会话一产生即 insertSession(start 行)——写失败抛
 *           SESSION_ARCHIVE_START_FAILED，外层 catch= DISPATCH_FAIL＋kill worker（无归档不派，
 *           fail-closed；会话行缺失即台账不可见，不静默跑）。
 *   4 收割  closeSessionArchive：ended_at＋turns＋archive_path；行缺失=明报不补插（不冒认归档）。
 *   4 看护  closeSessionArchive：STALL 咬合 kill 面/消亡面同体收口，不留 ended_at=NULL。
 *   启动例行 closeSessionsOfRunningRecords：R-B 接管孤儿的会话同体收口（非第八相位）。
 *
 * 守护计时口径（**不新增列/不新增事件名**）：
 *   - 在工 inflightMs = ended_at − started_at（sessions 行真值）；
 *   - 静默 silentMs = ended_at − 最后活性锚（studio-dev-505 同源：会话 mtime 优先、流事件次之；
 *     **无锚不造数**——无证据只记 inflightMs）；
 *   - 计时值随事件 note 锚（`session=<id>:closed;inflightMs=…;silentMs=…`）与行同拍落账。
 *
 * 边界：本件不判定收割四要件、不写事件、不改契约/列集/事件枚举；探活复用 adapters 既有
 * `probeExecutorActivity`（纯读，无新端口）。
 */
import { probeExecutorActivity } from '@studio-next/adapters'
import type { Ledger } from '@studio-next/store'
import type { Inflight } from '../tick/types.ts'

/** 派发期 start 行入参 */
export interface StartSessionInput {
  ticket: string
  personId: string
  sessionId: string
  at: number
}

/**
 * 相位 3：会话 start 行落库（失败抛——调用方 catch 走 DISPATCH_FAIL，无归档不派）。
 * 续跑（202-P2：同一 executor 会话 id 复用）已存在行=不重插（一会话一行，非静默丢写）。
 */
export function startSessionArchive(ledger: Ledger, input: StartSessionInput): void {
  if (ledger.getSession(input.sessionId) !== undefined) return
  try {
    ledger.insertSession({
      session_id: input.sessionId,
      issue: input.ticket,
      person_id: input.personId,
      started_at: input.at,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`SESSION_ARCHIVE_START_FAILED：session=${input.sessionId} issue=${input.ticket}：${msg}`)
  }
}

/** 收口入参（entry 在场=可探归档路径/活性锚；缺省=只有台账面的会话 id 可收口） */
export interface CloseSessionInput {
  ticket: string
  at: number
  sessionId?: string
  entry?: Inflight
  turns?: number
  onProblem?: (message: string) => void
}

/** 收口结果（noteSegment=事件 note 尾锚；status=closed|missing|failed|skipped） */
export interface CloseSessionResult {
  status: 'closed' | 'missing' | 'failed' | 'skipped'
  noteSegment: string
}

/** 相位 4/看护/接管：会话收口（行缺失=明报不补插；已收口=幂等 closed，不重复写） */
export function closeSessionArchive(ledger: Ledger, input: CloseSessionInput): CloseSessionResult {
  const sessionId = input.sessionId ?? input.entry?.handle.sessionId
  if (sessionId === undefined || sessionId === '') {
    return { status: 'skipped', noteSegment: ';session=未登记（无 executor 会话 id，归档收口跳过）' }
  }
  const existing = ledger.getSession(sessionId)
  if (existing === undefined) {
    const message = `会话归档缺失，未收口（不臆造补插）：session=${sessionId} issue=${input.ticket}`
    input.onProblem?.(message)
    return { status: 'missing', noteSegment: `;session=${sessionId}:missing（${message}）` }
  }
  const timing = timingSegment(existing.started_at, input)
  if (existing.ended_at !== undefined) {
    return { status: 'closed', noteSegment: `;session=${sessionId}:closed(already)${timing}` }
  }
  const archivePath = archivePathOf(existing.archive_path, input)
  try {
    ledger.endSession(sessionId, {
      ended_at: input.at,
      ...(input.turns !== undefined ? { turns: input.turns } : {}),
      ...(archivePath !== undefined ? { archive_path: archivePath } : {}),
    })
  } catch (err) {
    const message = `会话收口写失败：session=${sessionId} issue=${input.ticket}：${err instanceof Error ? err.message : String(err)}`
    input.onProblem?.(message)
    return { status: 'failed', noteSegment: `;session=${sessionId}:failed（${message}）` }
  }
  return {
    status: 'closed',
    noteSegment: `;session=${sessionId}:closed${timing}${archivePath !== undefined ? `;archive=${archivePath}` : ''}`,
  }
}

/**
 * 启动接管（R-B）：前命孤儿 running 工位的会话同体收口（接管≠收割——本件不判定四要件）。
 * 返回收口条数与问题（行缺失/写失败明报，不静默）。
 */
export function closeSessionsOfRunningRecords(
  ledger: Ledger,
  now: number,
): { closed: number; problems: ReadonlyArray<string> } {
  const problems: string[] = []
  let closed = 0
  for (const rec of ledger.listWorkRecords()) {
    if (rec.status !== 'running' || rec.ended_at !== undefined) continue
    if (rec.session_id === undefined) continue
    const result = closeSessionArchive(ledger, {
      ticket: rec.issue,
      at: now,
      sessionId: rec.session_id,
      onProblem: (message) => problems.push(message),
    })
    if (result.status === 'closed') closed += 1
  }
  return { closed, problems }
}

/** 归档路径：只在行内尚无可用的 archive_path 时探（dsh 会话落盘件；其余 executor 如实缺省） */
function archivePathOf(current: string | undefined, input: CloseSessionInput): string | undefined {
  if (current !== undefined) return undefined
  const entry = input.entry
  if (entry === undefined || entry.handle.executorSessionId === undefined) return undefined
  const probe = probeExecutorActivity({
    executor: entry.executor,
    executorSessionId: entry.handle.executorSessionId,
    now: input.at,
  })
  return probe.sessionPath
}

/** 守护计时尾锚（inflightMs 恒有；silentMs 仅在活性锚在场时记录——无锚不造数） */
function timingSegment(startedAt: number, input: CloseSessionInput): string {
  const inflightMs = Math.max(0, input.at - startedAt)
  let silentMs: number | undefined
  const entry = input.entry
  if (entry?.handle.executorSessionId !== undefined) {
    const probe = probeExecutorActivity({
      executor: entry.executor,
      executorSessionId: entry.handle.executorSessionId,
      now: input.at,
    })
    if (probe.lastActivityAt !== undefined) silentMs = Math.max(0, Math.round(input.at - probe.lastActivityAt))
  }
  if (silentMs === undefined && entry?.lastStreamEventAt !== undefined) {
    silentMs = Math.max(0, Math.round(input.at - entry.lastStreamEventAt))
  }
  return `;inflightMs=${inflightMs}${silentMs !== undefined ? `;silentMs=${silentMs}` : ''}`
}
