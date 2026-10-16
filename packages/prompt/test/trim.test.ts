/**
 * trim 测试 —— C2-09 裁剪阶梯：预算内零裁 / 阶次触发（L3 留最近 N → L4 教训减半 →
 * L1 战役降一句）/ 画像与验收口径结构性保留 / protected（L0/L2）永不裁 /
 * 裁剪清单 / 指纹联动 / 不可变 / 永不达标也不越红线。
 *
 * 预算算术用受控夹具（等长行）确保阶次触发是确定性的，不做脆弱的字数估算。
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_KEEP_RECENT_N, trimLayers, type TrimCut } from '../src/trim.ts'
import { buildLayers, trimMarkerBegin, trimMarkerEnd, type LayerSource } from '../src/layers.ts'
import { standardLayers, standardSources } from './helpers.ts'

const charsOf = (ls: readonly { content: string }[]): number =>
  ls.reduce((n, l) => n + l.content.length, 0)

/** 受控夹具：可裁行等长（40 字符），便于精确预算 */
function controlledSources(opts: {
  withWorkHistory: boolean
  withLessons: boolean
  withCampaign: boolean
}): LayerSource[] {
  const sources = standardSources()
  const l1 = sources[1] as Extract<(typeof sources)[number], { kind: 'L1-company' }>
  l1.sections = l1.sections.filter((s) => s.kind !== 'campaign')
  if (opts.withCampaign) {
    l1.sections.push({
      kind: 'campaign',
      lines: ['c'.repeat(40), 'd'.repeat(40), 'e'.repeat(40)],
    })
  }
  const l3 = sources[3] as Extract<(typeof sources)[number], { kind: 'L3-person' }>
  l3.sections = l3.sections.filter((s) => s.kind !== 'work_history')
  if (opts.withWorkHistory) {
    l3.sections.push({
      kind: 'work_history',
      lines: ['w1'.padEnd(40, '1'), 'w2'.padEnd(40, '2'), 'w3'.padEnd(40, '3'), 'w4'.padEnd(40, '4')],
    })
  }
  const l4 = sources[4] as Extract<(typeof sources)[number], { kind: 'L4-task' }>
  l4.lessons = opts.withLessons
    ? ['l1'.padEnd(40, 'a'), 'l2'.padEnd(40, 'b'), 'l3'.padEnd(40, 'c'), 'l4'.padEnd(40, 'd')]
    : []
  return sources
}

describe('预算内直通', () => {
  it('总长 ≤ 预算 → 零裁剪：cuts 空、六层逐字节不变、withinBudget=true', () => {
    const layers = standardLayers()
    const budget = charsOf(layers)
    const r = trimLayers(layers, budget)
    expect(r.cuts).toEqual([])
    expect(r.layers.map((l) => l.content)).toEqual(layers.map((l) => l.content))
    expect(r.withinBudget).toBe(true)
    expect(r.totalChars).toBe(budget)
  })

  it('默认 keepRecentN=3（拟稿默认，docs 开放问题待试算）', () => {
    expect(DEFAULT_KEEP_RECENT_N).toBe(3)
  })
})

describe('第一阶：L3 做过的事先裁（留最近 N 单+画像数字）', () => {
  it('超预算 → 先裁且只裁 work_history：保留最近 N 行，达标即停', () => {
    const layers = buildLayers(controlledSources({ withWorkHistory: true, withLessons: true, withCampaign: true }))
    const total = charsOf(layers)
    // 4 行×40 字符裁到 2 行 ≈ 净减 82；预算=总-30：必超、裁 L3 后必达标（阶次确定性）
    const r = trimLayers(layers, total - 30, { keepRecentN: 2 })
    expect(r.cuts.map((c) => c.rule)).toEqual(['L3_WORK_HISTORY_KEEP_RECENT_N'])
    const l3 = r.layers.find((l) => l.id === 'L3')!
    expect(l3.content).toContain('w3')
    expect(l3.content).toContain('w4') // 最近 2 单（旧→新序留末尾）
    expect(l3.content).not.toContain('w1')
    expect(l3.content).not.toContain('w2')
    expect(r.withinBudget).toBe(true)
  })

  it('画像数字结构性保留（不在任何 trim 区）：极端预算下三行画像原样在', () => {
    const layers = standardLayers()
    const r = trimLayers(layers, 1, { keepRecentN: 0 })
    const l3 = r.layers.find((l) => l.id === 'L3')!
    expect(l3.content).toContain('交付 6 单')
    expect(l3.content).toContain('打回率 0.17')
    expect(l3.content).toContain('闸门一次通过 5/6')
  })

  it('keepRecentN ≥ 现有行数 → 第一阶无裁（不无中生有）', () => {
    const layers = buildLayers(controlledSources({ withWorkHistory: true, withLessons: true, withCampaign: true }))
    const r = trimLayers(layers, charsOf(layers) - 1, { keepRecentN: 10 })
    expect(r.cuts.find((c) => c.rule === 'L3_WORK_HISTORY_KEEP_RECENT_N')).toBeUndefined()
  })
})

