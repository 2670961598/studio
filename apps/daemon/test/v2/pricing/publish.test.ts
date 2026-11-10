/**
 * 定价发布生成面 V2 套件（studio-dev-554；rework studio-dev-584 保持断言面）
 * models.yaml 三档 → pricing.yaml → price_snapshots。
 *
 * 断言面：
 *   ① 三档异模型 → 三条 model 行；生成文本过消费面 parse+覆盖闸（生成器/消费者不漂移）；
 *   ② 三档同模型同价（生产现状 models.yaml）→ 合法折叠为一条 model 行，三档覆盖仍成立；
 *   ③ 同模型异价/缺档/坏价 → CONFIG_INVALID fail-closed（不生成坏价目）；
 *   ④ writePricingDeliverable 落盘 deliverables/pricing.yaml，同输入同字节（无时间戳/随机）；
 *   ⑤ store 单据幂等：同 source_ticket 同内容重放 appended=false；异内容 ticket-conflict。
 *
 * 依据：docs/17-§2（派发相位）/§6（收割四要件）；消费面形状=packages/core/src/pricing.ts。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { parsePricingTable, validatePricingTable } from '@studio-next/core'
import type { ModelTier } from '@studio-next/contract'
import { openLedger } from '@studio-next/store'
import {
  buildPricingTable,
  renderPricingTableYaml,
  writePricingDeliverable,
} from '../../../src/engine/pricing/publish.ts'
import { consumePricingPublish } from '../../../src/engine/pricing/pricing.ts'
import { jobMaterializeType } from '../../../src/engine/intents/drain.ts'
import { makeUlid } from '../../../src/engine/tools/id.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn584-pricing-'))
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

function tier(id: ModelTier['tier'], provider: string, model: string, input: number, output: number): ModelTier {
  return { tier: id, provider, model, price: { inputPerM: input, outputPerM: output } }
}

/** 生产形：三档同模型同价（2026-11-03 models.yaml 实测 0.015/0.06） */
const SAME_MODEL: ModelTier[] = [
  tier('high', 'opencode-go', 'deepseek-v4.1-flash', 0.015, 0.06),
  tier('mid', 'opencode-go', 'deepseek-v4.1-flash', 0.015, 0.06),
  tier('low', 'opencode-go', 'deepseek-v4.1-flash', 0.015, 0.06),
]

/** 三档异模型（常规形态） */
const THREE_MODELS: ModelTier[] = [
  tier('high', 'deepseek', 'v4-pro', 1.32, 3.96),
  tier('mid', 'zhipu', 'glm-5.3', 0.6, 2.2),
  tier('low', 'deepseek', 'flash', 0.15, 0.6),
]

const NOTE = '测试来源注记'

describe('buildPricingTable（三档 → 消费面冻结形状）', () => {
  it('三档异模型 → 三条 model 行，生成文本过消费面 parse/覆盖闸', () => {
    const table = buildPricingTable({ tiers: THREE_MODELS, priceDate: '2026-11-03', sourceNote: NOTE })
    expect(table.models.map((m) => `${m.provider}/${m.model}`)).toEqual([
      'deepseek/v4-pro',
      'zhipu/glm-5.3',
      'deepseek/flash',
    ])
    const text = renderPricingTableYaml(table)
    const parsed = parsePricingTable(text)
    expect(parsed.priceDate).toBe('2026-11-03')
    expect(parsed.models).toHaveLength(3)
    expect(() => validatePricingTable(parsed, THREE_MODELS)).not.toThrow()
  })

  it('三档同模型同价（生产现状）→ 合法折叠为一条 model 行，三档覆盖仍成立', () => {
    const table = buildPricingTable({ tiers: SAME_MODEL, priceDate: '2026-11-03', sourceNote: NOTE })
    expect(table.models).toHaveLength(1)
    expect(table.models[0]?.provider).toBe('opencode-go')
    expect(table.models[0]?.model).toBe('deepseek-v4.1-flash')
    expect(table.models[0]?.prices[0]?.inputPerM).toBe(0.015)
    expect(table.models[0]?.prices[0]?.outputPerM).toBe(0.06)
    const parsed = parsePricingTable(renderPricingTableYaml(table))
    // 覆盖闸按 provider/model 集合判定：三档同键=同一模型全覆盖
    expect(() => validatePricingTable(parsed, SAME_MODEL)).not.toThrow()
  })

  it('同模型异价 → price-conflict 拒（不静默择一）', () => {
    const tiers = [
      tier('high', 'zhipu', 'glm-5.3', 0.6, 2.2),
      tier('mid', 'zhipu', 'glm-5.3', 0.3, 1.1),
      tier('low', 'zhipu', 'glm-5.4', 0.1, 0.4),
    ]
    expect(() => buildPricingTable({ tiers, priceDate: '2026-11-03', sourceNote: NOTE })).toThrow(
      /pricing-publish\/price-conflict/,
    )
  })

  it('缺档/档数不足 → tiers-incomplete 拒（不发布半表）', () => {
    expect(() => buildPricingTable({ tiers: undefined, priceDate: '2026-11-03', sourceNote: NOTE })).toThrow(
      /pricing-publish\/tiers-incomplete/,
    )
    expect(() =>
      buildPricingTable({ tiers: THREE_MODELS.slice(0, 2), priceDate: '2026-11-03', sourceNote: NOTE }),
    ).toThrow(/pricing-publish\/tiers-incomplete/)
  })

  it('坏价（负/非有限）→ tier-invalid 拒', () => {
    const negative = [...THREE_MODELS.slice(0, 2), tier('low', 'x', 'm', -1, 0.1)]
    expect(() => buildPricingTable({ tiers: negative, priceDate: '2026-11-03', sourceNote: NOTE })).toThrow(
      /pricing-publish\/tier-invalid/,
    )
    const nan = [...THREE_MODELS.slice(0, 2), tier('low', 'x', 'm', Number.NaN, 0.1)]
    expect(() => buildPricingTable({ tiers: nan, priceDate: '2026-11-03', sourceNote: NOTE })).toThrow(
      /pricing-publish\/tier-invalid/,
    )
  })

  it('坏日期/空来源 → 拒', () => {
    expect(() => buildPricingTable({ tiers: THREE_MODELS, priceDate: '2026-02-30', sourceNote: NOTE })).toThrow(
      /pricing-publish\/bad-date/,
    )
    expect(() => buildPricingTable({ tiers: THREE_MODELS, priceDate: '2026-11-03', sourceNote: '  ' })).toThrow(
      /pricing-publish\/bad-source-note/,
    )
  })
})

