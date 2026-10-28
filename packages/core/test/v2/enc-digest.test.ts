/**
 * test/v2/enc-digest —— canonical/JCS 与摘要的实现侧复算（VEC-01..08）＋负向组（VEC-09/10）
 *
 * 依据：docs/v2/10 §二（ENC-01..08）、§七（公布测试向量；期望值照录，非本测试自算）、
 *       §八（E-ENC-001/002/003/005 码义）、§2.7（验证门：正向 VEC 集＋负向域外组）；
 *       v2/17 §二.6（规范侧 digest 复算 8/8 的 V0 记录）。
 *
 * 期望值来源（**照录**，不得改）：v2/10 §七 表逐行；VEC-06 的输入与期望规范文本取自
 * v1·76 §1.5.1（同 RFC 8785 §3.2.3 官方键集；U+FB33 必须预组合字符）。测试只用两种
 * 方式得到「实现结果」：canonicalizeJsonText（文本→规范文本）与 semanticDigestOfText
 * （文本→规范字节→SHA-256）。**不自造 digest**：本文件出现的每个十六进制期望值都能在
 * v2/10 §七 找到出处（VEC-07 的两个陷阱值仅作「不得产出」对照）。
 *
 * 零 IO：本文件不 import fs/net/child_process；被断言面是纯函数（同输入恒同输出）。
 */
import { describe, expect, it } from 'vitest'
import {
  CANONICALIZATION_ID,
  CANONICALIZATION_STATUS,
  CANONICALIZATION_VERSION,
  byteDigestOfBytes,
  canonicalizeJson,
  canonicalizeJsonText,
  parseIJson,
  semanticDigestOfJson,
  semanticDigestOfText,
  sha256Hex,
  utf8Bytes,
  validateCanonicalText,
  validateDigestFace,
} from '../../src/jcs.ts'
import { DIAGNOSTIC_CODE_PHASES, isClosedDiagnosticCode, makeDiagnostic } from '../../src/spec.ts'

/** v2/10 §七 公布向量（输入文本／期望规范文本／期望 SHA-256 逐字照录） */
const VECTORS: ReadonlyArray<{
  readonly id: string
  readonly input: string
  readonly canonical: string
  readonly sha256: string
}> = [
  {
    id: 'VEC-01',
    input: '{"b":1,"a":2}',
    canonical: '{"a":2,"b":1}',
    sha256: 'd3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772',
  },
  {
    id: 'VEC-02',
    input: '{"é":1,"":2}',
    canonical: '{"":2,"é":1}',
    sha256: '2e001283ca5ee7b0573774ceb51e9153191dfb1750072e92f5bc9b243616ced0',
  },
  {
    id: 'VEC-03',
    input: '{"decimal":"1.20"}',
    canonical: '{"decimal":"1.20"}',
    sha256: '842666826fb49301a90d4f16027c847a964a351255b451078c0368c16c4e27de',
  },
  {
    id: 'VEC-04',
    input: '{"decimal":"1.2"}',
    canonical: '{"decimal":"1.2"}',
    sha256: '64142ec148cb5956ef7759a096ee2adc15ad9816f3feba6b447d848fd99dc4ec',
  },
  {
    id: 'VEC-05',
    input: '{"nested":{"z":0,"a":[true,null,"x"]}}',
    canonical: '{"nested":{"a":[true,null,"x"],"z":0}}',
    sha256: '1960243bf260a4ab0f405341814cdb64aa4ed147e5904994d87b98200713c29a',
  },
  {
    id: 'VEC-06',
    // RFC 8785 §3.2.3 官方键集（输入带 \uXXXX 转义；期望文本中非 ASCII 原样输出）
    input:
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
    canonical:
      '{"\\r":"Carriage Return","1":"One","\u0080":"Control","\u00f6":"Latin Small Letter O With Diaeresis","\u20ac":"Euro Sign","\u{1f600}":"Emoji: Grinning Face","\ufb33":"Hebrew Letter Dalet With Dagesh"}',
    sha256: '5e321556d22018a9656991a9e94f77ec175fa193e52a2429d312f8419ec8b08c',
  },
  {
    id: 'VEC-07',
    input: '{"s":"a\\"b\\\\c\\u0000\\u0008\\u0009\\u000A\\u000C\\u000D\\u001F"}',
    canonical: '{"s":"a\\"b\\\\c\\u0000\\b\\t\\n\\f\\r\\u001f"}',
    sha256: '742ba263609b3e762a15ebdf623a4d1dc3f8009d5ac2bee6cd9812c53865c973',
  },
  {
    id: 'VEC-08',
    input: '{"zero":0,"max":9007199254740991,"min":-9007199254740991}',
    canonical: '{"max":9007199254740991,"min":-9007199254740991,"zero":0}',
    sha256: 'b7b2401ddca2165824e98c61890c0aaec470258d3119dd265d02be9438bf47e6',
  },
]

