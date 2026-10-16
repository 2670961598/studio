/**
 * models 模型档测试 —— docs/17-§4（models.yaml 冻结形状）/ docs/25-§3.3（ModelCatalog 端口）。
 * 覆盖：解析全形与各坏形（行号断言——LineCounter 回爬是本单质量要求）、
 * 目录 resolve 命中/未登记明报、estimateCost 边界与精度口径（文件头冻结）、fingerprint 稳定性。
 * 语料：packages/core/models.example.yaml（示例配置本体即测试语料，防文档/实现漂移）。
 * IO 只在测试层（读示例文件）；src/models.ts 本体零 IO（core 纪律）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ClassifiedError, ModelTier } from '@studio-next/contract'
import {
  createModelCatalog,
  fingerprint,
  parseModelsYaml,
  type ModelsConfig,
  type ModelsIssue,
} from '../src/models.ts'

const EXAMPLE_YAML = readFileSync(fileURLToPath(new URL('../models.example.yaml', import.meta.url)), 'utf8')

type ModelsError = Error & ClassifiedError & { issues?: ModelsIssue[] }

/** 断言抛 CONFIG_INVALID 并取回错误（含 issues 载荷） */
function expectInvalid(text: string): ModelsError {
  try {
    parseModelsYaml(text)
  } catch (e) {
    const err = e as ModelsError
    expect(err.category).toBe('CONFIG_INVALID')
    return err
  }
  throw new Error('parseModelsYaml 应抛 CONFIG_INVALID 但未抛')
}

// 通用三档（行号断言用基线，行位如下注释；mid/low 用流式风格压行数）
//       1 tiers:
//       2   high:
//       3     provider: zhipu
//       4     model: glm-4.7
//       5     price:
//       6       inputPerM: 0.6
//       7       outputPerM: 2.2
//       8   mid: { provider: zhipu, model: glm-air, price: { inputPerM: 0.2, outputPerM: 0.8 } }
//       9   low: { provider: zhipu, model: glm-flash, price: { inputPerM: 0.05, outputPerM: 0.25 } }
//      10 roles:
//      11   main_worker: high
const VALID = `tiers:
  high:
    provider: zhipu
    model: glm-4.7
    price:
      inputPerM: 0.6
      outputPerM: 2.2
  mid: { provider: zhipu, model: glm-air, price: { inputPerM: 0.2, outputPerM: 0.8 } }
  low: { provider: zhipu, model: glm-flash, price: { inputPerM: 0.05, outputPerM: 0.25 } }
roles:
  main_worker: high
`

describe('parseModelsYaml：合法全形', () => {
  it('基线 fixture 解析通过：三档值与角色映射逐项正确', () => {
    const cfg = parseModelsYaml(VALID)
    expect(cfg.tiers.high).toEqual({ provider: 'zhipu', model: 'glm-4.7', price: { inputPerM: 0.6, outputPerM: 2.2 } })
    expect(cfg.tiers.mid.model).toBe('glm-air')
    expect(cfg.tiers.low.price).toEqual({ inputPerM: 0.05, outputPerM: 0.25 })
    expect(cfg.roles).toEqual({ main_worker: 'high' })
  })

  it('示例配置 models.example.yaml 是合法语料：五角色映射全命中', () => {
    const cfg = parseModelsYaml(EXAMPLE_YAML)
    expect(cfg.roles).toEqual({
      main_worker: 'high', verifier: 'mid', summarizer: 'low', precheck: 'low', patrol: 'low',
    })
  })

  it('价取整数/科学计数法均可（非负有限数）', () => {
    const cfg = parseModelsYaml(`tiers:
  high: { provider: p, model: m1, price: { inputPerM: 0, outputPerM: 3 } }
  mid: { provider: p, model: m2, price: { inputPerM: 1.5e-2, outputPerM: 2e0 } }
  low: { provider: p, model: m3, price: { inputPerM: 1, outputPerM: 0.0001 } }
roles: { main_worker: low }
`)
    expect(cfg.tiers.high.price.inputPerM).toBe(0)
    expect(cfg.tiers.mid.price.inputPerM).toBe(0.015)
    expect(cfg.tiers.low.price.outputPerM).toBe(0.0001)
  })
})