describe('第二阶：L4 教训 top-k 减半（验收口径永不裁）', () => {
  it('L3 裁完仍超 → 教训 4 保前 2（⌈k/2⌉，排名序）；验收 fenced 块逐字节不变', () => {
    const layers = buildLayers(controlledSources({ withWorkHistory: false, withLessons: true, withCampaign: true }))
    const total = charsOf(layers)
    const acceptanceBlock = layers
      .find((l) => l.id === 'L4')!
      .content.split('## 验收口径')[1]!
      .split('##')[0]!
    // 无 work_history → 第一阶空转；教训减半净减 82；预算=总-30 逼出且仅第二阶
    const r = trimLayers(layers, total - 30, { keepRecentN: 3 })
    expect(r.cuts.map((c) => c.rule)).toEqual(['L4_LESSONS_HALVE'])
    const cut = r.cuts[0] as TrimCut
    expect(cut.totalLines).toBe(4)
    expect(cut.keptLines).toBe(2)
    const l4 = r.layers.find((l) => l.id === 'L4')!
    expect(l4.content).toContain('l1'.padEnd(40, 'a'))
    expect(l4.content).toContain('l2'.padEnd(40, 'b'))
    expect(l4.content).not.toContain('l3'.padEnd(40, 'c'))
    expect(l4.content).not.toContain('l4'.padEnd(40, 'd'))
    expect(l4.content.split('## 验收口径')[1]!.split('##')[0]).toBe(acceptanceBlock)
    expect(r.withinBudget).toBe(true)
  })
})

describe('第三阶：L1 战役降一句', () => {
  it('前两阶后仍超 → 战役只留首个非空行；使命/方向/身份提示不动', () => {
    const layers = buildLayers(controlledSources({ withWorkHistory: false, withLessons: false, withCampaign: true }))
    const total = charsOf(layers)
    const r = trimLayers(layers, total - 30, { keepRecentN: 3 })
    expect(r.cuts.map((c) => c.rule)).toEqual(['L1_CAMPAIGN_ONE_LINE'])
    const l1 = r.layers.find((l) => l.id === 'L1')!
    expect(l1.content).toContain('c'.repeat(40))
    expect(l1.content).not.toContain('d'.repeat(40))
    expect(l1.content).not.toContain('e'.repeat(40))
    expect(l1.content).toContain('用一条可验证的交付链') // 使命
    expect(l1.content).toContain('把第一条端到端交付链跑通') // 方向
    expect(l1.content).toContain('署名由框架网关注入') // 身份提示
  })
})

describe('全阶梯与永不裁', () => {
  it('极端预算走完三阶且阶序正确（L3→L4→L1）', () => {
    const layers = standardLayers()
    const r = trimLayers(layers, 1, { keepRecentN: 2 })
    expect(r.cuts.map((c) => c.rule)).toEqual([
      'L3_WORK_HISTORY_KEEP_RECENT_N',
      'L4_LESSONS_HALVE',
      'L1_CAMPAIGN_ONE_LINE',
    ])
    expect(r.withinBudget).toBe(false) // 如实上报
  })

  it('protected 层（L0 红线/L2 署名）任何预算下逐字节不变——宁可超长不裁红线', () => {
    const layers = standardLayers()
    const r = trimLayers(layers, 1, { keepRecentN: 0 })
    expect(r.withinBudget).toBe(false)
    expect(r.layers.find((l) => l.id === 'L0')!.content).toBe(layers[0]!.content)
    expect(r.layers.find((l) => l.id === 'L2')!.content).toBe(layers[2]!.content)
    expect(r.layers.find((l) => l.id === 'L0')!.content).toContain('无证据=无完成') // 红线不丢（C2-09 验收）
  })

  it('裁后 trim 区标记成对仍在（区结构不破坏）+ 裁剪清单 removedChars>0', () => {
    const layers = standardLayers()
    const r = trimLayers(layers, 1, { keepRecentN: 1 })
    expect(r.cuts.length).toBeGreaterThan(0)
    expect(r.cuts.every((c) => c.removedChars > 0)).toBe(true)
    for (const cut of r.cuts) {
      const layer = r.layers.find((l) => l.id === cut.layer)!
      const kind =
        cut.rule === 'L3_WORK_HISTORY_KEEP_RECENT_N'
          ? 'work_history'
          : cut.rule === 'L4_LESSONS_HALVE'
            ? 'lessons'
            : 'campaign'
      expect(layer.content).toContain(trimMarkerBegin(kind))
      expect(layer.content).toContain(trimMarkerEnd(kind))
    }
  })

  it('指纹联动：L3 裁后 p 段重算（≠原）；L4 裁后 t 段不变（冻结式无内容 rev，疑点记录）', () => {
    const layers = standardLayers()
    const before = Object.fromEntries(layers.map((l) => [l.id, l.fingerprint]))
    const r = trimLayers(layers, 1, { keepRecentN: 1 })
    const after = Object.fromEntries(r.layers.map((l) => [l.id, l.fingerprint]))
    expect(after.L3).not.toBe(before.L3)
    expect(after.L1).not.toBe(before.L1)
    expect(after.L4).toBe(before.L4)
    expect(after.L0).toBe(before.L0)
    expect(after.L2).toBe(before.L2)
    expect(after.L5).toBe(before.L5)
  })

  it('不可变：入参原层数组/对象不被修改（纯函数）', () => {
    const layers = standardLayers()
    const snapshot = layers.map((l) => ({ ...l, trimmables: [...l.trimmables] }))
    trimLayers(layers, 1, { keepRecentN: 1 })
    expect(layers).toEqual(snapshot)
  })
})
