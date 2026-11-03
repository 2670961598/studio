/**
 * authority-evidence —— 授权判定证据的台账落点（studio-dev-579：证据落账，非仅日志）
 *
 * 依据（实现单引用）：
 *   - docs/v2/08 §1.9（授权判定证据实例：落点 events、形状=AuthorityEvidence、可 SQL 复算）；
 *   - docs/v2/15 §一 SEC-FC-08（「只 log 不落账」＝禁止形态；证据先落账再放行）；
 *   - docs/17-§2（写路径经 gated-platform 收口）、docs/17-§6（收割四要件：判定必须留痕）。
 *
 * 落点约定（additive，不改 events 契约）：
 *   - `events.event = 'GW_AUTHORITY_DECISION'`（`GW_` 前缀族既有通道；EventNameSchema 双通道
 *     允许，无需改 EVENT_NAMES/contract）；
 *   - `events.issue` = 判定输入单号（空则回退控制面哨兵单号）；`events.payload_hash` = evidenceId
 *     （一等列，便于索引查询）；
 *   - `events.note` = 紧凑 JSON（schemaRef=authority-evidence/v1），逐字段=AuthorityEvidence
 *     的形状（mode/state/action/ticket/evidenceId/chain/refusals/atMs/…）——SQL 可直接
 *     `json_extract` 复算与对账。
 *
 * 边界：值无密钥（不写签根/凭据/正文）；落账失败由 authority-gate 的 decide() 捕获并转为
 * `gw-authority-evidence-failed` 拒绝（无留痕不放行，fail-closed）。
 */
import type { EventRecord } from '@studio-next/contract'
import { canonicalizeJson, sha256Hex, type AuthorityRefusal, type PolicyState } from '@studio-next/core'
import { CONTROL_TICKET } from '@studio-next/gateway'
import type { AuthorityEvidence, AuthorityEvidenceSink, AuthorityMode } from './authority-gate.ts'
import { makeUlid } from './id.ts'

/** 授权判定证据的台账事件名（GW_ 前缀族；新增名不触碰 contract 冻结枚举） */
export const AUTHORITY_EVIDENCE_EVENT = 'GW_AUTHORITY_DECISION' as const

/** note JSON 内的形状引用（读面按此判版本；后续扩字段走新 ref，不静默改旧行） */
export const AUTHORITY_EVIDENCE_SCHEMA_REF = 'authority-evidence/v1' as const

/** 台账写面最小接口（不依赖 store 包句柄，测试可注入捕获数组） */
export interface AuthorityEvidenceLedgerFace {
  appendEvent(record: unknown): unknown
}

export interface AuthorityEvidenceLedgerSinkOptions {
  readonly ledger: AuthorityEvidenceLedgerFace
  /** 公司 slug（events.company；与 daemon 同一事实源） */
  readonly company: string
  /** 事件 actor（可还原决定人；与 SEC-FC-06 的 onBehalfOf 同源） */
  readonly actor: string
  /** 部门 path（events.dept） */
  readonly dept: string
  /** 等级（events.level） */
  readonly level: number
  /** 尝试序号（控制面代写固定 1；按单派发面后续可注真实 attempt） */
  readonly attempt?: number
  /** 判定单号为空时的回退锚（缺省 CONTROL_TICKET） */
  readonly issueFallback?: string
  readonly clock: () => number
  /** 观测面日志（可选；写失败不影响证据落账判定） */
  readonly log?: (line: string) => void
  /** ULID 生成器注入（测试确定性；缺省 makeUlid） */
  readonly makeId?: (ts: number) => string
}

/** note 的 JSON 文本（字段序固定；与 AuthorityEvidence 同形，附 schemaRef） */
export function authorityEvidenceNote(evidence: AuthorityEvidence): string {
  return JSON.stringify({
    schemaRef: AUTHORITY_EVIDENCE_SCHEMA_REF,
    evidenceId: evidence.evidenceId,
    atMs: evidence.atMs,
    ticket: evidence.ticket,
    action: evidence.action,
    mode: evidence.mode,
    state: evidence.state,
    chain: evidence.chain,
    refusals: evidence.refusals,
    ...(evidence.grantId !== undefined ? { grantId: evidence.grantId } : {}),
    ...(evidence.exercisedBy !== undefined ? { exercisedBy: evidence.exercisedBy } : {}),
    ...(evidence.detail !== undefined ? { detail: evidence.detail } : {}),
  })
}

/**
 * 生产证据 sink：先 appendEvent 再返回；写失败上抛（gate 的 decide() 转
 * `gw-authority-evidence-failed` 拒绝本次写——fail-closed）。
 */