/** 诊断码集合（断言封闭集用） */
function codesOf(diagnostics: readonly { readonly code: string }[]): string[] {
  return diagnostics.map((diagnostic) => diagnostic.code)
}

describe('ENC VEC-01..08：canonical 文本与 SHA-256 逐条复算（v2/10 §七）', () => {
  for (const vector of VECTORS) {
    it(`${vector.id} 规范文本逐字一致`, () => {
      const result = canonicalizeJsonText(vector.input)
      expect(result.ok ? result.value : result.diagnostics).toBe(vector.canonical)
    })

    it(`${vector.id} 期望摘要 = semanticDigest(期望规范文本) = 实现摘要(输入)`, () => {
      // 期望摘要的独立验算锚：对「期望规范文本」的 UTF-8 字节直接取 SHA-256
      expect(sha256Hex(utf8Bytes(vector.canonical))).toBe(vector.sha256)
      const digest = semanticDigestOfText(vector.input)
      expect(digest.ok).toBe(true)
      if (!digest.ok) return
      expect(digest.value.value).toBe(vector.sha256)
      expect(digest.value.kind).toBe('semantic')
      expect(digest.value.canonicalizationId).toBe(CANONICALIZATION_ID)
      expect(digest.value.canonicalizationVersion).toBe(CANONICALIZATION_VERSION)
    })
  }

  it('VEC-05 输入字节摘要（byteDigest）与规范字节摘要不同——两种材料不得混用（§2.5）', () => {
    const inputBytes = '{"nested":{"z":0,"a":[true,null,"x"]}}'
    const byteDigest = byteDigestOfBytes(utf8Bytes(inputBytes))
    // 期望字节摘要照录 v2/10 §七 VEC-05 注释
    expect(byteDigest.value).toBe('a96967b6b1a824e869ca1df37635503dac333de7b1bed6f15ba4726a17a89e9b')
    expect(byteDigest.kind).toBe('byte')
    expect(byteDigest.canonicalizationId).toBeUndefined()
    const semantic = semanticDigestOfText(inputBytes)
    expect(semantic.ok && semantic.value.value).toBe('1960243bf260a4ab0f405341814cdb64aa4ed147e5904994d87b98200713c29a')
    expect(byteDigest.value).not.toBe('1960243bf260a4ab0f405341814cdb64aa4ed147e5904994d87b98200713c29a')
  })

  it('VEC-06 结论：UTF-16 码元序（emoji 在 U+FB33 前）＋非 ASCII 原样输出＋U+FB33 预组合', () => {
    const vector = VECTORS.find((entry) => entry.id === 'VEC-06')
    expect(vector).toBeDefined()
    const canonical = vector === undefined ? '' : vector.canonical
    const emoji = canonical.indexOf('\u{1f600}')
    const dalet = canonical.indexOf('\ufb33')
    expect(emoji).toBeGreaterThan(-1)
    expect(dalet).toBeGreaterThan(-1)
    // 码位序下 U+1F600（1F600）> U+FB33（FB33），UTF-16 码元序下 D83D < FB33
    expect(emoji).toBeLessThan(dalet)
    // 非 ASCII 一律原样（不转 \uXXXX），U+FB33 为预组合字符 ef ac b3
    expect(canonical).not.toMatch(/\\u00f6|\\u20ac|\\ud83d|\\ufb33/i)
    expect([...utf8Bytes('\ufb33')]).toEqual([0xef, 0xac, 0xb3])
    expect([...utf8Bytes('\u{1f600}')]).toEqual([0xf0, 0x9f, 0x98, 0x80])
  })

  it('VEC-07 陷阱值：统一转义实现会得到的两个摘要均不得产出（公布为错误对照值）', () => {
    const allLower = 'ffe1bae8c441e18a564f9b3196be0c66f69115bdd898199b536b0f2539eb3edd'
    const allUpper = 'abc35c52ef117e5d56ddd1852811a0c362167ba8c0c62b720ee8fd304bd9c4e9'
    const digest = semanticDigestOfText(VECTORS[6]?.input ?? '')
    expect(digest.ok).toBe(true)
    if (!digest.ok) return
    expect(digest.value.value).not.toBe(allLower)
    expect(digest.value.value).not.toBe(allUpper)
    expect(digest.value.value).toBe('742ba263609b3e762a15ebdf623a4d1dc3f8009d5ac2bee6cd9812c53865c973')
  })

  it('VEC-08 数值域边界：安全整数上下界与零的最短十进制（-0 归一为 0）', () => {
    const canonical = canonicalizeJsonText('{"zero":-0,"max":9007199254740991,"min":-9007199254740991}')
    expect(canonical.ok && canonical.value).toBe('{"max":9007199254740991,"min":-9007199254740991,"zero":0}')
    const unsafe = parseIJson('{"n":9007199254740992}')
    expect(unsafe.ok).toBe(false)
    if (unsafe.ok) return
    expect(codesOf(unsafe.diagnostics)).toEqual(['E-ENC-003'])
  })
})

