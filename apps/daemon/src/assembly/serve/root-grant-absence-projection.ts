/**
 * serve/root-grant-absence-projection —— 无锚声明投影/标注/事件面（studio-dev-707 段2；#648 方案 c）
 *
 * 依据：docs/v2/03 §3.1.1（可观察/有期限/升级出口）、docs/v2/15 §7.3（无锚装配态）、
 * docs/v2/17 NEG-ORG-09a–d、docs/17-§2（无锚声明面：只进 daemon_kv＋日志＋面板只读块＋既有 ESCALATE）。
 *
 * 本件做「投影＋标注」，**不做判定**（判定在 root-grant-absence-state.ts；本件只消费 resolution）：
 *   - daemon_kv 四键（面板/验收读面）：records.rootGrantAbsence / records.refusals.lastBoot /
 *     records.refusals.total / records.authority.view；**不新增表/记录族**；
 *   - 既有 ESCALATE 事件去重追加（key=`state|until`；同日最多 1 条；不新增事件名）；
 *   - 启动日志：声明/欠账/临期 + `[records][declared-unanchored]` 拒写汇总行（施工书 §4.3）。
 *
 * fail-closed/best-effort 口径（Lead 口径 2）：
 *   - kv 读写失败一律 best-effort：log 前缀 `[serve] 根授予无锚投影写入失败`，**不阻断启动/不改主循环顺序**；
 *   - refusals counts 缺失时不补 0：只写 `{at:null,counts:{}}` + 欠账 log；
 *   - 面板侧坏 JSON → unavailable（views 侧 unknown），不显示绿。
 *
 * 边界：不写 REC-AUTH-01/records、不伪造外部事实、不改契约/枚举/记录族；声明不是授予。
 */
import { CONTROL_TICKET } from '@studio-next/gateway'
import type { EventRecord } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../../engine/tools/id.ts'
import {
  ROOT_GRANT_ABSENCE_WARN_DAYS,
  rootGrantAbsenceUntilStatus,
  type RootGrantAbsenceDeclaration,
} from './root-grant-absence.ts'
import type { RootGrantAbsenceState } from './root-grant-absence-state.ts'

/** daemon_kv 键（真机验收/面板唯一读面；内部键带着 `records.` 前缀便于运维 grep） */
export const ROOT_GRANT_ABSENCE_KV = Object.freeze({
  rootGrantAbsence: 'records.rootGrantAbsence',
  refusalsLastBoot: 'records.refusals.lastBoot',
  refusalsTotal: 'records.refusals.total',
  authorityView: 'records.authority.view',
  injected: 'records.rootGrantAbsence.injected',
  escalatedState: 'records.rootGrantAbsence.escalatedState',
  escalatedAt: 'records.rootGrantAbsence.escalatedAt',
  lastRoster: 'records.refusals.lastRoster',
})

/** boot 拒写计数（按记录族；缺失/坏行不补 0） */
export interface RecordRefusalCounts {
  readonly at: number | null
  readonly counts: Readonly<Record<string, number>>
}

/** 面板 authority 块（与 docs/17-§2 / 施工书 §4.3 形状一致；只读展示） */
export interface AuthorityView {
  readonly v: 1
  readonly state: RootGrantAbsenceState
  readonly declaration:
    | { readonly by: string; readonly reason: string; readonly until: string; readonly untilSoon: boolean }
    | null
  readonly rootGrant: { readonly expectedRecordId: string | null; readonly present: boolean; readonly count: number }
  readonly refusals: { readonly lastBoot: RecordRefusalCounts; readonly total: Readonly<Record<string, number>> }
  readonly levelClaim: { readonly configured: number | null; readonly structural: string }
  readonly notice: string
}

export interface ProjectRootGrantAbsenceInput {
  readonly ledger: Ledger
  readonly company: string
  readonly state: RootGrantAbsenceState
  readonly authGrantCount: number
  readonly rootGrantPresent: boolean
  readonly declaration?: RootGrantAbsenceDeclaration
  readonly now: number
  readonly log: (line: string) => void
}

const WRITE_FAIL_PREFIX = '[serve] 根授予无锚投影写入失败'
const NOTICE = '含 G8 双角色拒写残余（ENG-0，另单）；声明不是授予'
const LEVEL_CLAIM_STRUCTURAL = 'CL2-unmet'