describe('parseModelsYaml：坏形明报（行号断言）', () => {
  it('yaml 语法错误：subcause=models/yaml-syntax 且带行号（坏缩进在第 7 行）', () => {
    const err = expectInvalid(`tiers:
  high:
    provider: zhipu
    model: glm-4.7
    price: { inputPerM: 0.6, outputPerM: 2.2 }
  mid: { provider: zhipu, model: glm-air, price: { inputPerM: 0.2, outputPerM: 0.8 } }
   low: { provider: zhipu, model: glm-flash, price: { inputPerM: 0.05, outputPerM: 0.25 } }
roles:
  main_worker: high
`)
    expect(err.subcause).toBe('models/yaml-syntax')
    const issues = err.issues ?? []
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]?.line).toBe(7) // 「 low」3→1 空格缩进错位行
    expect(err.detail).toContain('models.yaml:7')
  })

  it('缺档（tiers 缺 low）：行号回爬到 tiers 块首项（map 节点 range 起于第一个键值对）', () => {
    const err = expectInvalid(`tiers:
  high: { provider: p, model: m1, price: { inputPerM: 1, outputPerM: 1 } }
  mid: { provider: p, model: m2, price: { inputPerM: 1, outputPerM: 1 } }
roles:
  main_worker: high
`)
    expect(err.subcause).toBe('models/schema')
    expect(err.issues?.[0]?.line).toBe(2) // low 节点不存在，上爬到 tiers map 首项（high 行）
    expect(err.issues?.[0]?.rule).toContain('tiers')
  })

  it('坏价（负数）：行号精确到该键所在行（第 6 行 inputPerM=-0.6）', () => {
    const err = expectInvalid(VALID.replace('      inputPerM: 0.6', '      inputPerM: -0.6'))
    const issue = err.issues?.find(i => i.rule.includes('inputPerM'))
    expect(issue?.line).toBe(6)
    expect(issue?.rule).toBe('models/schema:tiers.high.price.inputPerM')
  })

  it('坏价（非数）：字符串价行号断言（第 7 行 outputPerM）', () => {
    const err = expectInvalid(VALID.replace('      outputPerM: 2.2', '      outputPerM: "贵"'))
    const issue = err.issues?.find(i => i.rule.includes('outputPerM'))
    expect(issue?.line).toBe(7)
  })

  it('坏价（.inf 非有限数）：yaml 解析 Infinity、zod 拒（第 9 行流式 low 档）', () => {
    const err = expectInvalid(VALID.replace('inputPerM: 0.05', 'inputPerM: .inf'))
    const issue = err.issues?.find(i => i.rule.includes('low.price.inputPerM'))
    expect(issue?.line).toBe(9)
  })

  it('坏价（.nan）：NaN 同拒', () => {
    const err = expectInvalid(VALID.replace('outputPerM: 0.25', 'outputPerM: .nan'))
    expect(err.issues?.some(i => i.rule.includes('low.price.outputPerM'))).toBe(true)
  })

  it('provider 空串拒（第 3 行）', () => {
    const err = expectInvalid(VALID.replace('    provider: zhipu\n    model: glm-4.7', '    provider: ""\n    model: glm-4.7'))
    const issue = err.issues?.find(i => i.rule.includes('high.provider'))
    expect(issue?.line).toBe(3)
  })

  it('model 空串拒（第 4 行）', () => {
    const err = expectInvalid(VALID.replace('    model: glm-4.7', "    model: ''"))
    const issue = err.issues?.find(i => i.rule.includes('high.model'))
    expect(issue?.line).toBe(4)
  })

  it('未知顶层键拒（strict）：行号到该键行（第 12 行 gateway）', () => {
    const err = expectInvalid(`${VALID}gateway: wkey-only
`)
    expect(err.subcause).toBe('models/schema')
    const issue = err.issues?.find(i => i.rule === 'models/unknown-key:gateway')
    expect(issue?.line).toBe(12) // VALID 共 11 行，追加大键在第 12 行
    expect(issue?.fix).toContain('gateway')
  })

  it('tiers 多余档拒（tiers.ultra 未知键，行号到该行）', () => {
    const err = expectInvalid(`tiers:
  high: { provider: p, model: m1, price: { inputPerM: 1, outputPerM: 1 } }
  mid: { provider: p, model: m2, price: { inputPerM: 1, outputPerM: 1 } }
  low: { provider: p, model: m3, price: { inputPerM: 1, outputPerM: 1 } }
  ultra: { provider: p, model: m4, price: { inputPerM: 1, outputPerM: 1 } }
roles:
  main_worker: high
`)
    const issue = err.issues?.find(i => i.rule === 'models/unknown-key:tiers.ultra')
    expect(issue?.line).toBe(5)
  })

  it('price 内未知键拒（cachedPerM 走批示，行号到该行）', () => {
    const err = expectInvalid(VALID.replace('      inputPerM: 0.6', '      inputPerM: 0.6\n      cachedPerM: 0.02'))
    const issue = err.issues?.find(i => i.rule === 'models/unknown-key:tiers.high.price.cachedPerM')
    expect(issue?.line).toBe(7) // 插行后 cachedPerM 在第 7 行
  })

  it('tiers 层未知键拒（tiers.region，行号到该行）', () => {
    const err = expectInvalid(VALID.replace('  mid:', '  region: cn\n  mid:'))
    const issue = err.issues?.find(i => i.rule === 'models/unknown-key:tiers.region')
    expect(issue?.line).toBe(8) // 插在 mid 前：region 行成为第 8 行
  })

  it('roles 缺 main_worker 拒：行号到 roles 块首项（第 11 行）', () => {
    const err = expectInvalid(VALID.replace('  main_worker: high', '  verifier: mid'))
    expect(err.subcause).toBe('models/schema')
    expect(err.issues?.[0]?.rule).toBe('models/missing-main-worker')
    expect(err.issues?.[0]?.line).toBe(11) // roles map 首项行（verifier），非 roles: 键行
  })

  it('roles 空表同样拒（zod record 放行空表，交叉规则收口）', () => {
    const err = expectInvalid(`tiers:
  high: { provider: p, model: m1, price: { inputPerM: 1, outputPerM: 1 } }
  mid: { provider: p, model: m2, price: { inputPerM: 1, outputPerM: 1 } }
  low: { provider: p, model: m3, price: { inputPerM: 1, outputPerM: 1 } }
roles: {}
`)
    expect(err.issues?.[0]?.rule).toBe('models/missing-main-worker')
    expect(err.issues?.[0]?.line).toBe(5)
  })

  it('坏角色值（main_worker: premium 不属三档）：行号到该行（第 11 行）', () => {
    const err = expectInvalid(VALID.replace('  main_worker: high', '  main_worker: premium'))
    const issue = err.issues?.find(i => i.rule.includes('roles.main_worker'))
    expect(issue?.line).toBe(11)
  })

  it('角色键空串拒', () => {
    const err = expectInvalid(`tiers:
  high: { provider: p, model: m1, price: { inputPerM: 1, outputPerM: 1 } }
  mid: { provider: p, model: m2, price: { inputPerM: 1, outputPerM: 1 } }
  low: { provider: p, model: m3, price: { inputPerM: 1, outputPerM: 1 } }
roles:
  "": high
`)
    expect(err.issues?.some(i => i.rule.includes('roles'))).toBe(true)
  })

  it('空文档拒（root 形状错，行号兜底 1）', () => {
    const err = expectInvalid('')
    expect(err.subcause).toBe('models/schema')
    expect(err.issues?.[0]?.line).toBe(1)
  })
})

