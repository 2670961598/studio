/**
 * 测试构件 —— DecisionInput/IssueRecord 构造器（exactOptionalPropertyTypes 下
 * 的可选字段安全装配：undefined 键不落对象）。
 * 仅测试层使用；src 保持零依赖零 IO。
 */
import type { IssueRecord, InvokeIntent } from '@studio-next/contract'
import type { DecisionInput } from '../src/decide.ts'
import { DEFAULT_STATES } from '../src/flows.ts'

/** 可选字段允许显式 undefined（装配时跳过） */
export type InputOverrides = { [K in keyof DecisionInput]?: DecisionInput[K] | undefined }
export type IssueOverrides = { [K in keyof IssueRecord]?: IssueRecord[K] | undefined }
export type IntentOverrides = { [K in keyof InvokeIntent]?: InvokeIntent[K] | undefined }

export const T0 = Date.parse('2026-10-16T00:00:00.000Z')

export function makeIssue(o: IssueOverrides = {}): IssueRecord {
  return {
    ...(o.id !== undefined ? { id: o.id } : { id: 'T-1' }),
    ...(o.title !== undefined ? { title: o.title } : { title: '示例单' }),
    ...(o.state !== undefined ? { state: o.state } : { state: DEFAULT_STATES.fresh }),
    ...(o.description !== undefined ? { description: o.description } : {}),
    ...(o.type !== undefined ? { type: o.type } : { type: 'task' }),
    ...(o.dept !== undefined ? { dept: o.dept } : { dept: 'eng' }),
    ...(o.level !== undefined ? { level: o.level } : { level: 0 }),
    ...(o.assignee !== undefined ? { assignee: o.assignee } : { assignee: 'P-1' }),
    ...(o.parent !== undefined ? { parent: o.parent } : {}),
    ...(o.lane !== undefined ? { lane: o.lane } : { lane: 'main' }),
    ...(o.updated !== undefined ? { updated: o.updated } : { updated: '2026-10-16T00:00:00.000Z' }),
  }
}

export function makeIntent(o: IntentOverrides = {}): InvokeIntent {
  return {
    kind: o.kind ?? 'ticket',
    company: o.company ?? 'acme',
    ...(o.ticket !== undefined ? { ticket: o.ticket } : { ticket: 'T-1' }),
    ...(o.payload !== undefined ? { payload: o.payload } : {}),
    source: o.source ?? 'poll',
    priority: o.priority ?? 1,
    ...(o.dedupKey !== undefined ? { dedupKey: o.dedupKey } : {}),
  }
}

/** 默认全绿环境：L0 新单 / 泳道无主 / 三闸宽裕 / 断路器净 / 意图新鲜 */
export function makeInput(o: InputOverrides = {}): DecisionInput {
  return {
    issue: o.issue ?? makeIssue(),
    ...(o.level !== undefined ? { level: o.level } : {}),
    ...(o.type !== undefined ? { type: o.type } : {}),
    ...(o.flows !== undefined ? { flows: o.flows } : {}),
    laneLease: o.laneLease ?? { lane: 'main', holder: null },
    inflightCount: o.inflightCount ?? 0,
    tickActionCount: o.tickActionCount ?? 0,
    limits: o.limits ?? { maxActionsPerTick: 5, maxInflight: 10 },
    intent: o.intent ?? makeIntent(),
    seenIntentKeys: o.seenIntentKeys ?? [],
    breaker: o.breaker ?? { strikes: 0, threshold: 3 },
    ...(o.approved !== undefined ? { approved: o.approved } : {}),
    ...(o.verifiedEvidence !== undefined ? { verifiedEvidence: o.verifiedEvidence } : {}),
    // 默认 now=updated+60s：静默 1 分钟 < 阈值 1 小时，不触停摆
    now: o.now ?? T0 + 60_000,
    stallAfterMs: o.stallAfterMs ?? 3_600_000,
  }
}