/** JSON 读取（坏 JSON/缺键→undefined；不猜） */
export function readKvJson(ledger: Ledger, key: string, log?: (line: string) => void): unknown {
  try {
    const raw = ledger.kvGet(key)
    if (raw === null || raw === '') return undefined
    return JSON.parse(raw) as unknown
  } catch (err) {
    log?.(`${WRITE_FAIL_PREFIX}（读 ${key} 坏 JSON，按缺失处理）：${err instanceof Error ? err.message : String(err)}`)
    return undefined
  }
}

/** 写 JSON（best-effort；失败只 log 不抛——面板侧将显示 unavailable/unknown） */
export function writeKvJson(ledger: Ledger, key: string, value: unknown, log: (line: string) => void): void {
  try {
    ledger.kvSet(key, JSON.stringify(value))
  } catch (err) {
    log(`${WRITE_FAIL_PREFIX}（写 ${key}）：${err instanceof Error ? err.message : String(err)}`)
  }
}

/** 读 boot 拒写计数（`records.refusals.lastRoster`；缺失→{at:null,counts:{}}，不补 0） */
export function readLastRosterCounts(ledger: Ledger, log?: (line: string) => void): RecordRefusalCounts {
  const parsed = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.lastRoster, log)
  if (typeof parsed !== 'object' || parsed === null) return { at: null, counts: {} }
  const raw = parsed as { at?: unknown; counts?: unknown }
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : null
  const counts: Record<string, number> = {}
  if (typeof raw.counts === 'object' && raw.counts !== null) {
    for (const [type, value] of Object.entries(raw.counts as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 0) counts[type] = value
    }
  }
  if (at === null) log?.('[serve] 根授予无锚投影：boot 拒写计数缺失（欠账，不补 0；面板将显示空计数）')
  return { at, counts }
}

/** 合并累计计数（读旧值失败从本次起，不丢本次） */
export function mergeRefusalTotals(
  previous: unknown,
  current: Readonly<Record<string, number>>,
): Record<string, number> {
  const totals: Record<string, number> = {}
  if (typeof previous === 'object' && previous !== null) {
    const raw = previous as { counts?: unknown }
    if (typeof raw.counts === 'object' && raw.counts !== null) {
      for (const [type, value] of Object.entries(raw.counts as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) totals[type] = value
      }
    }
  }
  for (const [type, value] of Object.entries(current)) totals[type] = (totals[type] ?? 0) + value
  return totals
}

/** 拒写计数摘要（仅列已出现的记录族；REC-AUTH-01 恒 0 行由投影侧不写记录保证） */
export function refusalSummary(counts: Readonly<Record<string, number>>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, n]) => `${type}×${String(n)}`)
  return parts.length > 0 ? parts.join(' / ') : '无拒写'
}

/** 构造面板 authority 投影（纯函数；供 projection 与测试复用） */
export function buildAuthorityView(input: {
  readonly state: RootGrantAbsenceState
  readonly authGrantCount: number
  readonly rootGrantPresent: boolean
  readonly declaration?: RootGrantAbsenceDeclaration
  readonly now: number
  readonly refusalsLastBoot: RecordRefusalCounts
  readonly refusalsTotal: Readonly<Record<string, number>>
  readonly expectedRecordId: string | null
}): AuthorityView {
  const untilSoon =
    input.declaration !== undefined &&
    rootGrantAbsenceUntilStatus(input.declaration.until, input.now) === 'expiring'
  return {
    v: 1,
    state: input.state,
    declaration:
      input.declaration !== undefined
        ? {
            by: input.declaration.declaredBy,
            reason: input.declaration.reason,
            until: input.declaration.until,
            untilSoon,
          }
        : null,
    rootGrant: {
      expectedRecordId: input.expectedRecordId,
      present: input.rootGrantPresent || input.authGrantCount > 0,
      count: input.authGrantCount,
    },
    refusals: { lastBoot: input.refusalsLastBoot, total: input.refusalsTotal },
    levelClaim: { configured: null, structural: LEVEL_CLAIM_STRUCTURAL },
    notice: NOTICE,
  }
}

/** 构造 ESCALATE 事件（既有事件名/冻结列集；不进 records） */
function buildEscalateEvent(input: ProjectRootGrantAbsenceInput, note: string): EventRecord {
  return {
    id: makeUlid(input.now),
    ts: input.now,
    company: input.company,
    issue: CONTROL_TICKET,
    event: 'ESCALATE',
    actor: 'daemon:serve',
    attempt: 1,
    level: 1,
    dept: 'daemon',
    tokens: { input: 0 },
    note,
  }
}

/**
 * 投影一轮（启动时调一次）：kv 四键＋ESCALATE 去重＋日志汇总。
 * 恒不抛（best-effort；失败只 log）——不阻断启动。
 */