describe('createModelCatalog：目录与角色解析', () => {
  const cfg = parseModelsYaml(EXAMPLE_YAML)
  const catalog = createModelCatalog(cfg)

  it('tiers() 返回恰三档且顺序 high/mid/low（17-§4 冻结）', () => {
    const tiers = catalog.tiers()
    expect(tiers.map(t => t.tier)).toEqual(['high', 'mid', 'low'])
    expect(tiers.map(t => t.model)).toEqual(['glm-4.7', 'glm-4.7-air', 'glm-4.7-flash'])
  })

  it('resolve 命中：五角色各取对应档（provider/model/price 逐项传递）', () => {
    expect(catalog.resolve('main_worker')).toMatchObject({ tier: 'high', model: 'glm-4.7' })
    expect(catalog.resolve('verifier')).toMatchObject({ tier: 'mid', model: 'glm-4.7-air' })
    expect(catalog.resolve('summarizer')).toMatchObject({ tier: 'low', model: 'glm-4.7-flash' })
    expect(catalog.resolve('precheck').tier).toBe('low')
    expect(catalog.resolve('patrol').tier).toBe('low')
  })

  it('resolve 完整形状：ModelTier 四字段（tier/provider/model/price）', () => {
    const t: ModelTier = catalog.resolve('main_worker')
    expect(t).toEqual({
      tier: 'high', provider: 'zhipu', model: 'glm-4.7',
      price: { inputPerM: 0.6, outputPerM: 2.2 },
    })
  })

  it('resolve 未登记角色：CONFIG_INVALID 明报 + 最近似角色提示（main_work→main_worker）', () => {
    try {
      catalog.resolve('main_work')
      throw new Error('应抛未抛')
    } catch (e) {
      const err = e as ModelsError
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe('models/role-unregistered')
      expect(err.message).toContain('main_work')
      expect(err.message).toContain('最近似角色：main_worker')
    }
  })

  it('拼写近似均给最近似（verifer→verifier，distance=1）', () => {
    try {
      catalog.resolve('verifer')
      throw new Error('应抛未抛')
    } catch (e) {
      expect((e as ModelsError).message).toContain('最近似角色：verifier')
    }
  })

  it('完全陌生的角色也提示最近似（确定性，并列取字典序最小）', () => {
    try {
      catalog.resolve('zzz')
      throw new Error('应抛未抛')
    } catch (e) {
      const err = e as ModelsError
      expect(err.message).toMatch(/最近似角色：\S+/)
      expect(err.message).toContain('已登记：') // 附全量已登记角色，修配置不靠猜
    }
  })

  it('tiers()/resolve() 返回副本：外部改不动目录内部', () => {
    catalog.tiers()[0]!.price.inputPerM = 999
    const resolved = catalog.resolve('main_worker')
    resolved.price.inputPerM = 888
    expect(catalog.tiers()[0]!.price.inputPerM).toBe(0.6)
    expect(catalog.resolve('main_worker').price.inputPerM).toBe(0.6)
  })
})

