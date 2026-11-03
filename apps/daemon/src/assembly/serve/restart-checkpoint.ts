/**
 * serve/restart-checkpoint —— 受权重启检查点落盘步（摘要对象→RESTART 事件→原子写→哈希核对→kv）
 *
 * 依据（实现单引用）：#497 §4.5（检查点协议：事件先行→摘要 JSON→kv→WAL checkpoint→close→
 *   last-exit.json，顺序即正确性）；docs/17-§2（拍边界收口，不增删主循环相位）；
 *   docs/17-§6（收割四要件零变更——本件只做重启留痕，不判定收割）；
 *   docs/20-§十五.三（600 行阈：run.ts 拆件后原文件余量 ≥50，行为零漂移）。
 *
 * 边界：本件只搬「检查点对象构造 + RESTART 事件 + 写盘 + 哈希核对 + kv 登记」纯步；
 *   draining 结算、stop() 收口、last-exit 标记、失败告警与返回控制流仍在 run.ts（控制流不变）。
 */
import path from 'node:path'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../../engine/tools/id.ts'
import type { DrainSettleResult } from '../../engine/drain/drain.ts'
import {
  appendRestartEvent,
  eventMetaOf,
  RESTART_USED_KV_PREFIX,
  restartNote,
  type RestartRequest,
} from '../../control/restart/channel.ts'
import {
  checkpointPathOf,
  sha256,
  writeRestartCheckpoint,
  type RestartCheckpoint,
  type RestartSettledItem,
} from '../../control/restart/checkpoint.ts'

/** runServe 内的受权重启编排态（拆件前为 run.ts 内联匿名类型；形状逐字不变） */
export interface RestartRunCtx {
  request: RestartRequest
  authorizationRef: string
  authorizer: { personId: string; role: string; level: number }
  /** draining 截止时刻（run.ts 结算判据；本件不消费，形状保持） */
  deadline: number
  inflightAtRequest: number
  startRunningIds: readonly string[]
  inconsistent: boolean
}

export interface RestartCheckpointStep {
  written: { path: string; hash: string }
  checkpointPath: string
  checkpointHash: string
  tickSeq: number
  settled: RestartSettledItem[]
  interrupted: RestartSettledItem[]
}

/**
 * 检查点第 5 步先行（WAL 收干；失败=检查点失败，不静默）——随后事件/摘要/kv。
 * 顺序与拆件前逐字一致：WAL→tickSeq/cursor→settled/interrupted→摘要对象→事件→写盘→
 * 哈希核对→kv 登记；任一步抛错由 run.ts catch 收口（exit 非 0 + ALARM，不写 authorized）。
 */
export function writeRestartCheckpointStep(args: {
  ledger: Ledger
  company: string
  dbPath: string
  rootDir: string
  ctx: RestartRunCtx
  settle: DrainSettleResult | undefined
  snapshot: Parameters<typeof eventMetaOf>[0]
}): RestartCheckpointStep {
  const { ledger, company, dbPath, rootDir, ctx, settle, snapshot } = args
  const meta = eventMetaOf(snapshot, ctx.authorizer.personId, company)
  const wal = ledger.checkpoint()
  const tickSeq = Number(ledger.kvGet('tick.seq') ?? '0')
  const cursorRaw = ledger.kvGet('activity.cursor')
  const cursor = cursorRaw === null || cursorRaw === '' ? null : cursorRaw
  const interrupted: RestartSettledItem[] = (settle?.interrupted ?? []).map((i) => ({ issue: i.ticket, attempt: i.attempt, status: 'interrupted' }))
  const interruptedIds = new Set((settle?.interrupted ?? []).map((i) => i.workRecordId))
  const settled: RestartSettledItem[] = []
  for (const id of ctx.startRunningIds) {
    if (interruptedIds.has(id)) continue // 超时收口单只进 interrupted 清单，不重复计 settled
    const rec = ledger.getWorkRecord(id)
    if (rec !== undefined && rec.status !== 'running') settled.push({ issue: rec.issue, attempt: rec.attempt, status: rec.status })
  }
  const eventId = makeUlid(Date.now())
  const checkpoint: RestartCheckpoint = {
    schema: 1,
    requestId: ctx.request.id,
    at: Date.now(),
    company,
    reason: ctx.request.reason,
    authorizer: ctx.authorizer,
    authorizationRef: ctx.authorizationRef,
    exitClass: 'restart',
    tickSeq,
    cursor,
    inflightBefore: ctx.inflightAtRequest,
    settled,
    interrupted,
    inconsistent: ctx.inconsistent,
    ledger: { path: dbPath, walBefore: wal.walBefore, walAfter: wal.walAfter },
    repoHead: null,
    assetFingerprint: null,
    eventId,
  }
  const checkpointPath = checkpointPathOf(rootDir, ctx.request.id)
  const checkpointHash = sha256(`${JSON.stringify(checkpoint, null, 2)}\n`)
  appendRestartEvent(ledger, {
    company,
    ...meta,
    now: Date.now(),
    eventId,
    note: restartNote('done', [
      ['cause', ctx.request.reason],
      ['authorizer', ctx.authorizer.personId],
      ['authorization_ref', ctx.authorizationRef],
      ['inflight_before', ctx.inflightAtRequest],
      ['settled', settled.length],
      ['interrupted', interrupted.length],
      ['checkpoint', `${path.relative(rootDir, checkpointPath)}@${checkpointHash}`],
      ['exit_class', 'restart'],
      ['request_id', ctx.request.id],
    ]),
  })
  const written = writeRestartCheckpoint(rootDir, checkpoint)
  if (written.hash !== checkpointHash) throw new Error(`检查点哈希不一致：写盘=${written.hash} 事件=${checkpointHash}`)
  ledger.kvSet('restart.lastCheckpoint', JSON.stringify({ path: written.path, hash: written.hash }))
  ledger.kvSet(`${RESTART_USED_KV_PREFIX}${ctx.authorizationRef}`, ctx.request.id)
  return { written, checkpointPath, checkpointHash, tickSeq, settled, interrupted }
}
