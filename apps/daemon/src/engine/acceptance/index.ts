/**
 * engine/acceptance —— 单子验收口径（task-39；提案 task-38 已批）
 *
 * 分层（叠加不替换）：测试层 verify:v2 证明代码正确；本面证明**功能达到任务书意图**：
 *   - 每单强制 `acceptance_criteria`（issue.description 内固定标记块；可测判据）；
 *   - 功能类派发入口校验：新单缺失→拒派（enforce）/告警（observe）；存量 legacy 不阻塞；
 *   - 功能类 CLOSE 前验收闸：无 pass/waived 结论→HOLD（enforce）/告警（observe）；
 *   - 验收结论留痕复用既有事件词 `APPROVE`（note `ACCEPTANCE;status=...`），不新增事件词。
 * 默认 observe（提案 §7：先观察后强制）；daemon.yaml `acceptanceEnforce: off|observe|enforce` 切换。
 */
import type { EventRecord, IssueRecord, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'

export type AcceptanceEnforcement = 'off' | 'observe' | 'enforce'
export type AcceptanceStatus = 'pass' | 'return' | 'need-evidence' | 'waived'
export type AcceptanceRisk = 'low' | 'medium' | 'high'

export interface AcceptanceCriterion {
  readonly id: string
  readonly check: string
  readonly evidence: string
}
export interface AcceptanceCriteria {
  readonly criteria: readonly AcceptanceCriterion[]
  readonly riskLevel: AcceptanceRisk
  readonly signoffLevel: 'lead-verifier' | 'eng0' | 'producer'
  readonly verificationMode: 'code' | 'report' | 'proposal'
}

export interface AcceptanceDecision {
  readonly status: AcceptanceStatus
  readonly by: string
  readonly at: string
  readonly evidence: string
  readonly signoff: string
  readonly eventId: string
}

/** CLOSE 前允许的验收状态（return/need-evidence 不算通过） */
const PASSING: ReadonlySet<AcceptanceStatus> = new Set(['pass', 'waived'])
/** 报告/巡检/策划/提案类：沿用四要件+QA，不要求功能验收字段 */
const REPORT_LIKE_TYPES: ReadonlySet<string> = new Set(['report', 'patrol', 'proposal', 'pricing', 'review', 'research'])
const ACCEPTANCE_NOTE_PREFIX = 'ACCEPTANCE;'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}
function asRisk(value: unknown): AcceptanceRisk {
  return value === 'medium' || value === 'high' ? value : 'low'
}
function signoffForRisk(risk: AcceptanceRisk): AcceptanceCriteria['signoffLevel'] {
  return risk === 'high' ? 'producer' : risk === 'medium' ? 'eng0' : 'lead-verifier'
}