describe('writePricingDeliverable（派发相位附件生成）', () => {
  it('落盘 deliverables/pricing.yaml（同输入同字节，sha256 稳定）', () => {
    const ws = path.join(ROOT, 'ws-a')
    const a = writePricingDeliverable({ workspace: ws, tiers: SAME_MODEL, priceDate: '2026-11-03' })
    const b = writePricingDeliverable({ workspace: ws, tiers: SAME_MODEL, priceDate: '2026-11-03' })
    expect(a.path).toBe(path.join(ws, 'deliverables', 'pricing.yaml'))
    expect(readFileSync(a.path, 'utf8')).toBe(a.text)
    expect(a.sha256).toBe(b.sha256)
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(a.table.models).toHaveLength(1)
  })

  it('catalog 缺席（态 B）→ 抛错 fail-closed（不落坏附件）', () => {
    const ws = path.join(ROOT, 'ws-b')
    expect(() => writePricingDeliverable({ workspace: ws, tiers: undefined, priceDate: '2026-11-03' })).toThrow(
      /pricing-publish\/tiers-incomplete/,
    )
  })
})

describe('生成→消费闭环（同一附件/同一 store 写面）', () => {
  it('派发相位生成的三档附件 → consumePricingPublish 解析/覆盖/append，零告警', () => {
    const ws = path.join(ROOT, 'ws-e2e')
    const written = writePricingDeliverable({ workspace: ws, tiers: SAME_MODEL, priceDate: '2026-11-03' })
    const ledger = openLedger(path.join(ROOT, 'ledger-e2e.sqlite'))
    try {
      const alarms: string[] = []
      const errors: string[] = []
      const result = consumePricingPublish({
        ledger,
        ticket: 'studio-dev-9999',
        issueType: 'pricing',
        workspace: ws,
        company: 'test-co',
        personId: 'HF-1',
        declared: SAME_MODEL.map((t) => ({ provider: t.provider, model: t.model })),
        now: () => Date.now(),
        makeId: (ts) => makeUlid(ts),
        emitAlarm: (note) => alarms.push(note),
        onError: (message) => errors.push(message),
      })
      expect(result.noteSuffix).toContain(';pricing=1行@2026-11-03v1..1')
      expect(alarms).toEqual([])
      expect(errors).toEqual([])
      const rows = ledger.listPriceSnapshots({ company: 'test-co', source_ticket: 'studio-dev-9999' })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.input_per_m).toBe(0.015)
      expect(rows[0]?.output_per_m).toBe(0.06)
      expect(rows[0]?.published_by).toBe('HF-1')
      expect(rows[0]?.currency).toBe('USD')
      expect(written.table.models).toHaveLength(1)
    } finally {
      ledger.close()
    }
  })
})