describe('estimateCost：边界与精度口径（文件头冻结：双精度直算不凑整）', () => {
  const catalog = createModelCatalog(parseModelsYaml(EXAMPLE_YAML))

  it('零 token → usd=0', () => {
    expect(catalog.estimateCost({ input: 0, output: 0 }, 'high')).toEqual({ usd: 0 })
  })

  it('整百万数：input 1M×0.6 + output 0.5M×2.2（公式序冻结：input/1e6*p+output/1e6*p）', () => {
    const cost = catalog.estimateCost({ input: 1_000_000, output: 500_000 }, 'high')
    expect(cost.usd).toBe((1_000_000 / 1e6) * 0.6 + (500_000 / 1e6) * 2.2)
    expect(cost.usd).toBeCloseTo(1.7, 10)
  })

  it('非整除样例（333_333/111_111）与手算公式逐位一致', () => {
    const cost = catalog.estimateCost({ input: 333_333, output: 111_111 }, 'low')
    expect(cost.usd).toBe((333_333 / 1e6) * 0.05 + (111_111 / 1e6) * 0.25)
    expect(cost.usd).toBeCloseTo(0.01666665 + 0.02777775, 12)
  })

  it('大数不溢出：input 2.5B + output 1B（mid 档）→ 1300', () => {
    const cost = catalog.estimateCost({ input: 2_500_000_000, output: 1_000_000_000 }, 'mid')
    expect(Number.isFinite(cost.usd)).toBe(true)
    expect(cost.usd).toBeCloseTo(500 + 800, 6)
  })

  it('cached 桶不计价（端口无 cachedPerM 键，扩键走批示——文件头裁定）', () => {
    const cost = catalog.estimateCost({ input: 1_000_000, output: 0, cached: 5_000_000 }, 'high')
    expect(cost.usd).toBe(0.6)
  })

  it('未知档：CONFIG_INVALID 明报（models/tier-unknown）', () => {
    try {
      catalog.estimateCost({ input: 1, output: 1 }, 'premium' as ModelTier['tier'])
      throw new Error('应抛未抛')
    } catch (e) {
      const err = e as ModelsError
      expect(err.category).toBe('CONFIG_INVALID')
      expect(err.subcause).toBe('models/tier-unknown')
    }
  })
})

