/** 737 成本对账阈值分级（纯函数；制作人 2026-11-04 口径）。 */
import { describe, expect, it } from 'vitest'
import { classifyCostRecon, costReconLogLine, COST_RECON_IGNORE_USD } from '../../src/costclose.ts'

describe('classifyCostRecon（cost_daily=结算权威；GATE_PASS=明细）', () => {
  it('≤$0.005 ignore；>$0.5 或 >0.5% warn；>$5 或 >5% escalate', () => {
    expect(COST_RECON_IGNORE_USD).toBe(0.005)
    expect(classifyCostRecon(0.005, 100)).toBe('ignore')
    expect(classifyCostRecon(-0.005, 100)).toBe('ignore')
    expect(classifyCostRecon(0.006, 100)).toBe('ignore')
    expect(classifyCostRecon(1, 100)).toBe('warn')
    expect(classifyCostRecon(0.6, 100)).toBe('warn')
    expect(classifyCostRecon(0.4, 10)).toBe('warn')
    expect(classifyCostRecon(6, 100)).toBe('escalate')
    expect(classifyCostRecon(5.01, 10_000)).toBe('escalate')
    expect(classifyCostRecon(0.06, 1)).toBe('escalate')
    expect(classifyCostRecon(100, 0)).toBe('escalate') // 无明细
    expect(classifyCostRecon(0, 0)).toBe('ignore')
  })
  it('日志行口径可 grep（level/closed/harvest/delta；log-only）', () => {
    const line = costReconLogLine({ date: '2026-11-03', closedUsd: 100, harvestUsd: 99, deltaUsd: 1 }, 'warn')
    expect(line).toContain('[cost-recon] date=2026-11-03 level=warn')
    expect(line).toContain('closed=$100.0000')
    expect(line).toContain('harvest=$99.0000')
    expect(line).toContain('delta=$1.0000')
    expect(line).toContain('log-only')
  })
})
