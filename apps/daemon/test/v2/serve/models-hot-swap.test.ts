/**
 * models.yaml 动态模型热切 V2 套件（task-34）
 *
 * 断言面：内容变化+去抖后热切（overlay 重写/价目表/角色路由/adapter 声明回调）；无效 YAML
 * fail-closed 保持旧配置+ESCALATE；apply 失败回滚旧 overlay+ESCALATE；面关（无 models 段）
 * 空转；既有事件词表（SCHEMA_EVOLVE/ESCALATE）复用、无新增事件名。
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { openLedger } from '@studio-next/store'
import { localDateKey } from '@studio-next/core'
import { makeUlid } from '../../../src/engine/tools/id.ts'
import { createModelsHotSwap, type ModelsHotSwapApplyInput } from '../../../src/assembly/serve/models-hot-swap.ts'

const ROOT = mkdtempSync(path.join(tmpdir(), 'sn-hot-swap-'))
afterAll(() => rmSync(ROOT, { recursive: true, force: true }))
let seq = 0
const COMPANY = 'demo-hot'
const DEPT = 'departments/工程部'

const MODELS_A = `
tiers:
  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1111, outputPerM: 0.3889}}
roles: {main_worker: mid, verifier: high, patrol: low}
`
const MODELS_B = MODELS_A
  .replace(/model: GLM-5\.3,/g, 'model: GLM-5.3-NEXT,')
  .replace(/inputPerM: 1\.1111, outputPerM: 3\.8889/g, 'inputPerM: 2.2222, outputPerM: 4.4444')

interface Fixture {
  readonly modelsPath: string
  readonly rootDir: string
  readonly ledger: ReturnType<typeof openLedger>
  readonly applies: ModelsHotSwapApplyInput[]
  readonly events: Array<{ event: string; note: string | null }>
  readonly hot: ReturnType<typeof createModelsHotSwap>
  setNow(n: number): void
  close(): void
}

function fixture(name: string, initial = MODELS_A, applyOverride?: (input: ModelsHotSwapApplyInput) => void): Fixture {
  const dir = path.join(ROOT, name)
  mkdirSync(dir, { recursive: true })
  const modelsPath = path.join(dir, 'models.yaml')
  writeFileSync(modelsPath, initial, 'utf8')
  const rootDir = path.join(dir, 'var')
  const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
  const applies: ModelsHotSwapApplyInput[] = []
  const events: Array<{ event: string; note: string | null }> = []
  let now = 1_000
  const hot = createModelsHotSwap({
    modelsPath,
    rootDir,
    company: COMPANY,
    deptFallback: DEPT,
    ledger,
    clock: () => now,
    makeId: (ts) => makeUlid(ts + ++seq),
    log: () => {},
    apply: (input) => {
      applies.push(input)
      if (applyOverride !== undefined) applyOverride(input)
      events.push({ event: 'SCHEMA_EVOLVE', note: null })
    },
  })
  return {
    modelsPath,
    rootDir,
    ledger,
    applies,
    events,
    hot,
    setNow: (n) => {
      now = n
    },
    close: () => {
      hot.close()
      ledger.close()
    },
  }
}

describe('models 动态热切（task-34）', () => {
  it('内容变化+去抖后应用：价目表/角色路由/overlay 重写/SCHEMA_EVOLVE', async () => {
    const fx = fixture('apply')
    try {
      expect(await fx.hot.check()).toBeNull() // 基线，无变化
      writeFileSync(fx.modelsPath, MODELS_B, 'utf8')
      expect(await fx.hot.check()).toBeNull() // 首见=去抖等待
      fx.setNow(2_000)
      const report = await fx.hot.check()
      expect(report?.kind).toBe('applied')
      expect(fx.applies).toHaveLength(1)
      const input = fx.applies[0] as ModelsHotSwapApplyInput
      expect(input.catalog.tiers().map((t) => `${t.tier}=${t.provider}/${t.model}`)).toEqual(['high=glm/GLM-5.3-NEXT', 'mid=glm/GLM-5.3-NEXT', 'low=glm/GLM-5.3-Flash'])
      expect(input.catalog.tiers().find((t) => t.tier === 'mid')?.price.inputPerM).toBe(2.2222)
      expect(input.modelTierByRole['main_worker']).toBe('mid')
      expect(input.tierModels['dsh']).toBe('glm/GLM-5.3-NEXT')
      expect(input.tierModels['dsh-high']).toBe('glm/GLM-5.3-NEXT')
      // overlay 已重写：worker 下次 spawn 读该文件即新模型
      const midOverlay = path.join(fx.rootDir, 'tmp', 'dsh-tier-mid.yml')
      expect(existsSync(midOverlay)).toBe(true)
      expect(readFileSync(midOverlay, 'utf8')).toContain('model: GLM-5.3-NEXT')
      // 留痕：既有事件词表 SCHEMA_EVOLVE，不新增事件名
      const reload = fx.ledger.queryEvents({ company: COMPANY }).filter((e) => e.event === 'SCHEMA_EVOLVE')
      expect(reload).toHaveLength(1)
      expect(reload[0]?.note).toContain('MODELS_RELOAD;trigger=watch')
      expect(reload[0]?.note).toContain('零进程重启')
      expect(fx.hot.stats.applies).toBe(1)
    } finally {
      fx.close()
    }
  })

  it('非法 YAML → fail-closed：保持旧配置/旧 overlay+ESCALATE，不调用 apply', async () => {
    const fx = fixture('invalid')
    try {
      const oldOverlay = path.join(fx.rootDir, 'tmp', 'dsh-tier-mid.yml')
      // 先合法切一次，建立旧 overlay
      writeFileSync(fx.modelsPath, MODELS_B, 'utf8')
      await fx.hot.check()
      fx.setNow(2_000)
      await fx.hot.check()
      const before = readFileSync(oldOverlay, 'utf8')
      const appliesBefore = fx.applies.length
      // 写坏 YAML（三档缺档）
      writeFileSync(fx.modelsPath, 'tiers:\n  high: {provider: glm, model: GLM-5.3, price: {inputPerM: 1, outputPerM: 2}}\nroles: {main_worker: high}\n', 'utf8')
      await fx.hot.check()
      fx.setNow(3_500)
      const report = await fx.hot.check()
      expect(report?.kind).toBe('invalid')
      expect(fx.applies.length).toBe(appliesBefore) // 不调用 apply
      expect(readFileSync(oldOverlay, 'utf8')).toBe(before) // 旧 overlay 不动
      const esc = fx.ledger.queryEvents({ company: COMPANY }).filter((e) => e.event === 'ESCALATE')
      expect(esc).toHaveLength(1)
      expect(esc[0]?.note).toContain('MODELS_RELOAD_INVALID')
    } finally {
      fx.close()
    }
  })

  it('apply 失败 → 回滚旧 overlay/旧配置+ESCALATE（不半切换）', async () => {
    const fx = fixture('apply-fail', MODELS_A, () => {
      throw new Error('engine apply exploded')
    })
    try {
      // 初始合法（无 overlay）→ apply 抛错也回滚到无文件
      writeFileSync(fx.modelsPath, MODELS_B, 'utf8')
      await fx.hot.check()
      fx.setNow(2_000)
      const report = await fx.hot.check()
      expect(report?.kind).toBe('apply-failed')
      expect(existsSync(path.join(fx.rootDir, 'tmp', 'dsh-tier-mid.yml'))).toBe(false)
      const esc = fx.ledger.queryEvents({ company: COMPANY }).filter((e) => e.event === 'ESCALATE')
      expect(esc).toHaveLength(1)
      expect(esc[0]?.note).toContain('MODELS_RELOAD_APPLY_FAILED')
    } finally {
      fx.close()
    }
  })

  it('面关（无 models 段）：check 空转、零事件；同内容不重复 apply', async () => {
    const dir = path.join(ROOT, 'disabled')
    mkdirSync(dir, { recursive: true })
    const ledger = openLedger(path.join(dir, 'ledger.sqlite'))
    let applies = 0
    const hot = createModelsHotSwap({
      modelsPath: undefined,
      rootDir: path.join(dir, 'var'),
      company: COMPANY,
      deptFallback: DEPT,
      ledger,
      clock: () => 1_000,
      makeId: (ts) => makeUlid(ts + ++seq),
      log: () => {},
      apply: () => {
        applies += 1
      },
    })
    try {
      expect(await hot.check()).toBeNull()
      expect(applies).toBe(0)
      expect(ledger.queryEvents({ company: COMPANY })).toHaveLength(0)
    } finally {
      hot.close()
      ledger.close()
    }
    // 同内容重复 check：不重复 apply
    const fx = fixture('same')
    try {
      writeFileSync(fx.modelsPath, MODELS_B, 'utf8')
      await fx.hot.check()
      fx.setNow(2_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      expect(await fx.hot.check()).toBeNull()
      expect(fx.applies).toHaveLength(1)
    } finally {
      fx.close()
    }
  })
})

// —— task-135 交付④：热切 apply 后对新源即时补种 price snapshot（同启动播种口径，不重启）——
const SOURCES_V1 = `
tiers:
  high:
    sources:
      - id: glm-h
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1111, outputPerM: 0.3889}}
roles: {main_worker: high, patrol: low}
`
const SOURCES_V2 = `
tiers:
  high:
    sources:
      - id: glm-h
        provider: glm
        model: GLM-5.3
        priority: 10
        price: {inputPerM: 1.1111, outputPerM: 3.8889, cacheReadPerM: 0.2778, cacheCreationPerM: 0}
      - id: kimi-h
        provider: opencode-go
        model: kimi-k3.1-pro
        priority: 20
        price: {inputPerM: 2, outputPerM: 10}
  mid: {provider: glm, model: GLM-5.3, price: {inputPerM: 1.1111, outputPerM: 3.8889}}
  low: {provider: glm, model: GLM-5.3-Flash, price: {inputPerM: 0.1111, outputPerM: 0.3889}}
roles: {main_worker: high, patrol: low}
`

describe('models 热切价目补种（task-135）', () => {
  it('apply 后即时补种新源快照；同日重复热切幂等（零重复行）；SCHEMA_EVOLVE note 留痕', async () => {
    const fx = fixture('reseed', SOURCES_V1)
    try {
      const priceDate = localDateKey(1_000)
      const rowsOf = () => fx.ledger.listPriceSnapshots({ company: COMPANY, price_date: priceDate })
      // 首次热切（内容未变不 apply）：先切到 V2 才发生 apply
      writeFileSync(fx.modelsPath, SOURCES_V2, 'utf8')
      await fx.hot.check()
      fx.setNow(2_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      // 新源 kimi-h 即时补种（glm/GLM-5.3、GLM-5.3-Flash 同批；无启动前置=本批全播）
      const seeded = rowsOf()
      expect(seeded.filter((r) => r.provider === 'opencode-go' && r.model === 'kimi-k3.1-pro')).toHaveLength(1)
      expect(seeded.filter((r) => r.source_ticket === `seed-routing:${priceDate}:high:kimi-h`)).toHaveLength(1)
      expect(seeded.length).toBe(3) // glm/GLM-5.3 + GLM-5.3-Flash + kimi（跨档同模型去重）
      const evolve = fx.ledger.queryEvents({ company: COMPANY }).filter((e) => e.event === 'SCHEMA_EVOLVE')
      expect(evolve[evolve.length - 1]?.note).toContain('sourcesSeeded=3')
      // 切回 V1 再切 V2：同日已播 provider/model 幂等跳过（零重复行、零新增）
      writeFileSync(fx.modelsPath, SOURCES_V1, 'utf8')
      await fx.hot.check()
      fx.setNow(3_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      writeFileSync(fx.modelsPath, SOURCES_V2, 'utf8')
      await fx.hot.check()
      fx.setNow(4_000)
      expect((await fx.hot.check())?.kind).toBe('applied')
      const again = rowsOf()
      expect(again.length).toBe(3)
      expect(again.filter((r) => r.provider === 'opencode-go').length).toBe(1)
      const evolve2 = fx.ledger.queryEvents({ company: COMPANY }).filter((e) => e.event === 'SCHEMA_EVOLVE')
      expect(evolve2[evolve2.length - 1]?.note).toContain('sourcesSeeded=0')
    } finally {
      fx.close()
    }
  })
})