/** 从 issue.description 解析验收标准标记块；缺=missing，坏 JSON/坏形状=invalid（均不静默放行） */
export function parseAcceptanceCriteria(description: string | undefined): { ok: true; criteria: AcceptanceCriteria } | { ok: false; reason: 'missing' | 'invalid'; detail: string } {
  if (description === undefined || description.trim() === '') return { ok: false, reason: 'missing', detail: 'issue.description 为空' }
  const marker = /<!--\s*acceptance\s*:\s*([\s\S]*?)-->/i.exec(description)
  const fenced = /```acceptance\s*\r?\n([\s\S]*?)```/i.exec(description)
  const raw = marker?.[1] ?? fenced?.[1]
  if (raw === undefined) return { ok: false, reason: 'missing', detail: '缺 <!-- acceptance: {...} --> 或 ```acceptance 块' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.trim())
  } catch (err) {
    return { ok: false, reason: 'invalid', detail: `acceptance 块 JSON 解析失败：${err instanceof Error ? err.message : String(err)}` }
  }
  if (!isObject(parsed) || !Array.isArray(parsed['criteria']) || parsed['criteria'].length === 0) {
    return { ok: false, reason: 'invalid', detail: 'acceptance 块须含非空 criteria[]' }
  }
  const criteria: AcceptanceCriterion[] = []
  for (const [i, item] of parsed['criteria'].entries()) {
    if (!isObject(item)) return { ok: false, reason: 'invalid', detail: `criteria[${String(i)}] 须为对象` }
    const id = asString(item['id']) ?? `A${String(i + 1)}`
    const check = asString(item['check'])
    const evidence = asString(item['evidence'])
    if (check === undefined || evidence === undefined) return { ok: false, reason: 'invalid', detail: `criteria[${String(i)}] 缺可测 check/evidence` }
    criteria.push({ id, check, evidence })
  }
  const riskLevel = asRisk(parsed['risk_level'] ?? parsed['riskLevel'])
  const signoffLevel = asString(parsed['signoff_level'] ?? parsed['signoffLevel']) === 'producer'
    ? 'producer'
    : asString(parsed['signoff_level'] ?? parsed['signoffLevel']) === 'eng0'
      ? 'eng0'
      : signoffForRisk(riskLevel)
  const mode = asString(parsed['verification_mode'] ?? parsed['verificationMode'])
  return {
    ok: true,
    criteria: { criteria, riskLevel, signoffLevel, verificationMode: mode === 'report' || mode === 'proposal' ? mode : 'code' },
  }
}

/** 功能类=非报告/巡检/策划/提案类；缺 type 按功能类（保守，需验收） */
export function isFunctionalIssue(issue: Pick<IssueRecord, 'type'>): boolean {
  return issue.type === undefined || issue.type === '' || !REPORT_LIKE_TYPES.has(issue.type)
}

/** 验收结论解析（APPROVE note 前缀；最新一条生效） */
export function acceptanceDecisionOf(events: readonly EventRecord[]): AcceptanceDecision | undefined {
  let latest: AcceptanceDecision | undefined
  for (const e of events) {
    if (e.event !== 'APPROVE' || e.note === undefined || !e.note.startsWith(ACCEPTANCE_NOTE_PREFIX)) continue
    const field = (name: string): string | undefined => new RegExp(`(?:^|;)${name}=([^;]+)`).exec(e.note as string)?.[1]
    const status = field('status')
    if (status !== 'pass' && status !== 'return' && status !== 'need-evidence' && status !== 'waived') continue
    latest = { status, by: field('by') ?? 'unknown', at: field('at') ?? new Date(e.ts).toISOString(), evidence: field('evidence') ?? '', signoff: field('signoff') ?? 'unknown', eventId: e.id }
  }
  return latest
}

export interface AcceptanceGateConfig {
  readonly mode: AcceptanceEnforcement
  /** 存量判定线（epoch ms）：ticket_mirror.created < 此值=legacy，不阻塞但告警 */
  readonly enforceSince: number
  readonly ledger: Ledger
  readonly company: string
  /** 告警去重集（ticket+kind；进程内） */
  readonly warned?: Set<string>
}

export interface AcceptanceGateResult {
  readonly allow: boolean
  readonly kind: 'ok' | 'legacy' | 'observe-missing' | 'blocked-missing' | 'blocked-no-decision' | 'blocked-return'
  readonly note?: string | undefined
}

function warnOnce(cfg: AcceptanceGateConfig, key: string): boolean {
  const set = cfg.warned
  if (set === undefined) return true
  if (set.has(key)) return false
  set.add(key)
  return true
}

function legacyOf(cfg: AcceptanceGateConfig, ticket: TicketId): { legacy: boolean; created?: number } {
  const mirror = cfg.ledger.getTicketMirror(ticket)
  const created = mirror?.created
  if (created === undefined) return { legacy: false }
  return { legacy: created < cfg.enforceSince, created }
}

