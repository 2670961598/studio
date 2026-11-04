/**
 * 面板 authority 块单测（studio-dev-707 段2；docs/v2/03 §3.1.1、docs/17-§2）
 *
 * 覆盖：kv 正常→块解析/字段齐全；kv 缺失/坏 JSON/坏 state→unknown+unavailable（不显示绿、不补 0）；
 * buildDashboardSnapshot 新增字段为加法（旧字段保留，不改端点）。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { buildAuthorityBlock } from '../../src/authority.ts'
import { buildDashboardSnapshot } from '../../src/views.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function tempDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'panel-authority-'))
  dirs.push(dir)
  return path.join(dir, 'ledger.sqlite')
}

const VIEW = {
  v: 1,
  state: 'unanchored-declared',
  declaration: { by: '制作人', reason: 'init 通道', until: '2026-12-31', untilSoon: false },
  rootGrant: { expectedRecordId: null, present: false, count: 0 },
  refusals: { lastBoot: { at: 1, counts: { 'REC-LIFE-01': 28 } }, total: { 'REC-LIFE-01': 28 } },
  levelClaim: { configured: null, structural: 'CL2-unmet' },
  notice: '含 G8 双角色拒写残余（ENG-0，另单）；声明不是授予',
}

describe('buildAuthorityBlock（只读解析，坏数据不显示绿）', () => {
  it('正常 JSON→字段齐全', () => {
    const block = buildAuthorityBlock(JSON.stringify(VIEW))
    expect(block.unavailable).toBe(false)
    expect(block.state).toBe('unanchored-declared')
    expect(block.declaration).toMatchObject({ by: '制作人', until: '2026-12-31', untilSoon: false })
    expect(block.rootGrant).toMatchObject({ present: false, count: 0, expectedRecordId: null })
    expect(block.refusals.lastBoot.counts['REC-LIFE-01']).toBe(28)
    expect(block.levelClaim.structural).toBe('CL2-unmet')
  })
  it('缺失/坏 JSON/坏 state→unknown+unavailable（不补绿/不补 0）', () => {
    for (const raw of [null, '', '{bad json', 'null', JSON.stringify({ state: 'green' })]) {
      const block = buildAuthorityBlock(raw)
      expect(block.state).toBe('unknown')
      expect(block.unavailable).toBe(true)
      expect(block.rootGrant.count).toBe(0)
      expect(block.refusals.lastBoot.at).toBeNull()
    }
  })
})

describe('buildDashboardSnapshot.authority（加法字段）', () => {
  it('kv 有投影→块可读；旧字段（jobs/runs/events/observation）保留', () => {
    const dbPath = tempDb()
    const ledger = openLedger(dbPath)
    try {
      ledger.kvSet('records.authority.view', JSON.stringify(VIEW))
      const snapshot = buildDashboardSnapshot(ledger, { now: 1_790_000_000_000 })
      expect(snapshot.authority.state).toBe('unanchored-declared')
      expect(snapshot.authority.unavailable).toBe(false)
      // 旧面不回归
      expect(snapshot.jobs).toBeDefined()
      expect(snapshot.runs.total).toBe(0)
      expect(snapshot.observation).toBeDefined()
    } finally {
      ledger.close()
    }
  })
  it('kv 无投影→authority=unknown（不显示全绿）', () => {
    const dbPath = tempDb()
    const ledger = openLedger(dbPath)
    try {
      const snapshot = buildDashboardSnapshot(ledger, { now: 1 })
      expect(snapshot.authority.state).toBe('unknown')
      expect(snapshot.authority.unavailable).toBe(true)
      expect(snapshot.authority.reason).toBe('kv-missing')
    } finally {
      ledger.close()
    }
  })
})