export function createAuthorityLedgerSink(options: AuthorityEvidenceLedgerSinkOptions): AuthorityEvidenceSink {
  const issueFallback = options.issueFallback ?? CONTROL_TICKET
  return (evidence: AuthorityEvidence): void => {
    const record: EventRecord = {
      id: (options.makeId ?? makeUlid)(options.clock()),
      ts: evidence.atMs,
      company: options.company,
      issue: evidence.ticket !== '' ? evidence.ticket : issueFallback,
      event: AUTHORITY_EVIDENCE_EVENT,
      actor: options.actor,
      attempt: options.attempt ?? 1,
      level: options.level,
      dept: options.dept,
      tokens: { input: 0 },
      payload_hash: evidence.evidenceId,
      note: authorityEvidenceNote(evidence),
    }
    try {
      options.ledger.appendEvent(record)
    } catch (err) {
      try {
        options.log?.(
          `[authority] 证据落账失败（fail-closed：本次写将被拒）：${err instanceof Error ? err.message : String(err)}`,
        )
      } catch {
        // 日志面非证据面：日志自身失败不得掩盖落账失败
      }
      throw err
    }
    try {
      options.log?.(
        `[authority] ${evidence.mode}/${evidence.state} action=${evidence.action} ticket=${evidence.ticket}` +
          ` evidence=${evidence.evidenceId} ledger=events/${AUTHORITY_EVIDENCE_EVENT}`,
      )
    } catch {
      // 证据已落账；日志面失败不改变判定（不把已留痕的判定误判为无留痕）
    }
  }
}

/** evidenceId＝规范化内容的 SHA-256 前 16 位（同判定同 id；可复算、不含密钥） */
export function evidenceIdOf(seed: unknown): string {
  const canonical = canonicalizeJson(seed)
  const text = canonical.ok ? canonical.value : JSON.stringify(seed)
  return `AUTH-${sha256Hex(text).slice(0, 16)}`
}

/**
 * 证据 id 复算面（审计用；studio-dev-579）：seed 与 gate 内构造**同一口径**——
 * `{ticket,action,atMs,state,chain,refusals,grantId?}`（不含 mode/exercisedBy/detail，
 * 那三项是观测附加位，不参与 id）。SQL 读面取 note 中同名字段即可在下游复算比对。
 */
export function recomputeAuthorityEvidenceId(evidence: {
  readonly ticket: string
  readonly action: string
  readonly atMs: number
  readonly state: PolicyState
  readonly chain: readonly string[]
  readonly refusals: readonly AuthorityRefusal[]
  readonly grantId?: string
}): string {
  return evidenceIdOf({
    ticket: evidence.ticket,
    action: evidence.action,
    atMs: evidence.atMs,
    state: evidence.state,
    chain: evidence.chain,
    refusals: evidence.refusals,
    ...(evidence.grantId !== undefined ? { grantId: evidence.grantId } : {}),
  })
}

/**
 * 证据构造面（先拆后增：studio-dev-623 Q6 适配——原 authority-gate.decide 内联体整块搬入，
 * 字段序/口径逐字等价；decide 侧只取 `{evidence, evidenceId}`）。
 */
export function buildAuthorityEvidence(base: {
  readonly atMs: number
  readonly ticket: string
  readonly action: string
  readonly mode: AuthorityMode
  readonly state: PolicyState
  readonly chain: readonly string[]
  readonly refusals: readonly AuthorityRefusal[]
  readonly grantId?: string
  readonly exercisedBy?: string
  readonly detail?: string
}): { readonly evidence: AuthorityEvidence; readonly evidenceId: string } {
  const evidenceId = evidenceIdOf({
    ticket: base.ticket,
    action: base.action,
    atMs: base.atMs,
    state: base.state,
    chain: base.chain,
    refusals: base.refusals,
    ...(base.grantId !== undefined ? { grantId: base.grantId } : {}),
  })
  const evidence: AuthorityEvidence = {
    evidenceId,
    atMs: base.atMs,
    ticket: base.ticket,
    action: base.action,
    mode: base.mode,
    state: base.state,
    chain: base.chain,
    refusals: base.refusals,
    ...(base.grantId !== undefined ? { grantId: base.grantId } : {}),
    ...(base.exercisedBy !== undefined ? { exercisedBy: base.exercisedBy } : {}),
    ...(base.detail !== undefined ? { detail: base.detail } : {}),
  }
  return { evidence, evidenceId }
}
