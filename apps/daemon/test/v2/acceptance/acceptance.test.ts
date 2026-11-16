/**
 * 验收口径 V2 套件（task-39；提案 task-38 已批）
 *
 * 断言面：acceptance_criteria 解析（缺/坏/正）；派发入口功能类新单缺标准 enforce 拒派、
 * legacy/observe 告警放行、报告类不要求；CLOSE 前功能类需 pass/waived（return/缺失 HOLD）；
 * 验收记录复用既有 APPROVE 事件词并可被闸读取；CLI 记录/坏参数 exit≠0；不改契约/schema。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { EventRecord, IssueRecord } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import {
  acceptanceDecisionOf,
  evaluateCloseAcceptance,
  evaluateDispatchAcceptance,
  isFunctionalIssue,
  parseAcceptanceCriteria,
  recordAcceptance,
  type AcceptanceGateConfig,
} from '../../../src/engine/acceptance/index.ts'
import { cmdAcceptance } from '../../../src/cli/acceptance.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-accept-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
const COMPANY = 'demo-acc'
const MARKER = '<!-- acceptance: {"criteria":[{"id":"A1","check":"REPORT 含结论","evidence":"REPORT.md#L1"}],"risk_level":"low"} -->'

function issue(id: string, over: Partial<IssueRecord> = {}): IssueRecord {
  return { id, title: id, state: '已交付', type: 'devtask', updated: new Date(1_000_000).toISOString(), ...over }
}
function ledgerOf(name: string) {
  const ledger = openLedger(path.join(ROOT, `${name}.sqlite`))
  ledger.upsertTicketMirror({ issue: 'T-NEW', company: COMPANY, created: 2_000, updated: 2_000, state: '已交付', type: 'devtask', dept: 'departments/工程部', level: 2, dispatcher: 'AGENT-1' })
  ledger.upsertTicketMirror({ issue: 'T-LEGACY', company: COMPANY, created: 500, updated: 500, state: '已交付', type: 'devtask', dept: 'departments/工程部', level: 2, dispatcher: 'AGENT-1' })
  ledger.upsertTicketMirror({ issue: 'T-REPORT', company: COMPANY, created: 2_000, updated: 2_000, state: '已交付', type: 'report', dept: 'departments/研发部', level: 1, dispatcher: 'AGENT-1' })
  return ledger
}
function cfg(ledger: ReturnType<typeof ledgerOf>, mode: AcceptanceGateConfig['mode'] = 'enforce'): AcceptanceGateConfig {
  return { mode, enforceSince: 1_000, ledger, company: COMPANY, warned: new Set<string>() }
}

describe('acceptance_criteria：解析与功能类判定', () => {
  it('缺标记/坏 JSON/空 criteria → 不明放行；合法 JSON → 结构化（risk→signoff）', () => {
    expect(parseAcceptanceCriteria(undefined)).toMatchObject({ ok: false, reason: 'missing' })
    expect(parseAcceptanceCriteria('无标记正文')).toMatchObject({ ok: false, reason: 'missing' })
    expect(parseAcceptanceCriteria('<!-- acceptance: {oops} -->')).toMatchObject({ ok: false, reason: 'invalid' })
    expect(parseAcceptanceCriteria('<!-- acceptance: {"criteria":[]} -->')).toMatchObject({ ok: false, reason: 'invalid' })
    const ok = parseAcceptanceCriteria(MARKER)
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.criteria.criteria).toEqual([{ id: 'A1', check: 'REPORT 含结论', evidence: 'REPORT.md#L1' }])
      expect(ok.criteria.riskLevel).toBe('low')
      expect(ok.criteria.signoffLevel).toBe('lead-verifier')
      expect(ok.criteria.verificationMode).toBe('code')
    }
    const high = parseAcceptanceCriteria('<!-- acceptance: {"criteria":[{"check":"c","evidence":"e"}],"risk_level":"high"} -->')
    expect(high.ok && high.criteria.signoffLevel).toBe('producer')
    expect(isFunctionalIssue(issue('X'))).toBe(true)
    expect(isFunctionalIssue(issue('R', { type: 'report' }))).toBe(false)
    expect(isFunctionalIssue(issue('P', { type: 'patrol' }))).toBe(false)
  })
})

describe('派发入口验收闸', () => {
  it('enforce：功能类新单缺标准→拒派；有标准→放行；legacy/报告类→放行告警', () => {
    const ledger = ledgerOf('dispatch')
    try {
      const c = cfg(ledger, 'enforce')
      expect(evaluateDispatchAcceptance(c, issue('T-NEW')).allow).toBe(false)
      expect(evaluateDispatchAcceptance(c, issue('T-NEW')).kind).toBe('blocked-missing')
      expect(evaluateDispatchAcceptance(c, issue('T-NEW', { description: MARKER })).allow).toBe(true)
      expect(evaluateDispatchAcceptance(c, issue('T-LEGACY')).kind).toBe('legacy')
      expect(evaluateDispatchAcceptance(c, issue('T-REPORT', { type: 'report' })).allow).toBe(true)
      // observe：新单缺标准告警放行（不阻塞；提案先观察后强制）
      const observe = cfg(ledger, 'observe')
      expect(evaluateDispatchAcceptance(observe, issue('T-NEW'))).toMatchObject({ allow: true, kind: 'observe-missing' })
      expect(evaluateDispatchAcceptance(observe, issue('T-NEW')).note).toBeUndefined() // warn 去重
    } finally {
      ledger.close()
    }
  })
})

describe('CLOSE 前验收闸', () => {
  it('enforce：无结论/return HOLD；pass/waived 放行；报告类/legacy 不阻塞', () => {
    const ledger = ledgerOf('close')
    try {
      const c = cfg(ledger, 'enforce')
      expect(evaluateCloseAcceptance(c, issue('T-NEW')).allow).toBe(false)
      let at = 3_000
      const rec = (status: 'pass' | 'return' | 'waived') => recordAcceptance({ ledger, company: COMPANY, ticket: 'T-NEW', status, by: 'verifier', evidence: 'REPORT.md;verify exit0', signoff: 'lead-verifier', at: (at += 1_000), makeId: (ts) => makeUlid(ts) })
      rec('return')
      expect(evaluateCloseAcceptance(c, issue('T-NEW')).kind).toBe('blocked-return')
      rec('pass')
      expect(evaluateCloseAcceptance(c, issue('T-NEW')).allow).toBe(true)
      rec('waived')
      expect(evaluateCloseAcceptance(c, issue('T-NEW')).allow).toBe(true)
      // 最新结论生效：return 覆盖 waived → HOLD
      rec('return')
      expect(evaluateCloseAcceptance(c, issue('T-NEW')).allow).toBe(false)
      expect(evaluateCloseAcceptance(c, issue('T-REPORT', { type: 'report' })).allow).toBe(true)
      // F1（task-43）：legacy 存量单在先有 return/need-evidence/缺结论时都不得阻塞 CLOSE（allow+告警）
      expect(evaluateCloseAcceptance(c, issue('T-LEGACY'))).toMatchObject({ allow: true, kind: 'legacy' })
      recordAcceptance({ ledger, company: COMPANY, ticket: 'T-LEGACY', status: 'return', by: 'verifier', evidence: 'legacy old decision', signoff: 'lead-verifier', at: 5_000, makeId: (ts) => makeUlid(ts) })
      expect(evaluateCloseAcceptance(c, issue('T-LEGACY'))).toMatchObject({ allow: true, kind: 'legacy' })
      recordAcceptance({ ledger, company: COMPANY, ticket: 'T-LEGACY', status: 'need-evidence', by: 'verifier', evidence: 'legacy old decision', signoff: 'lead-verifier', at: 6_000, makeId: (ts) => makeUlid(ts) })
      expect(evaluateCloseAcceptance(c, issue('T-LEGACY'))).toMatchObject({ allow: true, kind: 'legacy' })
      // 新单 enforce 同三态仍 HOLD（不回归）
      recordAcceptance({ ledger, company: COMPANY, ticket: 'T-NEW', status: 'need-evidence', by: 'verifier', evidence: 'e', signoff: 'lead-verifier', at: 7_000, makeId: (ts) => makeUlid(ts) })
      expect(evaluateCloseAcceptance(c, issue('T-NEW'))).toMatchObject({ allow: false, kind: 'blocked-return' })
    } finally {
      ledger.close()
    }
  })
})

describe('验收记录/CLI', () => {
  it('recordAcceptance 写既有 APPROVE 事件（无新事件词）；acceptanceDecisionOf 读取最新；CLI 参数校验', async () => {
    const ledger = ledgerOf('record')
    try {
      const event: EventRecord = recordAcceptance({ ledger, company: COMPANY, ticket: 'T-NEW', status: 'pass', by: 'verifier', evidence: 'REPORT.md;verify exit0', signoff: 'eng0', at: 4_000, makeId: (ts) => makeUlid(ts) })
      expect(event.event).toBe('APPROVE')
      expect(event.note).toContain('ACCEPTANCE;status=pass')
      const decision = acceptanceDecisionOf(ledger.queryEvents({ issue: 'T-NEW' }))
      expect(decision).toMatchObject({ status: 'pass', by: 'verifier', signoff: 'eng0' })
      // CLI：坏状态/缺证据 exit1；合法记录 exit0
      expect(await cmdAcceptance(['record', '--db', path.join(ROOT, 'record.sqlite'), '--company', COMPANY, '--ticket', 'T-NEW', '--status', 'bogus', '--by', 'v', '--evidence', 'e'])).toBe(1)
      expect(await cmdAcceptance(['record', '--db', path.join(ROOT, 'record.sqlite'), '--company', COMPANY, '--ticket', 'T-NEW', '--status', 'pass', '--by', 'v'])).toBe(1)
      expect(await cmdAcceptance(['record', '--db', path.join(ROOT, 'record.sqlite'), '--company', COMPANY, '--ticket', 'T-NEW', '--status', 'pass', '--by', 'v', '--evidence', 'REPORT.md'])).toBe(0)
      expect(ledger.queryEvents({ issue: 'T-NEW' }).filter((e) => e.event === 'APPROVE').length).toBe(2)
    } finally {
      ledger.close()
    }
  })
})
