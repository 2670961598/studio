/**
 * pricing-yaml-limits —— NEG-ENG-02（YAML bomb 防线）实现侧负测＋正例
 *
 * 依据（实现单必引章节号——AGENTS §五.1）：
 *   - docs/v2/13 §2.3 DEP-YAML「别名/锚点与规模上限须自建（YAML bomb 负测归 v2/17）」；
 *   - docs/v2/13 §八-5 未证项「YAML bomb 防线：别名/深度/规模上限负测」；
 *   - docs/v2/17 §4.4 NEG-ENG-02「别名/深度/规模超限包 → 上限负测拒收（V1）」。
 *
 * 断言面＝**生产入口** `parsePricingTable`（core 定价附件解析），不是测试自带计数器：
 *   ① 正例：正常规模小 YAML 照常通过（上限闸不误杀正常附件）；
 *   ② 别名**展开** bomb（源文 ~200 字符、4 层×4 分支＝4^5 次展开）：在 `toJS` 展开前被拒
 *      ——本用例能跑完即证明实现没有真的展开（真展开是指数级耗时/内存）；
 *   ③ 别名节点数上限独立生效（65 个别名分指 3 个标量锚：库的展开计数不超、AST 计数超）；
 *   ④ 深层嵌套（40 层流式映射）→ 深度上限；
 *   ⑤ 规模双限：AST 节点数（10001 项序列）与源文本字符数（1,000,001）；
 *   ⑥ 未解析别名：`toJS` 的 ReferenceError 归语法错（不裸奔出解析入口）；
 *   ⑦ 拒绝码逐字：`CONFIG_INVALID` + subcause `pricing/yaml-limit`（+`:<kind>` 规则后缀），
 *      且**抛错而非返回半表**——不截断、不静默降级。
 *
 * 上限值来源：`packages/core/src/yaml.ts` 冻结常量 YAML_LIMITS（本文件只引用，不重述数字
 * 以外的判据；数字用于断言「拒收文案里给出实测/上限」两值）。
 */
import { describe, expect, it } from 'vitest'
import { parsePricingTable } from '../../src/pricing.ts'
import { YAML_LIMITS } from '../../src/yaml.ts'

/** 拒绝面（failPricing 产物的结构化载荷；只读断言） */
interface PricingRefusal {
  readonly message: string
  readonly category?: string | undefined
  readonly subcause?: string | undefined
  readonly detail?: string | undefined
  readonly issues?: ReadonlyArray<{ readonly line: number; readonly rule: string; readonly fix: string }> | undefined
}

/** 取生产入口的拒绝（未拒＝测试自身判负：不写「永远绿」的假负例） */
function refusalOf(text: string): PricingRefusal {
  try {
    parsePricingTable(text)
  } catch (err) {
    const failure = err as Error & {
      category?: string
      subcause?: string
      detail?: string
      issues?: Array<{ line: number; rule: string; fix: string }>
    }
    return {
      message: failure.message,
      category: failure.category,
      subcause: failure.subcause,
      detail: failure.detail,
      issues: failure.issues,
    }
  }
  throw new Error('预期 CONFIG_INVALID 上限拒收，实际解析通过——上限闸未生效（NEG-ENG-02 判负）')
}

/** 全部上限拒的共同断言：CONFIG_INVALID + pricing/yaml-limit + 指定 kind + 非空行号/修法 */
function expectLimitRefusal(text: string, kind: string): PricingRefusal {
  const refusal = refusalOf(text)
  expect(refusal.category).toBe('CONFIG_INVALID')
  expect(refusal.subcause).toBe('pricing/yaml-limit')
  expect(refusal.message.startsWith('CONFIG_INVALID/pricing/yaml-limit：')).toBe(true)
  const issue = refusal.issues?.[0]
  expect(issue?.rule).toBe(`pricing/yaml-limit:${kind}`)
  expect(issue?.line).toBeGreaterThanOrEqual(1)
  expect(issue?.fix).toContain('NEG-ENG-02')
  expect(refusal.detail).toContain(issue?.rule ?? '(缺 rule)')
  return refusal
}

/** 正例表（正常附件规模；两档价一条模型） */
const TABLE_YAML = `# 定价更新单附件（正常规模正例）
priceDate: '2026-10-23'
sourceNote: 上限闸正例（正常附件规模）
models:
  - provider: deepseek
    model: deepseek-flash
    billingTrack: api
    prices:
      - slot: peak
        inputPerM: 0.3
        outputPerM: 1.2
        cacheReadPerM: 0.006
      - slot: offpeak
        inputPerM: 0.15
        outputPerM: 0.6
`

