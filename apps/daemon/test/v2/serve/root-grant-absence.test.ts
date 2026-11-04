/**
 * 根授予无锚声明配置面单测（studio-dev-707 段1；docs/v2/03 §3.1.1、v2/15 §7.3、v2/17 NEG-ORG-09a-d）
 *
 * 覆盖：真日历日校验/到期状态/三键成对/长度/companyDir 消费面；parseDaemonConfig 集成；
 * 启动状态机三态与冲突/过期拒启（纯判定）；REC-AUTH-01 计数=0（真实空台账）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { parseDaemonConfig } from '../../../src/assembly/serve/config.ts'
import {
  coerceRootGrantAbsenceDeclaration,
  isValidIsoDateUtc,
  rootGrantAbsenceUntilStatus,
  utcDayStart,
} from '../../../src/assembly/serve/root-grant-absence.ts'
import {
  countRootGrantFacts,
  decideRootGrantAbsenceState,
} from '../../../src/assembly/serve/root-grant-absence-state.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDir(): string {
  const dir = mkdtempSync(path.join(process.cwd(), '.tmp-rga-'))
  dirs.push(dir)
  return dir
}
const NOW = Date.UTC(2026, 10, 4) // 2026-11-04 UTC
const DECL = { declaredBy: '制作人', reason: 'init 通道无外部事实', until: '2026-12-31' }

describe('日期/到期口径', () => {
  it('isValidIsoDateUtc：真日历日（闰年/大小月/非法）', () => {
    expect(isValidIsoDateUtc('2026-11-04')).toBe(true)
    expect(isValidIsoDateUtc('2024-02-29')).toBe(true)
    expect(isValidIsoDateUtc('2026-02-29')).toBe(false)
    expect(isValidIsoDateUtc('2026-04-31')).toBe(false)
    expect(isValidIsoDateUtc('2026-13-01')).toBe(false)
    expect(isValidIsoDateUtc('2026-1-4')).toBe(false)
    expect(isValidIsoDateUtc('2026/11/04')).toBe(false)
  })
  it('untilStatus：active/expiring(≤14 天)/expired', () => {
    expect(utcDayStart(NOW)).toBe(Date.UTC(2026, 10, 4))
    expect(rootGrantAbsenceUntilStatus('2026-11-03', NOW)).toBe('expired')
    expect(rootGrantAbsenceUntilStatus('2026-11-04', NOW)).toBe('expiring')
    expect(rootGrantAbsenceUntilStatus('2026-11-18', NOW)).toBe('expiring')
    expect(rootGrantAbsenceUntilStatus('2026-11-19', NOW)).toBe('active')
  })
})

describe('coerceRootGrantAbsenceDeclaration（fail-closed）', () => {
  it('三键全给→声明；空/缺任一→undefined 或拒绝且报键名', () => {
    expect(coerceRootGrantAbsenceDeclaration({}, { companyDir: tempDir() })).toBeUndefined()
    const dir = tempDir()
    const decl = coerceRootGrantAbsenceDeclaration(DECL, { companyDir: dir, now: () => NOW })
    expect(decl).toEqual(DECL)
    for (const [raw, missing] of [
      [{ reason: DECL.reason, until: DECL.until }, 'recordRootGrantAbsenceDeclaredBy'],
      [{ declaredBy: DECL.declaredBy, until: DECL.until }, 'recordRootGrantAbsenceReason'],
      [{ declaredBy: DECL.declaredBy, reason: DECL.reason }, 'recordRootGrantAbsenceUntil'],
    ] as const) {
      expect(() => coerceRootGrantAbsenceDeclaration(raw, { companyDir: dir, now: () => NOW })).toThrow(new RegExp(missing))
    }
  })
  it('超长声明人/非法日期/已过期/无 companyDir → CONFIG_INVALID 拒', () => {
    const dir = tempDir()
    const call = (raw: Record<string, string>, ctx: { companyDir: string | undefined } = { companyDir: dir }): unknown =>
      coerceRootGrantAbsenceDeclaration(raw, { ...ctx, now: () => NOW })
    expect(() => call({ ...DECL, declaredBy: 'x'.repeat(201) })).toThrow(/超长/)
    expect(() => call({ ...DECL, until: '2026-02-29' })).toThrow(/真日历日/)
    expect(() => call({ ...DECL, until: '2026-11-03' })).toThrow(/已过期/)
    expect(() => call(DECL, { companyDir: undefined })).toThrow(/companyDir/)
  })
})

describe('parseDaemonConfig 集成（daemon.yaml 三键）', () => {
  const yaml = (extra: string): string =>
    ['db: ./var/ledger.sqlite', 'company: acme', 'rootDir: ./var', 'platform: fake', extra].join('\n')
  it('三键合法→进入 ServeConfig.recordRootGrantAbsence（声明只解析，不是授予）', () => {
    const dir = tempDir()
    const cfg = parseDaemonConfig(
      yaml(
        `companyDir: ${dir}\nrecordRootGrantAbsenceDeclaredBy: 制作人\nrecordRootGrantAbsenceReason: init 通道无外部事实\nrecordRootGrantAbsenceUntil: 2099-12-31`,
      ),
    )
    expect(cfg.recordRootGrantAbsence).toEqual({ declaredBy: '制作人', reason: 'init 通道无外部事实', until: '2099-12-31' })
    // 无声明时字段缺省（旧配置零行为变化）
    expect(parseDaemonConfig(yaml('')).recordRootGrantAbsence).toBeUndefined()
  })
  it('缺键/过期→CONFIG_INVALID 拒启（错误含键名/原因）', () => {
    const dir = tempDir()
    expect(() =>
      parseDaemonConfig(yaml(`companyDir: ${dir}\nrecordRootGrantAbsenceDeclaredBy: 制作人\nrecordRootGrantAbsenceUntil: 2099-12-31`)),
    ).toThrow(/recordRootGrantAbsenceReason/)
    expect(() =>
      parseDaemonConfig(
        yaml(
          `companyDir: ${dir}\nrecordRootGrantAbsenceDeclaredBy: 制作人\nrecordRootGrantAbsenceReason: x\nrecordRootGrantAbsenceUntil: 2020-01-01`,
        ),
      ),
    ).toThrow(/已过期/)
  })
})

describe('启动状态机 decideRootGrantAbsenceState', () => {
  it('三态：undeclared/declared/anchored；声明行含 G8 残余标注', () => {
    const undeclared = decideRootGrantAbsenceState({ authGrantCount: 0, now: NOW })
    expect(undeclared.state).toBe('unanchored-undeclared')
    expect(undeclared.notice[0]).toContain('根授予无锚未声明')
    expect(undeclared.notice[0]).toContain('G8 双角色拒写残余')
    const declared = decideRootGrantAbsenceState({ declaration: DECL, authGrantCount: 0, now: NOW })
    expect(declared.state).toBe('unanchored-declared')
    expect(declared.notice[0]).toContain(`declaredBy=${DECL.declaredBy}`)
    expect(declared.notice[0]).toContain('状态=unanchored-declared')
    const anchored = decideRootGrantAbsenceState({ authGrantCount: 2, now: NOW })
    expect(anchored.state).toBe('anchored')
  })
  it('声明临期→WARN 行；声明+链并存/Until 过期→CONFIG_INVALID 拒', () => {
    const expiring = decideRootGrantAbsenceState({ declaration: { ...DECL, until: '2026-11-10' }, authGrantCount: 0, now: NOW })
    expect(expiring.notice.some((line) => line.includes('临期'))).toBe(true)
    expect(() => decideRootGrantAbsenceState({ declaration: DECL, authGrantCount: 1, now: NOW })).toThrow(/并存/)
    expect(() =>
      decideRootGrantAbsenceState({ declaration: { ...DECL, until: '2026-11-03' }, authGrantCount: 0, now: NOW }),
    ).toThrow(/已过期/)
  })
  it('真实空台账 REC-AUTH-01 计数=0（读面 fail-closed 不冒充有链）', () => {
    const dir = tempDir()
    const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
    try {
      expect(countRootGrantFacts(ledger, 'acme')).toBe(0)
    } finally {
      ledger.close()
    }
  })
})
