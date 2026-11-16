import type { ActionName, Role, StateInfo, TicketKind } from './types.ts'
import { IssuesError } from './errors.ts'

/**
 * Frozen domain tables (Part 1 §4/§5). The storage adapter persists state as an
 * integer code; the catalog and the matrices are domain constants, not DB rows
 * (Part 2d §7.7.1 rule 7 — `state_catalog` stays an integrity check, not the
 * source of truth).
 */

export const STATE_CATALOG: readonly StateInfo[] = [
  { code: 1, name: 'NEW', displayOrder: 10, terminal: false, ready: false },
  { code: 2, name: 'TODO', displayOrder: 20, terminal: false, ready: true },
  { code: 3, name: 'IN_PROGRESS', displayOrder: 30, terminal: false, ready: false },
  { code: 4, name: 'TESTING', displayOrder: 40, terminal: false, ready: false },
  { code: 5, name: 'TEST_IN_PROGRESS', displayOrder: 50, terminal: false, ready: false },
  { code: 6, name: 'DONE', displayOrder: 60, terminal: true, ready: false },
  { code: 7, name: 'BLOCKED', displayOrder: 70, terminal: false, ready: false },
  { code: 8, name: 'CANCELLED', displayOrder: 80, terminal: true, ready: false },
]

export const NEW = 1
export const TODO = 2
export const IN_PROGRESS = 3
export const TESTING = 4
export const TEST_IN_PROGRESS = 5
export const DONE = 6
export const BLOCKED = 7
export const CANCELLED = 8

export const ALL_STATE_CODES: readonly number[] = STATE_CATALOG.map(state => state.code)
export const TERMINAL_STATE_CODES: readonly number[] = STATE_CATALOG.filter(
  state => state.terminal,
).map(state => state.code)
export const NON_TERMINAL_STATE_CODES: readonly number[] = STATE_CATALOG.filter(
  state => !state.terminal,
).map(state => state.code)

const BY_CODE: ReadonlyMap<number, StateInfo> = new Map(
  STATE_CATALOG.map(state => [state.code, state]),
)

/** Resolve a state code; an unknown code fails closed (`VALIDATION_FAILED`). */
export function stateInfo(code: number): StateInfo {
  const state = BY_CODE.get(code)
  if (state === undefined) {
    throw new IssuesError('VALIDATION_FAILED', `unknown state code: ${String(code)}`, {
      code: 'UNKNOWN_STATE_CODE',
      stateCode: code,
    })
  }
  return state
}

export function isTerminalState(code: number): boolean {
  return stateInfo(code).terminal
}

export type RelationKind = 'assignee' | 'reviewer' | 'planner'

/** One frozen transition row (Part 1 §4.2). Multiple rows may share an edge. */
export interface TransitionRuleDef {
  id: 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12' | 'T13' | 'T14'
  from: readonly number[]
  to: number | 'resume'
  role: Role
  relation: RelationKind
}

export const TRANSITION_RULES: readonly TransitionRuleDef[] = [
  { id: 'T1', from: [NEW], to: TODO, role: 'PLANNER', relation: 'planner' },
  { id: 'T2', from: [TODO], to: IN_PROGRESS, role: 'DEVELOPER', relation: 'assignee' },
  { id: 'T3', from: [IN_PROGRESS], to: TESTING, role: 'DEVELOPER', relation: 'assignee' },
  { id: 'T4', from: [IN_PROGRESS], to: BLOCKED, role: 'DEVELOPER', relation: 'assignee' },
  { id: 'T5', from: [BLOCKED], to: IN_PROGRESS, role: 'DEVELOPER', relation: 'assignee' },
  { id: 'T6', from: [TESTING], to: TEST_IN_PROGRESS, role: 'TESTER', relation: 'reviewer' },
  { id: 'T7', from: [TEST_IN_PROGRESS], to: DONE, role: 'TESTER', relation: 'reviewer' },
  { id: 'T8', from: [TEST_IN_PROGRESS], to: IN_PROGRESS, role: 'TESTER', relation: 'reviewer' },
  { id: 'T9', from: [TESTING], to: BLOCKED, role: 'TESTER', relation: 'reviewer' },
  { id: 'T10', from: [TEST_IN_PROGRESS], to: BLOCKED, role: 'TESTER', relation: 'reviewer' },
  { id: 'T11', from: [BLOCKED], to: TESTING, role: 'TESTER', relation: 'reviewer' },
  { id: 'T11', from: [BLOCKED], to: TEST_IN_PROGRESS, role: 'TESTER', relation: 'reviewer' },
  { id: 'T12', from: [NEW, TODO, IN_PROGRESS, TESTING, TEST_IN_PROGRESS], to: BLOCKED, role: 'PLANNER', relation: 'planner' },
  { id: 'T13', from: [BLOCKED], to: 'resume', role: 'PLANNER', relation: 'planner' },
  { id: 'T14', from: [TODO], to: NEW, role: 'PLANNER', relation: 'planner' },
]

/** Relation satisfaction for the transition matrix (`planner` = role only). */
export interface ActorRelation {
  isAssignee: boolean
  isReviewer: boolean
}

/**
 * Candidate matrix rows for (from, target), including the dynamic resume edges
 * (T11/T13). An empty result means "no matrix row" → `TRANSITION_NOT_ALLOWED`.
 */
