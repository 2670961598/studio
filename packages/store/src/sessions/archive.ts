/**
 * sessions/archive —— 会话归档收口面（studio-dev-551）
 *
 * 依据（实现单引用）：
 *   - docs/17-§3 sessions 行（session_id / issue / 工号 / archive_path / started / ended / turns）；
 *   - docs/17-§6 收割四要件（记录落库在判定**之后**——写失败不倒推 GATE 结论）；
 *   - docs/v2/07-§五 EXEC-04（会话证据归档收割入台账；V07-P2-2 追账项）。
 *
 * 写面语义（与 endWorkRecord 同构，收口只允许一次）：
 *   - 行缺失=false：调用方明报「未收口」，**绝不**补插冒认归档；
 *   - 已收口再收=CONFIG_INVALID（拒绝静默覆盖；调用方先读再收=幂等面归 daemon）；
 *   - archive_path / turns 可缺省：COALESCE 只补不清（**无证据不造数**）。
 *
 * 边界：本件只写 sessions 行，不判定、不写事件、不探活——判定与观测归 daemon 引擎相位
 * （apps/daemon/src/engine/sessions/archive.ts）；列集/事件枚举零变更（契约面不动）。
 */
import type { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { configInvalid } from '@studio-next/contract'

/** 收口入参（sessions end 面；ended_at 必填，turns/archive_path 可选=COALESCE 只补不清） */
export const EndSessionSchema = z.strictObject({
  ended_at: z.number().int().min(0),
  archive_path: z.string().min(1).optional(),
  turns: z.number().int().min(0).optional(),
})

export type EndSession = z.infer<typeof EndSessionSchema>

/** 品牌形状（与 EndSessionSchema 同源；供 ledger 接口声明零重复） */
export interface EndSessionInput {
  ended_at: number
  archive_path?: string
  turns?: number
}

/**
 * 收口一次会话行（单语句原子；先读后写——daemon 单写者前提）。
 * @returns true=已收口；false=行不存在（调用方明报，不补插）
 */
export function endSessionRecord(db: DatabaseSync, sessionId: string, input: EndSessionInput): boolean {
  if (typeof sessionId !== 'string' || sessionId === '') {
    configInvalid('store/session:bad-id', 'session_id 须为非空字符串（sessions 主键）')
  }
  const parsed = EndSessionSchema.safeParse(input)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first === undefined ? '(root)' : first.path.map(String).join('.')
    configInvalid(`store/session:end-invalid:${path}`, first === undefined ? undefined : `${path}: ${first.message}`)
  }
  const r = parsed.data
  const existing = db.prepare('SELECT ended_at FROM sessions WHERE session_id = ?').get(sessionId) as
    | { ended_at: unknown }
    | undefined
  if (existing === undefined) return false
  if (existing.ended_at !== null && existing.ended_at !== undefined) {
    configInvalid('store/session:already-ended', `会话 ${sessionId} 已收口（ended_at=${String(existing.ended_at)}）——收口只允许一次`)
  }
  db.prepare(
    `UPDATE sessions SET ended_at = ?,
       archive_path = COALESCE(?, archive_path), turns = COALESCE(?, turns)
     WHERE session_id = ?`,
  ).run(r.ended_at, r.archive_path ?? null, r.turns ?? null, sessionId)
  return true
}
