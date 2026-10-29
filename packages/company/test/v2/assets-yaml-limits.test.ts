/**
 * assets-yaml-limits —— NEG-ENG-02（YAML bomb 防线）company 解析入口负测＋正例
 *
 * 依据（实现单必引章节号——AGENTS §五.1）：
 *   - docs/v2/13 §2.3 DEP-YAML「别名/锚点与规模上限须自建（YAML bomb 负测归 v2/17）」；
 *   - docs/v2/13 §八-5 未证项「YAML bomb 防线：别名/深度/规模上限负测」；
 *   - docs/v2/17 §4.4 NEG-ENG-02「别名/深度/规模超限包 → 上限负测拒收（V1）」；
 *   - docs/v2/06 §3.2/§4.1（assets.yaml=资产部唯一索引）、v2/10 §4.4（SCH-ASSET-01 字段）。
 *
 * 断言面＝**生产入口** `parseAssetManifest`（company 资产清单解析；defpkg/loader 亦经此），
 * 覆盖：正例小清单通过（含 W-SCH-002 缺省警示）、别名展开 bomb、别名节点数、深层嵌套、
 * AST 节点数、源文本字符数五类上限（码=`assets/yaml-limit`），以及未解析别名/语法错的
 * 既有错误通道不被上限闸改写（不裸奔 ReferenceError）。
 *
 * company 侧上限小件是本地复制件（company ⇸ core 无冻结包间边），本测试即钉死其数值口径
 * 与 core 侧一致：四类上限（1e6 字符 / 1e4 节点 / 32 层 / 64 别名）逐条实测。
 */
import { describe, expect, it } from 'vitest'
import { parseAssetManifest } from '../../src/assets/registry.ts'

/** 拒绝面（configInvalid 产物：message + 分类字段；company 侧无 issues 载荷） */
interface AssetRefusal {
  readonly message: string
  readonly category?: string | undefined
  readonly subcause?: string | undefined
  readonly detail?: string | undefined
}

/** 取生产入口的拒绝（未拒＝测试自身判负：不留「永远绿」的假负例） */
function refusalOf(src: string): AssetRefusal {
  try {
    parseAssetManifest(src)
  } catch (err) {
    const failure = err as Error & { category?: string; subcause?: string; detail?: string }
    return { message: failure.message, category: failure.category, subcause: failure.subcause, detail: failure.detail }
  }
  throw new Error('预期 CONFIG_INVALID 拒收，实际解析通过——上限闸未生效（NEG-ENG-02 判负）')
}

/** 上限拒共同断言：CONFIG_INVALID + assets/yaml-limit + 文案含指定上限字样 */
function expectLimitRefusal(src: string, phrase: string): AssetRefusal {
  const refusal = refusalOf(src)
  expect(refusal.category).toBe('CONFIG_INVALID')
  expect(refusal.subcause).toBe('assets/yaml-limit')
  expect(refusal.message.startsWith('CONFIG_INVALID/assets/yaml-limit：')).toBe(true)
  expect(refusal.message).toContain(phrase)
  expect(refusal.message).toContain('NEG-ENG-02')
  return refusal
}

/** 正例清单（SCH-ASSET-01 最小合法形；binding 省略→W-SCH-002 警示路径） */
const MANIFEST_YAML = `schema: studio-next/assets@1
assets:
  - assetId: demo.one
    type: plugin
    contentDigest:
      algorithm: sha-256
      value: ${'a'.repeat(64)}
      kind: byte
    provenance:
      publisher: studio-next.test
    requiredness:
      required: false
      impactNote: 缺失可运行
    availability:
      need: optional
      impact: 夹具影响说明
`

/** 别名展开 bomb（billion-laughs 同型，5 层 × 4 分支＝4^5 次展开；源文 6 行） */
function aliasExpansionBomb(levels = 5, fan = 4): string {
  const lines: string[] = [`l0: &l0 [${Array<string>(fan).fill('"x"').join(',')}]`]
  for (let i = 1; i <= levels; i += 1) {
    lines.push(`l${i}: &l${i} [${Array<string>(fan).fill(`*l${i - 1}`).join(',')}]`)
  }
  return `${lines.join('\n')}\n`
}

/** 深层嵌套（流式映射；40 层远小于 yaml 解析栈极限，但超本仓 32 层上限） */
function deepNesting(depth: number): string {
  let inner = '1'
  for (let i = 0; i < depth; i += 1) inner = `{k: ${inner}}`
  return `root: ${inner}\n`
}

/** 别名节点数超限（65 个分指 3 个标量锚——库展开计数不超，只有 AST 计数超） */
function aliasNodeBomb(count: number): string {
  const refs = Array.from({ length: count }, (_, i) => `*a${i % 3}`)
  return `a0: &a0 "x"\na1: &a1 "y"\na2: &a2 "z"\nlist: [${refs.join(',')}]\n`
}

describe('NEG-ENG-02 · parseAssetManifest 上限闸', () => {
  it('正例：正常规模小清单通过（缺 binding 走 W-SCH-002，不被上限闸误杀）', () => {
    const parsed = parseAssetManifest(MANIFEST_YAML)
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toMatchObject({ assetId: 'demo.one', type: 'plugin', binding: 'generic' })
    expect(parsed.warnings.map((w) => w.code)).toEqual(['W-SCH-002'])
  })

  it('别名展开 bomb（4^5 次展开）：toJS 前拒收（码=assets/yaml-limit）', () => {
    const bomb = aliasExpansionBomb()
    expect(bomb.length).toBeLessThan(1024) // 小规模构造：不是拿巨型输入冒充上限负测
    expectLimitRefusal(bomb, '别名展开计数')
  })

  it('别名节点数超限（65 个分指 3 锚）：码=assets/yaml-limit 且文案给实测值', () => {
    expectLimitRefusal(aliasNodeBomb(65), '别名节点数 65 > 上限 64')
  })

  it('深层嵌套（40 层）：码=assets/yaml-limit（深度上限）', () => {
    expectLimitRefusal(deepNesting(40), '嵌套深度')
  })

  it('规模：AST 节点数超限（10001 项序列）：码=assets/yaml-limit', () => {
    expectLimitRefusal('- 1\n'.repeat(10_001), 'AST 节点数')
  })

  it('规模：源文本字符数超限（parse 前拒）：码=assets/yaml-limit', () => {
    const refusal = expectLimitRefusal('x'.repeat(1_000_001), '字符 > 上限 1000000')
    expect(refusal.message).toContain('1000001')
  })

  it('既有通道不被改写：未解析别名→assets/manifest-invalid（不裸奔 ReferenceError）', () => {
    const refusal = refusalOf('schema: studio-next/assets@1\nassets: *nope\n')
    expect(refusal.category).toBe('CONFIG_INVALID')
    expect(refusal.subcause).toBe('assets/manifest-invalid')
    expect(refusal.message).toContain('Unresolved alias')
  })

  it('既有通道不被改写：YAML 语法坏→assets/manifest-invalid（行号由库文案带出）', () => {
    const refusal = refusalOf(`schema: studio-next/assets@1\nassets: [\n`)
    expect(refusal.category).toBe('CONFIG_INVALID')
    expect(refusal.subcause).toBe('assets/manifest-invalid')
    expect(refusal.message).toContain('YAML 语法错误')
  })
})