describe('jobMaterializeType（定时岗 payload.type → 单据类型）', () => {
  it('pricing 透传（供给面缺口）；patrol 保持巡查特例；其余仍 task（现状零变更）', () => {
    expect(jobMaterializeType({ type: 'pricing' })).toBe('pricing')
    expect(jobMaterializeType({ type: 'patrol' })).toBe('patrol')
    expect(jobMaterializeType({ type: 'report' })).toBe('task')
    expect(jobMaterializeType({})).toBe('task')
    expect(jobMaterializeType(undefined)).toBe('task')
  })
})

describe('price_snapshots 单据幂等（补种/重放面）', () => {
  it('同 source_ticket 同内容重放 appended=false；异内容 ticket-conflict', () => {
    const db = path.join(ROOT, 'ledger.sqlite')
    const ledger = openLedger(db)
    try {
      const table = buildPricingTable({ tiers: SAME_MODEL, priceDate: '2026-11-03', sourceNote: NOTE })
      const m = table.models[0]
      expect(m).toBeDefined()
      const p = m?.prices[0]
      expect(p).toBeDefined()
      const input = {
        id: `ps-${makeUlid(Date.now())}`,
        company: 'test-co',
        provider: m?.provider as string,
        model: m?.model as string,
        price_date: table.priceDate,
        slot: p?.slot as 'peak',
        input_per_m: p?.inputPerM as number,
        output_per_m: p?.outputPerM as number,
        currency: 'USD' as const,
        billing_track: 'api' as const,
        source_note: table.sourceNote,
        source_ticket: 'seed-pricing:2026-11-03',
        published_by: 'HF-1',
      }
      const first = ledger.appendPriceSnapshot(input)
      const second = ledger.appendPriceSnapshot({ ...input, id: `ps-${makeUlid(Date.now())}` })
      expect(first.appended).toBe(true)
      expect(second.appended).toBe(false)
      expect(second.id).toBe(first.id)
      expect(() => ledger.appendPriceSnapshot({ ...input, id: `ps-${makeUlid(Date.now())}`, input_per_m: 9 })).toThrow(
        /store\/price-snapshot:ticket-conflict/,
      )
      expect(ledger.listPriceSnapshots({ company: 'test-co', source_ticket: 'seed-pricing:2026-11-03' })).toHaveLength(1)
    } finally {
      ledger.close()
    }
  })
})


describe('B2 cache 价扩键：publish 渲染/消费/快照列', () => {
  const cacheTier = (id: ModelTier['tier']): ModelTier => ({
    tier: id,
    provider: 'glm',
    model: 'GLM-5.3',
    price: { inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0 },
  })
  const CACHE_MODEL: ModelTier[] = [cacheTier('high'), cacheTier('mid'), cacheTier('low')]

  it('三档含 cache 键 → 价目表 unit 透传 + 渲染 cacheReadPerM/cacheCreationPerM + parse 往返', () => {
    const table = buildPricingTable({ tiers: CACHE_MODEL, priceDate: '2026-11-11', sourceNote: 'B2 cache 价' })
    expect(table.models).toHaveLength(1) // 三档同模型同价折叠
    expect(table.models[0]?.prices[0]).toMatchObject({ inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0 })
    const text = renderPricingTableYaml(table)
    expect(text).toContain('cacheReadPerM: 0.2778')
    expect(text).toContain('cacheCreationPerM: 0')
    const parsed = parsePricingTable(text)
    expect(parsed.models[0]?.prices[0]?.cacheReadPerM).toBe(0.2778)
    expect(() => validatePricingTable(parsed, CACHE_MODEL)).not.toThrow()
  })

  it('生成→消费闭环：pricing.yaml cache 键落 price_snapshots cache 列（非空）', () => {
    const ws = path.join(ROOT, 'ws-b2-cache')
    writePricingDeliverable({ workspace: ws, tiers: CACHE_MODEL, priceDate: '2026-11-11' })
    const ledger = openLedger(path.join(ROOT, 'ledger-b2-cache.sqlite'))
    try {
      const result = consumePricingPublish({
        ledger,
        ticket: 'studio-dev-b2-cache',
        issueType: 'pricing',
        workspace: ws,
        company: 'test-co',
        personId: 'HF-1',
        declared: CACHE_MODEL.map((t) => ({ provider: t.provider, model: t.model })),
        now: () => Date.now(),
        makeId: (ts) => makeUlid(ts),
        emitAlarm: () => {},
        onError: () => {},
      })
      expect(result.noteSuffix).toContain(';pricing=1行@2026-11-11')
      const rows = ledger.listPriceSnapshots({ company: 'test-co', source_ticket: 'studio-dev-b2-cache' })
      expect(rows).toHaveLength(1)
      expect(rows[0]?.cache_read_per_m).toBe(0.2778)
      expect(rows[0]?.cache_creation_per_m).toBe(0)
      expect(rows[0]?.input_per_m).toBe(1.1111)
    } finally {
      ledger.close()
    }
  })

})