describe('ENC VEC-09/10 负向组：域外数值与 I-JSON 前置违反逐条拒收', () => {
  const domainExternal = ['1e+30', '4.50', '0.3333333333333', '1E2']
  for (const literal of domainExternal) {
    it(`域外数值字面量 ${literal} → E-ENC-003（typecheck 相位；不得转双精度继续）`, () => {
      const result = parseIJson(`{"v":${literal}}`)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics[0]?.code).toBe('E-ENC-003')
      expect(result.diagnostics[0]?.phase).toBe('typecheck')
    })
  }

  const ijsonViolations: ReadonlyArray<readonly [string, string, string]> = [
    ['重复成员名', '{"a":1,"a":2}', 'E-ENC-002'],
    ['lone surrogate 转义', '{"s":"\\ud800"}', 'E-ENC-002'],
    ['NaN 字面量', '{"v":NaN}', 'E-ENC-002'],
    ['Infinity 字面量', '{"v":Infinity}', 'E-ENC-002'],
    ['BOM 前缀', '\uFEFF{"a":1}', 'E-ENC-002'],
    ['字符串外空白', '{"a": 1}', 'E-ENC-002'],
    ['尾随逗号', '{"a":1,}', 'E-ENC-002'],
    ['注释', '{"a":1}/*x*/', 'E-ENC-002'],
    ['前导零', '{"a":01}', 'E-ENC-002'],
    ['尾随内容', '{"a":1}{"b":2}', 'E-ENC-002'],
  ]
  for (const [label, text, code] of ijsonViolations) {
    it(`${label} → ${code}（parse 相位；不得「后者覆盖前者」后继续）`, () => {
      const result = parseIJson(text)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.diagnostics[0]?.code).toBe(code)
      expect(result.diagnostics[0]?.phase).toBe('parse')
    })
  }

  it('VEC-09 的补面：同一字面量若声明为 decimal 字符串，则按字符串转义、不进数值序列化', () => {
    const result = canonicalizeJsonText('{"decimal":"1e+30"}')
    expect(result.ok && result.value).toBe('{"decimal":"1e+30"}')
    const digest = semanticDigestOfText('{"decimal":"1e+30"}')
    expect(digest.ok).toBe(true)
  })

  it('VEC-10 的值域面：NaN/Infinity 作为 JS 值（非文本）同样拒收', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = canonicalizeJson({ value })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.diagnostics[0]?.code).toBe('E-ENC-002')
    }
    // 函数/undefined/循环引用都不是 JSON 值
    expect(canonicalizeJson({ fn: () => 1 }).ok).toBe(false)
    expect(canonicalizeJson({ missing: undefined }).ok).toBe(false)
    const cyclic: Record<string, unknown> = {}
    cyclic['self'] = cyclic
    expect(canonicalizeJson(cyclic).ok).toBe(false)
  })
})

