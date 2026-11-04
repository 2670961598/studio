/**
 * 根授予无锚投影/标注/事件面单测（studio-dev-707 段2；docs/v2/03 §3.1.1、v2/15 §7.3、v2/17 NEG-ORG-09a–d）
 *
 * 覆盖：kv 四键形状（含 untilSoon/levelClaim/cl2）；ESCALATE 既有事件去重（state|until；同日 1 条）；
 * refusals lastRoster→lastBoot/total 累计（缺失不补 0）；声明汇总行 `[records][declared-unanchored]`；
 * F1 rootGrant 注入语义（声明∧注入拒；注入→anchored）；I1 不写 REC-AUTH-01（hist 计数=0）；
 * serve-face boot 拒写计数桥（WeakMap→kv lastRoster）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import type { Ledger } from '@studio-next/store'
import { bootRecordRoster, wireServeRecords } from '../../../src/assembly/records/serve-face.ts'
import { decideRootGrantAbsenceState, countRootGrantFacts } from '../../../src/assembly/serve/root-grant-absence-state.ts'
import {
  projectRootGrantAbsence,
  readKvJson,
  readLastRosterCounts,
  ROOT_GRANT_ABSENCE_KV,
  type AuthorityView,
} from '../../../src/assembly/serve/root-grant-absence-projection.ts'
import type { RootGrantAbsenceDeclaration } from '../../../src/assembly/serve/root-grant-absence.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const NOW = Date.UTC(2026, 10, 4)
const DECL: RootGrantAbsenceDeclaration = { declaredBy: '制作人', reason: 'init 通道无外部事实', until: '2026-12-31' }

function ledgerFixture(): { ledger: Ledger; logs: string[] } {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-rga-proj-'))
  dirs.push(dir)
  const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
  const logs: string[] = []
  return { ledger, logs }
}

describe('投影 kv 四键 + 面板视图', () => {
  it('unanchored-declared：四键写入、authority.view 形状/untilSoon、汇总行含前缀', () => {
    const { ledger, logs } = ledgerFixture()
    try {
      ledger.kvSet(ROOT_GRANT_ABSENCE_KV.lastRoster, JSON.stringify({ at: 1_790_000_000_000, counts: { 'REC-LIFE-01': 28, 'REC-AUTH-01': 1 } }))
      projectRootGrantAbsence({
        ledger,
        company: 'acme',
        state: 'unanchored-declared',
        authGrantCount: 0,
        rootGrantPresent: false,
        declaration: { ...DECL, until: '2026-11-10' }, // 6 天→untilSoon
        now: NOW,
        log: (line) => logs.push(line),
      })
      const rootAbs = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.rootGrantAbsence) as {
        state: string
        declaration: { by: string; until: string }
      }
      expect(rootAbs).toMatchObject({ state: 'unanchored-declared', declaration: { by: '制作人', until: '2026-11-10' } })
      const lastBoot = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsLastBoot) as {
        at: number | null
        counts: Record<string, number>
      }
      expect(lastBoot).toMatchObject({ at: 1_790_000_000_000, counts: { 'REC-LIFE-01': 28, 'REC-AUTH-01': 1 } })
      const total = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsTotal) as { counts: Record<string, number> }
      expect(total.counts).toEqual({ 'REC-LIFE-01': 28, 'REC-AUTH-01': 1 })
      const view = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.authorityView) as AuthorityView
      expect(view.state).toBe('unanchored-declared')
      expect(view.declaration).toMatchObject({ by: '制作人', until: '2026-11-10', untilSoon: true })
      expect(view.rootGrant).toMatchObject({ present: false, count: 0 })
      expect(view.levelClaim).toEqual({ configured: null, structural: 'CL2-unmet' })
      expect(view.notice).toContain('声明不是授予')
      expect(view.notice).toContain('G8 双角色')
      expect(logs.some((line) => line.includes('[records][declared-unanchored] 拒写汇总：'))).toBe(true)
      expect(logs.some((line) => line.includes('REC-LIFE-01×28'))).toBe(true)
      expect(logs.some((line) => line.includes('临期'))).toBe(true)
    } finally {
      ledger.close()
    }
  })

  it('refusals 缺失：at:null/counts:{}（不补 0）+欠账 log；total 跨次累计', () => {
    const { ledger, logs } = ledgerFixture()
    try {
      projectRootGrantAbsence({
        ledger, company: 'acme', state: 'unanchored-undeclared', authGrantCount: 0,
        rootGrantPresent: false, now: NOW, log: (line) => logs.push(line),
      })
      expect(readLastRosterCounts(ledger, (line) => logs.push(line))).toEqual({ at: null, counts: {} })
      const missing = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsLastBoot) as { at: number | null; counts: Record<string, number> }
      expect(missing).toEqual({ at: null, counts: {} })
      expect(logs.some((line) => line.includes('不补 0'))).toBe(true)
      // 第二次：lastRoster 有 2 条 → total 累计
      ledger.kvSet(ROOT_GRANT_ABSENCE_KV.lastRoster, JSON.stringify({ at: 2, counts: { 'REC-LIFE-01': 2 } }))
      projectRootGrantAbsence({
        ledger, company: 'acme', state: 'unanchored-undeclared', authGrantCount: 0,
        rootGrantPresent: false, now: NOW + 1_000, log: (line) => logs.push(line),
      })
      const total = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.refusalsTotal) as { counts: Record<string, number> }
      expect(total.counts['REC-LIFE-01']).toBe(2)
    } finally {
      ledger.close()
    }
  })

  it('ESCALATE：既有事件名、note 可 grep、同 state|until 同日只 1 条；until 变化→新 1 条', () => {
    const { ledger, logs } = ledgerFixture()
    try {
      const project = (until: string): void =>
        projectRootGrantAbsence({
          ledger, company: 'acme', state: 'unanchored-declared', authGrantCount: 0, rootGrantPresent: false,
          declaration: { ...DECL, until }, now: NOW, log: (line) => logs.push(line),
        })
      project('2026-12-31')
      project('2026-12-31')
      let events = ledger.queryEvents({ company: 'acme' }).filter((event) => event.event === 'ESCALATE')
      expect(events).toHaveLength(1)
      const note = events[0]?.note ?? ''
      for (const needle of ['ROOT_GRANT_ABSENCE;DECLARED', 'declaredBy=制作人', 'until=2026-12-31', 'REC-AUTH-01×0', 'G8 双角色拒写残余', '声明不是授予']) {
        expect(note).toContain(needle)
      }
      project('2026-12-30')
      events = ledger.queryEvents({ company: 'acme' }).filter((event) => event.event === 'ESCALATE')
      expect(events).toHaveLength(2)
    } finally {
      ledger.close()
    }
  })

  it('I1：投影不写 REC-AUTH-01（hist 计数保持 0）；声明不被引用', () => {
    const { ledger, logs } = ledgerFixture()
    try {
      expect(countRootGrantFacts(ledger, 'acme')).toBe(0)
      projectRootGrantAbsence({
        ledger, company: 'acme', state: 'unanchored-declared', authGrantCount: 0, rootGrantPresent: false,
        declaration: DECL, now: NOW, log: (line) => logs.push(line),
      })
      expect(countRootGrantFacts(ledger, 'acme')).toBe(0)
    } finally {
      ledger.close()
    }
  })
})

describe('F1 rootGrant 注入语义（纯判定）', () => {
  it('声明∧注入→CONFIG_INVALID；无声明∧注入→anchored；补测试', () => {
    expect(() =>
      decideRootGrantAbsenceState({ declaration: DECL, authGrantCount: 0, rootGrantPresent: true, now: NOW }),
    ).toThrow(/RootGrantFact/)
    const injected = decideRootGrantAbsenceState({ authGrantCount: 0, rootGrantPresent: true, now: NOW })
    expect(injected.state).toBe('anchored')
    expect(injected.rootGrantPresent).toBe(true)
    expect(injected.notice[0]).toContain('外部事实已注入')
  })
})

describe('serve-face boot 拒写计数桥（WeakMap→kv lastRoster）', () => {
  it('wireServeRecords 登记 ledger；bootRecordRoster 写 lastRoster/injected', () => {
    const { ledger, logs } = ledgerFixture()
    try {
      const face = wireServeRecords({ ledger, company: 'acme', clock: () => NOW, log: (line) => logs.push(line) })
      expect(ledger.kvGet(ROOT_GRANT_ABSENCE_KV.injected)).toBe('false')
      bootRecordRoster({ records: face.records, at: NOW, log: (line) => logs.push(line) })
      const lastRoster = readKvJson(ledger, ROOT_GRANT_ABSENCE_KV.lastRoster) as { at: number; counts: Record<string, number> }
      expect(lastRoster.at).toBe(NOW)
      expect(typeof lastRoster.counts).toBe('object')
    } finally {
      ledger.close()
    }
  })
})