export function projectRootGrantAbsence(input: ProjectRootGrantAbsenceInput): void {
  const { ledger, log, now } = input
  const lastBoot = readLastRosterCounts(ledger, log)
  const previousTotals = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsTotal, log)
  const totalCounts = mergeRefusalTotals(previousTotals, lastBoot.counts)
  // expectedRecordId 不在本地猜（外部事实签立前没有真实 id）：null + 文档口径
  const expectedRecordId: string | null = null

  // ① kv 四键（面板/验收读面；写失败 best-effort）
  writeKvJson(
    ledger,
    ROOT_GRANT_ABSENCE_KV.rootGrantAbsence,
    {
      v: 1,
      state: input.state,
      declaration:
        input.declaration !== undefined
          ? { by: input.declaration.declaredBy, reason: input.declaration.reason, until: input.declaration.until }
          : null,
      declaredAt: input.declaration !== undefined ? new Date(now).toISOString() : null,
      source: input.declaration !== undefined ? 'daemon.yaml' : 'none',
    },
    log,
  )
  writeKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsLastBoot, lastBoot, log)
  writeKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsTotal, { v: 1, counts: totalCounts }, log)
  const authorityView = buildAuthorityView({
    state: input.state,
    authGrantCount: input.authGrantCount,
    rootGrantPresent: input.rootGrantPresent,
    ...(input.declaration !== undefined ? { declaration: input.declaration } : {}),
    now,
    refusalsLastBoot: lastBoot,
    refusalsTotal: totalCounts,
    expectedRecordId,
  })
  writeKvJson(ledger, ROOT_GRANT_ABSENCE_KV.authorityView, authorityView, log)

  // ② 启动日志：声明/欠账/临期 + 拒写汇总（declared 时加 [records][declared-unanchored] 前缀）
  const summary = refusalSummary(lastBoot.counts)
  if (input.declaration !== undefined) {
    log(
      `[records][declared-unanchored] 拒写汇总：${summary}（状态=${input.state}；declaredBy=${input.declaration.declaredBy}；until=${input.declaration.until}；${NOTICE}）`,
    )
    if (authorityView.declaration?.untilSoon === true) {
      log(
        `[serve] 根授予无锚声明临期（until=${input.declaration.until}，剩余 ≤${String(ROOT_GRANT_ABSENCE_WARN_DAYS)} 天）：到期将 CONFIG_INVALID 拒启——请制作人签立外部事实（docs/v2/03 §3.1.1）`,
      )
    }
  } else if (input.state === 'unanchored-undeclared') {
    log(`[serve] 根授予无锚未声明欠账：拒写计数=${summary}（不补 0；面板 state=unanchored-undeclared）`)
  }

  // ③ ESCALATE 去重（仅无锚态：DECLARED|UNDECLARED；anchored=正常态不发无锚告警）
  if (input.state === 'anchored') return
  const dedupeKey = `${input.state}|${input.declaration?.until ?? ''}`
  const previousKey = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.escalatedState, log)
  const sameKey = typeof previousKey === 'string' && previousKey === dedupeKey
  if (!sameKey) {
    const note =
      `ROOT_GRANT_ABSENCE;${input.state === 'unanchored-declared' ? 'DECLARED' : 'UNDECLARED'};` +
      `declaredBy=${input.declaration?.declaredBy ?? '-'};until=${input.declaration?.until ?? '-'};` +
      `REC-AUTH-01×${String(input.authGrantCount)};${summary};state=${input.state};` +
      '含 G8 双角色拒写残余（ENG-0，另单）;声明不是授予'
    try {
      const appended = ledger.appendEvent(buildEscalateEvent(input, note))
      if (appended.appended) {
        writeKvJson(ledger, ROOT_GRANT_ABSENCE_KV.escalatedState, dedupeKey, log)
        writeKvJson(ledger, ROOT_GRANT_ABSENCE_KV.escalatedAt, new Date(now).toISOString(), log)
      }
    } catch (err) {
      log(`${WRITE_FAIL_PREFIX}（ESCALATE 追加失败，不阻断启动）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** 读取 rootGrant 注入标记（serve-face 装配时写；缺失/坏值=未注入） */
export function readRootGrantInjected(ledger: Ledger, log?: (line: string) => void): boolean {
  try {
    return ledger.kvGet(ROOT_GRANT_ABSENCE_KV.injected) === 'true'
  } catch (err) {
    log?.(`${WRITE_FAIL_PREFIX}（读 injected 标记失败，按未注入处理）：${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
