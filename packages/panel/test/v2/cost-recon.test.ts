/** 面板成本对账观测块（studio-dev-737）：kv 正常/缺失/坏 JSON → known/unknown，不补 0。 */
import { describe, expect, it } from 'vitest'
import { buildCostReconBlock } from '../../src/cost-recon.ts'

const RAW = JSON.stringify({
  date: '2026-11-03', at: 1, level: 'warn', closedUsd: 100, harvestUsd: 99, deltaUsd: 1,
  caliber: 'cost-recon/v1', perModel: [{ model: 'm', closedUsd: 100, harvestUsd: 99, deltaUsd: 1 }],
})

describe('buildCostReconBlock', () => {
  it('known：字段解析（level/closed/harvest/delta/perModel）', () => {
    const block = buildCostReconBlock(RAW)
    expect(block.state).toBe('known')
    expect(block.level).toBe('warn')
    expect(block.closedUsd).toBe(100)
    expect(block.harvestUsd).toBe(99)
    expect(block.deltaUsd).toBe(1)
    expect(block.perModel).toHaveLength(1)
  })
  it('缺失/坏 JSON/坏 level→unknown（不补 0）', () => {
    for (const raw of [null, '', '{bad', 'null', JSON.stringify({ level: 'green' })]) {
      const block = buildCostReconBlock(raw)
      expect(block.state).toBe('unknown')
      expect(block.level).toBe('unknown')
      expect(block.closedUsd).toBeNull()
    }
  })
})
