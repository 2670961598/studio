/**
 * recovery/closeout —— attempt 收口幂等键（task-158 / FIX-04；Kimi 总审 P0-04）
 *
 * 依据：docs/quality/idempotent-closeout.md §1；docs/17-§2 相位 4（STALL 响置）／相位 6（收割）；
 * docs/22-§三.2（回滚位别）；docs/sentinel-logs/全面Review拆分-2026-11-28.md §2.1 FIX-04。
 *
 * 病根：attempt 回退有五个互不知情的写者（收割失败面 failHarvest／STALL A 面 kill／STALL B 面
 * WORKER_DEAD／boot·周期孤儿扫描／stale-epoch 兜底），全部凭快照「已派发」直写迁移——启动扫描
 * 与拍内 B 面并发即同 attempt 双「新单」双连击（LOCAL-437/442：03:52:03.719Z/.806Z）。
 *
 * 两层（缺一不可）：
 *   L1 认领表——`rt.attemptCloseouts`（每单至多一条在册项）。认领=同步 Map 读写，JS 单线程下
 *      零 await 即原子：同 attempt 再认领=duplicate、旧 attempt 迟到=stale、新 attempt 覆盖；
 *      write 失败／平台态已变即释放，下次触发可再认领（重试幂等）。
 *   L2 现读复核——认领后、落迁移前再读平台：已非「已派发」即 state-changed 跳过（治跨重启：
 *      认领表为空而平台已回退；治同拍收割成功后被看门狗回滚）。
 * 单一出口：五写者一律 认领 → 现读复核 → write（迁移+事件；note 经 closeoutAnchored 落 closeout 锚）
 * → 仅胜出者断路连击。重复/过期触发不迁移、不落收口事件、不重复连击；各写者自身簿记 teardown 照做。
 * 边界：不改契约/事件词表（note 缀落既有 EventRecord.note 列）；不持模块级可变态（表在 rt）。
 */
import type { IssueRecord, TicketId } from '@studio-next/contract'

/** 收口写者（明报与审计 note 用；同一 attempt 至多一个胜出） */
export type CloseoutSource = 'harvest-fail' | 'stall-kill' | 'stall-worker-dead' | 'boot-orphan' | 'stale-epoch'

/** 在册项（认领即入册；write 失败/平台态已变即释放） */
export interface AttemptCloseout {
  readonly attempt: number
  readonly source: CloseoutSource
}

/** 认领表（驻 EngineRuntime.attemptCloseouts——每单至多一条：同单不可能并行两次派发回退） */
export type AttemptCloseoutRegistry = Map<TicketId, AttemptCloseout>

export type CloseoutClaim =
  | { readonly kind: 'claimed'; readonly ticket: TicketId; readonly key: string; readonly attempt: number; readonly source: CloseoutSource }
  | {
      /** duplicate=同 attempt 已认领（只生效一次）；stale=旧 attempt 迟到（平台已过该誓） */
      readonly kind: 'duplicate' | 'stale'
      readonly ticket: TicketId
      readonly key: string
      readonly attempt: number
      readonly source: CloseoutSource
      readonly holder: CloseoutSource
      readonly heldAttempt: number
    }

/** 收口结论：won=本次写者落迁移+事件；其余三种零平台写、零收口事件、零连击 */
export type CloseoutVerdict = 'won' | 'duplicate' | 'stale' | 'state-changed'

/** 收口键：`ticket@attempt`（attempt=正在被收口的那次派发的在册誓号） */
export function closeoutKeyOf(ticket: TicketId, attempt: number): string {
  return `${ticket}@${String(attempt)}`
}

/** task-157 冻结尾段的起始标记（GATE_FAIL/ESCALATE note 以 `…;errorKind=…;retryable=…` 收尾，逐字尾锚受测） */
const ERROR_KIND_TAIL = ';errorKind='

/**
 * closeout 锚入位：`;closeout=<键>;source=<写者>` 落在 errorKind 尾段**之前**（尾锚不动——幂等键
 * 是审计追加位，不得改写 task-157 既有 note 尾契约）；无 errorKind 尾段=直接追加。
 * `key=value;` 段解析两序皆成立（closeout 值不含 `;`）。
 */
export function closeoutAnchored(note: string, suffix: string): string {
  const at = note.lastIndexOf(ERROR_KIND_TAIL)
  return at < 0 ? `${note}${suffix}` : `${note.slice(0, at)}${suffix}${note.slice(at)}`
}

/**
 * 在册誓号（收口键第二槽）：在途条目 attempt → 该单最新工时行 attempt → 0（无账可依退化成
 * 单键，仍单键幂等）。各写者事件列既有 attempt 标注口径不变（孤儿扫描 attemptFor=下一誓号）。
 */