/** 派发入口验收：功能类新单缺/坏 acceptance_criteria → enforce 拒派；observe 告警放行；legacy 告警放行 */
export function evaluateDispatchAcceptance(cfg: AcceptanceGateConfig, issue: IssueRecord): AcceptanceGateResult {
  if (cfg.mode === 'off' || !isFunctionalIssue(issue)) return { allow: true, kind: 'ok' }
  const result = parseAcceptanceCriteria(issue.description)
  if (result.ok) return { allow: true, kind: 'ok' }
  const leg = legacyOf(cfg, issue.id)
  const note = `ACCEPTANCE_${result.reason === 'missing' ? 'MISSING' : 'INVALID'};ticket=${issue.id};mode=dispatch;${leg.legacy ? 'legacy=true;' : ''}detail=${result.detail}（task-39；提案 task-38）`
  if (leg.legacy) return { allow: true, kind: 'legacy', note: warnOnce(cfg, `${issue.id}|global`) ? note : undefined }
  if (cfg.mode === 'observe') return { allow: true, kind: 'observe-missing', note: warnOnce(cfg, `${issue.id}|global`) ? note : undefined }
  return { allow: false, kind: 'blocked-missing', note: `ACCEPTANCE_BLOCKED;ticket=${issue.id};${result.detail}（enforce：缺验收标准拒派——task-39）` }
}

/** CLOSE 前验收：功能类需 pass/waived 结论；return/need-evidence/缺失 → enforce HOLD，observe/legacy 告警放行 */
export function evaluateCloseAcceptance(cfg: AcceptanceGateConfig, issue: IssueRecord): AcceptanceGateResult {
  if (cfg.mode === 'off' || !isFunctionalIssue(issue)) return { allow: true, kind: 'ok' }
  const events = cfg.ledger.queryEvents({ issue: issue.id })
  const decision = acceptanceDecisionOf(events)
  if (decision !== undefined && PASSING.has(decision.status)) return { allow: true, kind: 'ok' }
  const leg = legacyOf(cfg, issue.id)
  const status = decision === undefined ? 'missing' : decision.status
  const note = `ACCEPTANCE_HOLD;ticket=${issue.id};status=${status};mode=close;${leg.legacy ? 'legacy=true;' : ''}（task-39：功能类 CLOSE 前需 pass/waived+证据）`
  // F1（task-43）：legacy 判断必须在 enforce blocked-return 之前——存量单已有 return/need-evidence/
  // 缺结论都不得阻塞 CLOSE（只告警）；新单 enforce 语义不变。
  if (leg.legacy) return { allow: true, kind: 'legacy', note: warnOnce(cfg, `${issue.id}|close`) ? note : undefined }
  if (decision !== undefined && !PASSING.has(decision.status) && cfg.mode === 'enforce') return { allow: false, kind: 'blocked-return', note }
  if (cfg.mode === 'observe') return { allow: true, kind: 'observe-missing', note: warnOnce(cfg, `${issue.id}|close`) ? note : undefined }
  return { allow: false, kind: 'blocked-no-decision', note }
}

/** 记录验收决定（既有事件词 APPROVE；不新增事件名） */
export function recordAcceptance(input: {
  readonly ledger: Pick<Ledger, 'appendEvent'>
  readonly company: string
  readonly ticket: TicketId
  readonly status: AcceptanceStatus
  readonly by: string
  readonly evidence: string
  readonly signoff: string
  readonly at: number
  readonly makeId: (ts: number) => string
}): EventRecord {
  if (input.by.trim() === '' || input.evidence.trim() === '') throw new Error('验收记录须有 by 与 evidence（不伪造验收方/证据）')
  const ts = input.at
  const event: EventRecord = {
    id: input.makeId(ts),
    ts,
    company: input.company,
    issue: input.ticket,
    event: 'APPROVE',
    actor: input.by,
    attempt: 1,
    level: 1,
    dept: 'departments/工程部',
    tokens: { input: 0 },
    note: `${ACCEPTANCE_NOTE_PREFIX}status=${input.status};by=${input.by};at=${new Date(ts).toISOString()};evidence=${input.evidence};signoff=${input.signoff}`,
  }
  input.ledger.appendEvent(event)
  return event
}