describe('fingerprint：内容指纹（价目表变更防护锚点）', () => {
  const cfg = parseModelsYaml(EXAMPLE_YAML)

  it('形状：sha8=小写十六进制 8 位', () => {
    expect(fingerprint(cfg)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('同内容同指纹：同 config 双算、同文本重解析', () => {
    expect(fingerprint(cfg)).toBe(fingerprint(cfg))
    expect(fingerprint(cfg)).toBe(fingerprint(parseModelsYaml(EXAMPLE_YAML)))
  })

  it('键序无关：roles/tiers 键排列不同 → 同指纹（语义内容指纹）', () => {
    const reordered: ModelsConfig = {
      tiers: { low: cfg.tiers.low, high: cfg.tiers.high, mid: cfg.tiers.mid },
      roles: { patrol: 'low', main_worker: 'high', verifier: 'mid', summarizer: 'low', precheck: 'low' },
    }
    expect(fingerprint(reordered)).toBe(fingerprint(cfg))
  })

  it('格式无关：紧凑/展开两种 yaml 文本（同语义）→ 同指纹', () => {
    const compact = parseModelsYaml(`tiers:
  high: { provider: zhipu, model: glm-4.7, price: { inputPerM: 0.6, outputPerM: 2.2 } }
  mid: { provider: zhipu, model: glm-4.7-air, price: { inputPerM: 0.2, outputPerM: 0.8 } }
  low: { provider: zhipu, model: glm-4.7-flash, price: { inputPerM: 0.05, outputPerM: 0.25 } }
roles: { main_worker: high, verifier: mid, summarizer: low, precheck: low, patrol: low }
`)
    expect(fingerprint(compact)).toBe(fingerprint(cfg))
  })

  it('改价变指纹（high.inputPerM 0.6→0.7）', () => {
    const changed: ModelsConfig = {
      tiers: { ...cfg.tiers, high: { ...cfg.tiers.high, price: { ...cfg.tiers.high.price, inputPerM: 0.7 } } },
      roles: cfg.roles,
    }
    expect(fingerprint(changed)).not.toBe(fingerprint(cfg))
  })

  it('改角色映射变指纹（main_worker: high→mid）', () => {
    const changed: ModelsConfig = { tiers: cfg.tiers, roles: { ...cfg.roles, main_worker: 'mid' } }
    expect(fingerprint(changed)).not.toBe(fingerprint(cfg))
  })

  it('换模型名变指纹（换模型=改一行，留锚点）', () => {
    const changed: ModelsConfig = {
      tiers: { ...cfg.tiers, low: { ...cfg.tiers.low, model: 'glm-4.7-airx' } },
      roles: cfg.roles,
    }
    expect(fingerprint(changed)).not.toBe(fingerprint(cfg))
  })
})