export function closeoutAttemptOf(
  rt: { readonly ledger: { listWorkRecords(filter: { issue: TicketId }): readonly { readonly attempt: number }[] } },
  ticket: TicketId,
  entry?: { readonly attempt: number },
): number {
  if (entry !== undefined) return entry.attempt
  let latest = 0
  for (const rec of rt.ledger.listWorkRecords({ issue: ticket })) latest = Math.max(latest, rec.attempt)
  return latest
}

/** 同步认领（调用方须在首个 await 之前调用——零 await 才原子） */
export function claimAttemptCloseout(
  registry: AttemptCloseoutRegistry,
  ticket: TicketId,
  attempt: number,
  source: CloseoutSource,
): CloseoutClaim {
  const held = registry.get(ticket)
  const key = closeoutKeyOf(ticket, attempt)
  if (held !== undefined) {
    if (held.attempt === attempt) return { kind: 'duplicate', ticket, key, attempt, source, holder: held.source, heldAttempt: held.attempt }
    if (attempt < held.attempt) return { kind: 'stale', ticket, key, attempt, source, holder: held.source, heldAttempt: held.attempt }
  }
  registry.set(ticket, { attempt, source })
  return { kind: 'claimed', ticket, key, attempt, source }
}

/** 释放认领（write 失败／平台态已变——下次触发可再认领） */
export function releaseAttemptCloseout(registry: AttemptCloseoutRegistry, ticket: TicketId, attempt: number): void {
  const held = registry.get(ticket)
  if (held !== undefined && held.attempt === attempt) registry.delete(ticket)
}

/** 新派发让位旧认领（誓号复用/降号场景，如崩溃窗后重派仍得 attempt=1：旧认领不得永判 duplicate/stale；正常递增保留旧认领防迟到） */
export function yieldAttemptCloseout(registry: AttemptCloseoutRegistry, ticket: TicketId, attempt: number): void {
  const held = registry.get(ticket)
  if (held !== undefined && held.attempt >= attempt) registry.delete(ticket)
}

export interface AttemptCloseoutSettle {
  readonly registry: AttemptCloseoutRegistry
  readonly claim: CloseoutClaim
  /** L2 现读复核（与 expectedState 成对；缺省=不复核——调用方函数首已现读且其间无 await） */
  readonly read?: () => Promise<IssueRecord>
  readonly expectedState?: string
  /** 胜出者执行：迁移+事件（note 经 closeoutAnchored 落 closeout 锚）；异常=释放认领后原样上抛 */
  readonly write: (suffix: string) => Promise<void>
}

/** 收口结算：未认领直接返回其类；已认领→现读复核→write（现读/写失败均释放认领后原样上抛） */
export async function settleAttemptCloseout(settle: AttemptCloseoutSettle): Promise<CloseoutVerdict> {
  const { registry, claim } = settle
  if (claim.kind !== 'claimed') return claim.kind
  try {
    if (settle.read !== undefined && settle.expectedState !== undefined) {
      if ((await settle.read()).state !== settle.expectedState) {
        releaseAttemptCloseout(registry, claim.ticket, claim.attempt)
        return 'state-changed'
      }
    }
    await settle.write(`;closeout=${claim.key};source=${claim.source}`)
    // 退化键（在册誓号 0=无工时行可依）胜出后即释放：同键再现=真新孤儿（如派发窗「平台已派发、
    // 工时行写入失败」再发），不得因键复用被永判 duplicate 卡死在已派发——零账写者（孤儿扫描/
    // stale 兜底）恒带 L2 现读门，不靠认领表判重。誓号≥1 胜出后在册保留：同 attempt 晚到的
    // 收割失败面/kill 面无现读门，须靠认领表判重（LOCAL-437/442 同 attempt 双回退）。
    if (claim.attempt === 0) releaseAttemptCloseout(registry, claim.ticket, claim.attempt)
  } catch (err) {
    releaseAttemptCloseout(registry, claim.ticket, claim.attempt)
    throw err
  }
  return 'won'
}

/**
 * 未胜出触发的明报文案（各写者落各自通道：动作 detail／拍 errors／扫描计数）。
 * claimed 而未胜出=仅 state-changed 一种（认领后现读平台态已非已派发）。
 */
export function closeoutSkipNote(claim: CloseoutClaim): string {
  if (claim.kind === 'claimed') return `收口跳过：${claim.key} 平台态已非已派发（已回退/已收口——幂等不双写）`
  return claim.kind === 'duplicate'
    ? `收口重复：${claim.key} 已由 ${claim.holder} 认领——幂等不重复回退/不重复连击`
    : `收口过期：${claim.key} 为旧 attempt（在册 ${claim.holder}@${String(claim.heldAttempt)}）——幂等跳过`
}