export function candidateRules(
  from: number,
  to: number,
  resumeStateCode: number | null,
): readonly TransitionRuleDef[] {
  const matches: TransitionRuleDef[] = []
  for (const rule of TRANSITION_RULES) {
    if (!rule.from.includes(from)) continue
    if (rule.to === 'resume') {
      if (resumeStateCode !== null && resumeStateCode === to) matches.push(rule)
      continue
    }
    if (rule.to === to) matches.push(rule)
  }
  // Most specific relation first: the assignee/reviewer row wins over the
  // planner escape hatch when a principal holds both roles.
  const priority: Record<RelationKind, number> = { assignee: 0, reviewer: 0, planner: 1 }
  return matches.sort((a, b) => priority[a.relation] - priority[b.relation])
}

/** Whether an actor with `roles`/`relation` may execute a matrix row. */
export function ruleMatchesActor(
  rule: TransitionRuleDef,
  roles: readonly Role[],
  relation: ActorRelation,
): boolean {
  if (!roles.includes(rule.role)) return false
  switch (rule.relation) {
    case 'assignee':
      return relation.isAssignee
    case 'reviewer':
      return relation.isReviewer
    case 'planner':
      return true
  }
}

/** Target codes reachable from `from` for this role set + relation (pure matrix). */
export function allowedTransitionTargets(
  from: number,
  resumeStateCode: number | null,
  roles: readonly Role[],
  relation: ActorRelation,
): number[] {
  const targets = new Set<number>()
  for (const code of ALL_STATE_CODES) {
    if (code === from) continue
    const rules = candidateRules(from, code, resumeStateCode)
    if (rules.some(rule => ruleMatchesActor(rule, roles, relation))) targets.add(code)
  }
  return [...targets].sort((a, b) => a - b)
}

/** Frozen action grant table (Part 1 §5.3). `any-member` means a membership row. */
export interface ActionGrantDef {
  action: ActionName
  roles: readonly Role[] | 'any-member'
  humanOnly: boolean
  note: string
}

export const ACTION_GRANTS: readonly ActionGrantDef[] = [
  { action: 'read', roles: 'any-member', humanOnly: false, note: 'project-scoped read' },
  { action: 'create', roles: ['PLANNER', 'DEVELOPER', 'TESTER'], humanOnly: false, note: 'creates in NEW' },
  { action: 'update', roles: ['PLANNER', 'DEVELOPER', 'TESTER'], humanOnly: false, note: 'relation + state constrained' },
  { action: 'delete', roles: ['PLANNER'], humanOnly: false, note: 'archive; terminal only' },
  { action: 'transition', roles: ['PLANNER', 'DEVELOPER', 'TESTER'], humanOnly: false, note: 'per matrix' },
  { action: 'comment', roles: 'any-member', humanOnly: false, note: 'any state' },
  { action: 'assign', roles: ['PLANNER'], humanOnly: false, note: 'pre-TESTING only' },
  { action: 'reassign', roles: ['PLANNER'], humanOnly: false, note: 'TESTING/TEST_IN_PROGRESS/BLOCKED(4,5)' },
  { action: 'reparent', roles: ['PLANNER'], humanOnly: false, note: 'any state; constraints §3.5' },
  { action: 'governance', roles: ['PLANNER'], humanOnly: true, note: 'human-only requires_human command' },
  { action: 'close', roles: ['PLANNER'], humanOnly: false, note: 'human override allowed' },
  { action: 'reopen', roles: ['PLANNER'], humanOnly: false, note: 'ticket:reopen; self-reopen denied' },
  { action: 'policy:write', roles: ['PLANNER'], humanOnly: true, note: 'human-only policy command' },
]

export function grantedByRole(action: ActionName, roles: readonly Role[]): boolean {
  const grant = ACTION_GRANTS.find(entry => entry.action === action)
  if (grant === undefined) return false
  if (grant.roles === 'any-member') return true
  return grant.roles.some(role => roles.includes(role))
}

/** Ticket kinds, priorities and limits (Part 1 §3.2). */
export const TICKET_KINDS: readonly TicketKind[] = ['task', 'bug', 'chore']
export const DEFAULT_PRIORITY = 2
export const MAX_PRIORITY = 3
export const MAX_LABELS = 16
export const MAX_COMMENT_BYTES = 16 * 1024
export const MAX_BODY_LENGTH = 64 * 1024
export const MAX_TITLE_LENGTH = 512
export const MAX_EVIDENCE_BYTES = 64 * 1024 * 1024
export const MAX_PARENT_DEPTH = 3
export const MAX_READ_BATCH = 500
export const MAX_WRITE_BATCH = 100
export const MAX_READ_LIMIT = 500
export const DEFAULT_READ_LIMIT = 50
export const DAEMON_PRINCIPAL_ID = 'daemon:local'
export const DAEMON_DISPLAY_NAME = 'daemon:local'

/** Default project policy (per-project values are merged on top). */
export const DEFAULT_POLICY = {
  wipLimitPerWorker: 8,
  wipLimitPerProject: 200,
  evidenceRequired: 'summary',
  reopenPrincipals: [],
} as const

export const REOPENABLE_FROM: readonly number[] = [DONE, CANCELLED]
export const REOPEN_DEFAULT_TARGET = TODO
export const REOPEN_TO_IN_PROGRESS_TARGET = IN_PROGRESS