describe('ENC-08 摘要结构与规范文本形态', () => {
  it('合法 semanticDigest 通过校验；byteDigest 携带规范化身份＝E-ENC-001', () => {
    const digest = semanticDigestOfText('{"a":1}')
    expect(digest.ok).toBe(true)
    if (!digest.ok) return
    expect(validateDigestFace(digest.value)).toEqual([])
    expect(
      codesOf(
        validateDigestFace({
          algorithm: 'sha-256',
          value: digest.value.value,
          kind: 'byte',
          canonicalizationId: CANONICALIZATION_ID,
          canonicalizationVersion: CANONICALIZATION_VERSION,
        }),
      ),
    ).toEqual(['E-ENC-001'])
  })

  it('未知 canonicalizationId/Version 拒收（不得按最近已知版本重算）', () => {
    const unknownId = validateDigestFace({
      algorithm: 'sha-256',
      value: 'a'.repeat(64),
      kind: 'semantic',
      canonicalizationId: 'studio-next/jcs',
      canonicalizationVersion: 1,
    })
    expect(codesOf(unknownId)).toEqual(['E-ENC-001'])
    const unknownVersion = validateDigestFace({
      algorithm: 'sha-256',
      value: 'a'.repeat(64),
      kind: 'semantic',
      canonicalizationId: CANONICALIZATION_ID,
      canonicalizationVersion: 2,
    })
    expect(codesOf(unknownVersion)).toEqual(['E-ENC-001'])
  })

  it('摘要结构缺项/大写十六进制/未知算法均拒收', () => {
    expect(codesOf(validateDigestFace({ algorithm: 'sha-256', value: 'A'.repeat(64), kind: 'semantic', canonicalizationId: CANONICALIZATION_ID, canonicalizationVersion: 1 }))).toEqual(['E-ENC-001'])
    expect(codesOf(validateDigestFace({ algorithm: 'md5', value: 'a'.repeat(64), kind: 'semantic', canonicalizationId: CANONICALIZATION_ID, canonicalizationVersion: 1 }))).toEqual(['E-ENC-001'])
    expect(codesOf(validateDigestFace(null))).toEqual(['E-ENC-001'])
  })

  it('规范文本形态校验：规范文本通过；非规范（键序/空白/大写转义）→ E-ENC-005', () => {
    expect(validateCanonicalText('{"a":2,"b":1}')).toEqual([])
    expect(codesOf(validateCanonicalText('{"b":1,"a":2}'))).toEqual(['E-ENC-005'])
    // 字符串外空白属输入前置违反（VEC-10）→ parse 相位 E-ENC-002；键序/大写转义属形态违规
    expect(codesOf(validateCanonicalText('{"a": 2}'))).toEqual(['E-ENC-002'])
    expect(codesOf(validateCanonicalText('{"s":"\\u000B"}'))).toEqual(['E-ENC-005'])
  })
})

describe('ENC 纯函数面与版本状态（零 IO 断言）', () => {
  it('同输入恒同输出（规范文本与摘要可复算；无时间/随机注入）', () => {
    for (const vector of VECTORS) {
      const first = canonicalizeJsonText(vector.input)
      const second = canonicalizeJsonText(vector.input)
      expect(first).toEqual(second)
      const left = semanticDigestOfText(vector.input)
      const right = semanticDigestOfText(vector.input)
      expect(left).toEqual(right)
    }
    expect(canonicalizeJson({ b: 1, a: [2, 3] })).toEqual(canonicalizeJson({ a: [2, 3], b: 1 }))
  })

  it('sha256Hex 已知答案（UTF-8 与字节双入口一致）', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex(utf8Bytes('abc'))).toBe(sha256Hex('abc'))
    // UTF-8 编码面：'é' = c3 a9（不是 latin-1 单字节）
    expect(sha256Hex('é')).toBe('4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c')
  })

  it('版本状态保持 vectors-published：不得声明 supported（§2.6/§七三点判读①）', () => {
    expect(CANONICALIZATION_STATUS).toBe('vectors-published')
  })

  it('诊断码封闭表（v2/10 §八相位可判 17 码）：未登记码不可造、相位不可跨用', () => {
    expect(Object.keys(DIAGNOSTIC_CODE_PHASES)).toHaveLength(17)
    expect(isClosedDiagnosticCode('E-ENC-002')).toBe(true)
    expect(isClosedDiagnosticCode('E-RULE-010')).toBe(true)
    expect(isClosedDiagnosticCode('E-ENC-006')).toBe(false)
    expect(isClosedDiagnosticCode('E-RULE-011')).toBe(false)
    expect(makeDiagnostic('W-RULE-002', '', 'x').phase).toBe('typecheck')
    expect(makeDiagnostic('E-ENC-003', '', 'x').phase).toBe('typecheck')
  })

  it('模块导出面只含函数与纯数据（无流/句柄/IO 成员）', async () => {
    const module = await import('../../src/jcs.ts')
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === 'function') {
        expect(name).not.toMatch(/^(open|read|write|watch|connect|listen|spawn|exec|fetch)/i)
        continue
      }
      // 非函数导出只允许原始值/数组/普通对象（无 Promise/流/句柄）
      expect(['string', 'number', 'boolean', 'object']).toContain(typeof value)
      expect(value).not.toBeInstanceOf(Promise)
    }
    // 求值面不返回 thenable（纯函数不得异步化以藏 IO）
    const result = semanticDigestOfJson({ a: 1 })
    expect(typeof (result as { then?: unknown }).then).toBe('undefined')
  })
})