/**
 * 别名展开 bomb（billion-laughs 同型）：l0=4 标量锚，其后每层 4 个别名引上一层。
 * 展开量 4^5＝1024 ≫ maxAliasCount；源文 5 行（小规模构造，不是「大文件」）。
 */
function aliasExpansionBomb(levels = 5, fan = 4): string {
  const lines: string[] = [`l0: &l0 [${Array<string>(fan).fill('"x"').join(',')}]`]
  for (let i = 1; i <= levels; i += 1) {
    lines.push(`l${i}: &l${i} [${Array<string>(fan).fill(`*l${i - 1}`).join(',')}]`)
  }
  return `${lines.join('\n')}\n`
}

/** 深层嵌套（流式映射 depth 层）：40 层远小于 yaml 解析栈极限，但超本仓深度上限 */
function deepNesting(depth: number): string {
  let inner = '1'
  for (let i = 0; i < depth; i += 1) inner = `{k: ${inner}}`
  return `root: ${inner}\n`
}

/** 别名节点数（个数）超限：分指 3 个标量锚——库的「展开计数」不超，只有 AST 计数超 */
function aliasNodeBomb(count: number): string {
  const refs = Array.from({ length: count }, (_, i) => `*a${i % 3}`)
  return `a0: &a0 "x"\na1: &a1 "y"\na2: &a2 "z"\nlist: [${refs.join(',')}]\n`
}

describe('NEG-ENG-02 · parsePricingTable 上限闸', () => {
  it('正例：正常规模小 YAML 通过（上限闸不误杀定价附件）', () => {
    const table = parsePricingTable(TABLE_YAML)
    expect(table.priceDate).toBe('2026-10-23')
    expect(table.models).toHaveLength(1)
    expect(table.models[0]?.prices.map((p) => p.slot)).toEqual(['peak', 'offpeak'])
  })

  it('别名展开 bomb（4^5 次展开）：toJS 前拒收，码=alias', () => {
    const bomb = aliasExpansionBomb()
    // 先钉构造规模：源文确实「小」——不是拿巨型输入冒充上限负测
    expect(bomb.length).toBeLessThan(1024)
    const refusal = expectLimitRefusal(bomb, 'alias')
    expect(refusal.message).toContain('别名展开计数')
    expect(refusal.message).toContain(`上限 ${YAML_LIMITS.maxAliasCount}`)
  })

  it('别名节点数超限（65 个分指 3 锚）：码=alias 且文案给实测值', () => {
    const refusal = expectLimitRefusal(aliasNodeBomb(YAML_LIMITS.maxAliasCount + 1), 'alias')
    expect(refusal.message).toContain(`别名节点数 ${YAML_LIMITS.maxAliasCount + 1}`)
    expect(refusal.message).toContain(`上限 ${YAML_LIMITS.maxAliasCount}`)
  })

  it('深层嵌套（40 层流式映射）：码=depth，行号指向违规节点', () => {
    const refusal = expectLimitRefusal(deepNesting(40), 'depth')
    expect(refusal.message).toContain('嵌套深度')
    expect(refusal.message).toContain(`上限 ${YAML_LIMITS.maxDepth}`)
  })

  it('规模：AST 节点数超限（10001 项序列）：码=nodes', () => {
    const refusal = expectLimitRefusal(`- 1\n`.repeat(YAML_LIMITS.maxNodes + 1), 'nodes')
    expect(refusal.message).toContain('AST 节点数')
    expect(refusal.message).toContain(`上限 ${YAML_LIMITS.maxNodes}`)
  })

  it('规模：源文本字符数超限（parse 前拒）：码=source-chars', () => {
    const refusal = expectLimitRefusal('x'.repeat(YAML_LIMITS.maxSourceChars + 1), 'source-chars')
    expect(refusal.message).toContain(`字符 > 上限 ${YAML_LIMITS.maxSourceChars}`)
    expect(refusal.message).toContain(String(YAML_LIMITS.maxSourceChars + 1))
  })

  it('未解析别名：toJS 的 ReferenceError 归语法错（不裸奔、不放行）', () => {
    const refusal = refusalOf("priceDate: '2026-10-23'\nsourceNote: s\nmodels: *nope\n")
    expect(refusal.category).toBe('CONFIG_INVALID')
    expect(refusal.subcause).toBe('pricing/yaml-syntax')
    expect(refusal.message).toContain('Unresolved alias')
  })
})
