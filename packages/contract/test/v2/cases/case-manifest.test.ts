/**
 * case-manifest.test.ts —— cases.json 契约清单的 V1 机械门（MIG-03 / IMPL-03-06）
 *
 * 交付面（plan/05 IMPL-03-06；plan/04 §1.2 契约先行法）：
 *   1. 清单结构：schema / id 唯一 / expected 恰一 / 新五域 docs 以 `v2/` 开头；
 *   2. 新五域条数与 NEG 前缀条数 ≥ 首批目标（title `NEG-<族>-<序号>｜` 机械映射）；
 *   3. rec / sch / port 用**本地 subject** 跑可执行子集（rec=ALL_RECORD_SCHEMAS；sch=标量 schema＋记录
 *      schema；port=端口常量/映射）——全绿 + 正例对照（防「恒拒」）+ 反证（改坏期望必红）；
 *   4. enc / rule **不 import core**（依赖方向：实现包 → 契约包），只做结构/期望形态断言；执行侧证据归
 *      core 的 V2 测试（enc-digest.test.ts／rule-engine*.test.ts，IMPL-03-07）。
 *
 * 依据链：plan/05 IMPL-03-06｜plan/04 §1.2/§三（NEG-119：SCH10/RULE10/ENC2 契约 case 腿）
 *   ｜v2/10 §一（SCH-SYN-01 标量族）§四（纯配置 schema）§六（RULE-01..08）§七（VEC-01..10）
 *     §八（E-ENC/E-SCH/E-RULE/W-RULE 封闭码）§九（强制失败出口）
 *   ｜v2/11 §〇.2/§〇.5＋§2.2/§3.2/§四/§5.1/§六..§十一（各族字段与拒绝条件）
 *   ｜v2/14 §二（端口-文件映射单点表 F5）｜v2/17 §四（NEG-ENC/SCH/RULE/REC 的 V1 腿）
 *
 * 纪律：下方 VEC 表与码表是 v2/10 §七/§八 的**照录**（独立副本，与 core 测试互为对照而非同源）；
 *   不新增生产代码、不碰 records/ports 源件、不改旧测试；subject 只在文件内接线。
 */
import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'

import cases from '../../../cases.json' with { type: 'json' }
import { CaseManifestSchema, runCases, type SubjectFn } from '../../../src/index.ts'
import { configInvalid } from '../../../src/schemas/errors.ts'
import { DotIdSchema, RecordTypeIdSchema, SemverSchema, TimestampSchema, TokenSchema } from '../../../src/records/envelope.ts'
import { ALL_RECORD_SCHEMAS } from '../../../src/records/index.ts'
import { PORT_VERSION } from '../../../src/ports/index.ts'
import * as authPort from '../../../src/ports/auth.ts'
import * as defPort from '../../../src/ports/def.ts'
import * as evdPort from '../../../src/ports/evd.ts'
import * as execPort from '../../../src/ports/exec.ts'
import * as gatePort from '../../../src/ports/gate.ts'
import * as histPort from '../../../src/ports/hist.ts'
import * as hrPort from '../../../src/ports/hr.ts'
import * as obsPort from '../../../src/ports/obs.ts'
import * as opsPort from '../../../src/ports/ops.ts'
import * as regPort from '../../../src/ports/reg.ts'
import * as trustPort from '../../../src/ports/trust.ts'
import * as workPort from '../../../src/ports/work.ts'
import * as wsPort from '../../../src/ports/ws.ts'
import { envelope, orgVacancyPayload, perfPayload, rootGrantPayload } from '../records/fixtures.ts'
import { workIntakePayload } from '../records/fixtures-work.ts'

// ── 一、照录常量（v2/10 §七/§八；契约包不 import core，故为独立副本）────────────────────────
/** v2/10 §七 公布向量（与 core enc-digest.test.ts 同值；改实现不改向量） */
const VEC: Readonly<Record<string, { readonly input: string; readonly canonical: string; readonly sha256: string }>> = {
  "VEC-01": { input: "{\"b\":1,\"a\":2}", canonical: "{\"a\":2,\"b\":1}", sha256: "d3626ac30a87e6f7a6428233b3c68299976865fa5508e4267c5415c76af7a772" },
  "VEC-02": { input: "{\"\u00e9\":1,\"\":2}", canonical: "{\"\":2,\"\u00e9\":1}", sha256: "2e001283ca5ee7b0573774ceb51e9153191dfb1750072e92f5bc9b243616ced0" },
  "VEC-03": { input: "{\"decimal\":\"1.20\"}", canonical: "{\"decimal\":\"1.20\"}", sha256: "842666826fb49301a90d4f16027c847a964a351255b451078c0368c16c4e27de" },
  "VEC-04": { input: "{\"decimal\":\"1.2\"}", canonical: "{\"decimal\":\"1.2\"}", sha256: "64142ec148cb5956ef7759a096ee2adc15ad9816f3feba6b447d848fd99dc4ec" },
  "VEC-05": { input: "{\"nested\":{\"z\":0,\"a\":[true,null,\"x\"]}}", canonical: "{\"nested\":{\"a\":[true,null,\"x\"],\"z\":0}}", sha256: "1960243bf260a4ab0f405341814cdb64aa4ed147e5904994d87b98200713c29a" },
  "VEC-06": { input: "{\"\\u20ac\":\"Euro Sign\",\"\\r\":\"Carriage Return\",\"\\ufb33\":\"Hebrew Letter Dalet With Dagesh\",\"1\":\"One\",\"\\ud83d\\ude00\":\"Emoji: Grinning Face\",\"\\u0080\":\"Control\",\"\\u00f6\":\"Latin Small Letter O With Diaeresis\"}", canonical: "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\u0080\":\"Control\",\"\u00f6\":\"Latin Small Letter O With Diaeresis\",\"\u20ac\":\"Euro Sign\",\"\ud83d\ude00\":\"Emoji: Grinning Face\",\"\ufb33\":\"Hebrew Letter Dalet With Dagesh\"}", sha256: "5e321556d22018a9656991a9e94f77ec175fa193e52a2429d312f8419ec8b08c" },
  "VEC-07": { input: "{\"s\":\"a\\\"b\\\\c\\u0000\\u0008\\u0009\\u000A\\u000C\\u000D\\u001F\"}", canonical: "{\"s\":\"a\\\"b\\\\c\\u0000\\b\\t\\n\\f\\r\\u001f\"}", sha256: "742ba263609b3e762a15ebdf623a4d1dc3f8009d5ac2bee6cd9812c53865c973" },
  "VEC-08": { input: "{\"zero\":0,\"max\":9007199254740991,\"min\":-9007199254740991}", canonical: "{\"max\":9007199254740991,\"min\":-9007199254740991,\"zero\":0}", sha256: "b7b2401ddca2165824e98c61890c0aaec470258d3119dd265d02be9438bf47e6" },
}
/** VEC-05 注释的输入字节摘要（byteDigest≠semanticDigest；§2.5 两材料不得混用） */
const VEC_05_BYTE_DIGEST = 'a96967b6b1a824e869ca1df37635503dac333de7b1bed6f15ba4726a17a89e9b'
/** v2/10 §八 ENC 五码 */
const ENC_CODES: readonly string[] = ['E-ENC-001', 'E-ENC-002', 'E-ENC-003', 'E-ENC-004', 'E-ENC-005']
/** v2/10 §八 SCH 八码（含 W-；§八 refResolve 与 ENU-97 七值的张力归 core 登记，此处不跨相位断言） */
const SCH_CODES: readonly string[] = ['E-SCH-001', 'E-SCH-002', 'E-SCH-003', 'E-SCH-004', 'E-SCH-005', 'W-SCH-001', 'W-SCH-002', 'W-SCH-003']
/** v2/10 §八 RULE 十二码→相位（封闭集；一码一相位，不跨用） */
const RULE_CODE_PHASES: Readonly<Record<string, string>> = {
  'E-RULE-001': 'parse', 'E-RULE-002': 'parse', 'E-RULE-003': 'typecheck', 'E-RULE-004': 'typecheck',
  'E-RULE-005': 'inputBinding', 'E-RULE-006': 'inputBinding', 'E-RULE-007': 'eval', 'E-RULE-008': 'limit',
  'E-RULE-009': 'limit', 'E-RULE-010': 'policy', 'W-RULE-001': 'policy', 'W-RULE-002': 'typecheck',
}
/** v2/10 §6.2 算子全集（与 core SUPPORTED_RULE_OPERATORS 同值）；ENU-92/93/104 字面集照录 */
const RULE_OPERATORS: readonly string[] = ['not', 'present', 'absent', 'isNull', 'neg', 'dec', 'int', 'and', 'or', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'add', 'sub', 'mul', 'div', 'in', 'forall', 'exists', 'match']
const PROFILE_STATUSES: readonly string[] = ['defined', 'vectors-published', 'supported']
const EVAL_OUTCOMES: readonly string[] = ['true', 'false', 'unknown', 'refused']
const LIMITS_APPLIED_NAMES: readonly string[] = ['maxNodes', 'maxDepth', 'maxListItems', 'maxTextCodepoints', 'maxSignificantDigits', 'maxScale', 'maxEvalSteps']
const FIXED_LIMIT_NAMES: readonly string[] = ['maxPatternInputCodepoints', 'maxPatternSteps', 'maxQuantifierNesting']
/** v2/14 §二 13 端口-文件映射（F5 唯一源；模块身份即文件身份，测试只做机械比对） */
const PORT_MODULES: ReadonlyArray<readonly [string, unknown]> = [
  ['def.ts', defPort], ['reg.ts', regPort], ['auth.ts', authPort], ['hr.ts', hrPort], ['work.ts', workPort],
  ['exec.ts', execPort], ['ws.ts', wsPort], ['evd.ts', evdPort], ['hist.ts', histPort], ['trust.ts', trustPort],
  ['gate.ts', gatePort], ['obs.ts', obsPort], ['ops.ts', opsPort],
]
/** 新五域首批下限与总数（plan/05 IMPL-03-06；实现单给数，后续批次只增不减故断言取 ≥） */
const NEW_DOMAIN_FLOORS: Readonly<Record<string, number>> = { enc: 10, rule: 10, sch: 10, rec: 10, port: 3 }
const KNOWN_DOMAINS: readonly string[] = ['meta', 'dir', 'evt', 'rpt', 'deps', 'plat', 'mj', 'enc', 'rule', 'sch', 'rec', 'port']
const FIRST_BATCH_TOTAL = 43
const FIRST_BATCH_NEG = 32

// ── 二、清单视图与断言助手 ────────────────────────────────────────────────────────────────
interface ExpectedLike {
  readonly out?: unknown
  readonly err?: { readonly category: string; readonly subcause?: string }
}
interface CaseLike {
  readonly id: string
  readonly domain: string
  readonly docs: string
  readonly title: string
  readonly input: unknown
  readonly expected: ExpectedLike
}
const ALL_CASES = cases.cases as unknown as readonly CaseLike[]

const inDomain = (domain: string): readonly CaseLike[] => ALL_CASES.filter((entry) => entry.domain === domain)
const hasKey = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const isHex64 = (value: unknown): boolean => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const isSemver = (value: unknown): boolean =>
  typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
/** NEG 机械映射键：title 的 `NEG-<族>-<序号>｜` 前缀（全角竖线为分隔符） */
const negPrefix = (title: string): string | undefined => /^(NEG-[A-Z]+-\d{2})｜/.exec(title)?.[1]
/** 规范文本形态（ENC-03）：**字符串外**无空白（字符串内的空格属于值本身，不算空白违规） */
function hasWhitespaceOutsideStrings(text: string): boolean {
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === ' ' || char === '\t' || char === '\n' || char === '\r') return true
  }
  return false
}

// ── 三、本地 subject 接线（rec/sch/port；只消费契约包自己的导出面）───────────────────────────
function recordSchemaOf(recordType: unknown): ZodType | undefined {
  if (typeof recordType !== 'string' || !hasKey(ALL_RECORD_SCHEMAS, recordType)) return undefined
  return ALL_RECORD_SCHEMAS[recordType as keyof typeof ALL_RECORD_SCHEMAS]
}

/** 记录形状闸：按记录自带 `recordType` 分派到 ALL_RECORD_SCHEMAS（未登记类型/形状不符即拒） */
function parseRecordInput(input: unknown): { readonly recordType: string } {
  const bag = asRecord(input)
  if (bag === undefined) configInvalid('rec/input-shape')
  const record = asRecord(bag['record'])
  if (record === undefined) configInvalid('rec/record-shape')
  const recordType = record['recordType']
  const schema = recordSchemaOf(recordType)
  if (schema === undefined) configInvalid('rec/record-type', String(recordType))
  const parsed = schema.safeParse(record)
  if (!parsed.success) {
    configInvalid('rec/record-shape', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('；'))
  }
  return { recordType: String(recordType) }
}
const recSubject: SubjectFn = (input) => ({ ok: true, ...parseRecordInput(input) })

/** 标量族（v2/10 §1.1 SCH-SYN-01）：与 records/envelope.ts 标量 schema 同源 */
const SCALAR_SCHEMAS: Readonly<Record<string, ZodType>> = {
  token: TokenSchema, dotid: DotIdSchema, semver: SemverSchema, timestamp: TimestampSchema, recordTypeId: RecordTypeIdSchema,
}
/** sch 主体：`{op:'scalar',family,value}` 标量域；`{op:'record',record}` 记录 schema 形状 */
const schSubject: SubjectFn = (input) => {
  const bag = asRecord(input)
  if (bag === undefined) configInvalid('sch/input-shape')
  const op = bag['op']
  if (op === 'record') return { ok: true, ...parseRecordInput(bag) }
  if (op !== 'scalar') configInvalid('sch/op-unknown', String(op))
  const family = bag['family']
  const schema = typeof family === 'string' ? SCALAR_SCHEMAS[family] : undefined
  if (family === undefined || schema === undefined) configInvalid('sch/scalar-family', String(family))
  const result = schema.safeParse(bag['value'])
  if (!result.success) configInvalid(`sch/${String(family)}`, result.error.issues.map((issue) => issue.message).join('；'))
  return { ok: true, family: String(family) }
}
/** 端口模块里恰一个 `PORT_*` 字符串常量（ops.ts 另有 OPS_AUTHORITY_SOURCE，键非 PORT_ 形） */
function portIdOfModule(module: unknown): string | undefined {
  const pairs = Object.entries(module as Record<string, unknown>).filter(([key, value]) => /^PORT_[A-Z]+$/.test(key) && typeof value === 'string')
  const first = pairs[0]
  return pairs.length === 1 && first !== undefined ? String(first[1]) : undefined
}
function portFileMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const [file, module] of PORT_MODULES) {
    const id = portIdOfModule(module)
    if (id !== undefined) map[id] = file
  }
  return map
}
const portSubject: SubjectFn = (input) => {
  const bag = asRecord(input)
  if (bag === undefined) configInvalid('port/input-shape')
  const op = bag['op']
  if (op === 'names') {
    const names = PORT_MODULES.map(([, module]) => portIdOfModule(module))
    return { count: names.length, names }
  }
  if (op === 'version') return { version: PORT_VERSION }
  if (op === 'fileMap') return { map: portFileMap() }
  configInvalid('port/op-unknown', String(op))
}
const EXECUTABLE_SUBJECTS: Readonly<Record<string, SubjectFn>> = { rec: recSubject, sch: schSubject, port: portSubject }
async function runDomain(domain: string, manifest: unknown = cases): Promise<{ total: number; failed: readonly unknown[] }> {
  const report = await runCases(manifest, EXECUTABLE_SUBJECTS as Record<string, SubjectFn>, { domains: [domain] })
  return { total: report.total, failed: report.failed }
}

// ── 四、清单结构（v1 冻结格式；CASES.md 冻结规则 1/2/6）────────────────────────────────────
describe('cases.json 清单结构（v1 冻结格式）', () => {
  it('清单过 CaseManifestSchema（version=1、单条 id/domain/docs/title/input/expected 齐）', () => {
    expect(CaseManifestSchema.safeParse(cases).success).toBe(true)
    expect(cases.version).toBe(1)
  })

  it('id 唯一且形如 C-<域>-<三位序号>；domain 在登记域集内；title 非空', () => {
    const ids = ALL_CASES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of ALL_CASES) {
      expect(entry.id).toMatch(/^C-[a-z]+-\d{3}$/)
      expect(entry.id.split('-')[1]).toBe(entry.domain)
      expect(KNOWN_DOMAINS).toContain(entry.domain)
      expect(entry.title.length).toBeGreaterThan(0)
    }
  })

  it('expected 恰含 out 或 err 之一；err 的 category 属 11 类分类、subcause 非空串', () => {
    const categories = ['GATE_FAIL', 'WORKER_DEAD', 'QA_BACK', 'STALL', 'NO_LANE', 'DISPATCH_FAIL', 'MERGE_CONFLICT', 'LLM_FAIL', 'CONFIG_INVALID', 'EVOLVE_REJECT', 'EXTERNAL_REJECT']
    for (const entry of ALL_CASES) {
      const keys = Object.keys(entry.expected)
      expect(keys).toHaveLength(1)
      expect(keys[0] === 'out' || keys[0] === 'err').toBe(true)
      const err = entry.expected.err
      if (err === undefined) continue
      expect(categories).toContain(err.category)
      if (err.subcause !== undefined) expect(err.subcause.length).toBeGreaterThan(0)
    }
  })

  it('每单必填 docs（20-§二 依据链）；新五域 docs 一律以 `v2/` 开头（plan/04 §1.2）', () => {
    for (const entry of ALL_CASES) expect(entry.docs.length).toBeGreaterThan(0)
    for (const domain of Object.keys(NEW_DOMAIN_FLOORS)) {
      for (const entry of inDomain(domain)) expect(entry.docs.startsWith('v2/')).toBe(true)
    }
  })
})

// ── 五、域条数与 NEG 前缀（首批目标；只增不减）────────────────────────────────────────────
describe('新五域条数与 NEG 前缀覆盖（IMPL-03-06 首批目标）', () => {
  it('enc/rule/sch/rec/port 各域 ≥ 首批下限，新增合计 ≥ 43，清单总数 ≥ 96', () => {
    for (const [domain, floor] of Object.entries(NEW_DOMAIN_FLOORS)) expect(inDomain(domain).length).toBeGreaterThanOrEqual(floor)
    const added = Object.keys(NEW_DOMAIN_FLOORS).reduce((sum, domain) => sum + inDomain(domain).length, 0)
    expect(added).toBeGreaterThanOrEqual(FIRST_BATCH_TOTAL)
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(53 + FIRST_BATCH_TOTAL)
  })

  it('NEG 前缀条数 ≥ 32，族分布 ENC2/RULE10/SCH10/REC10（title 前缀机械映射）', () => {
    const negEntries = ALL_CASES.filter((entry) => negPrefix(entry.title) !== undefined)
    expect(negEntries.length).toBeGreaterThanOrEqual(FIRST_BATCH_NEG)
    const familyOf: Record<string, string> = { enc: 'ENC', rule: 'RULE', sch: 'SCH', rec: 'REC' }
    const ofFamily = (family: string): readonly CaseLike[] =>
      negEntries.filter((entry) => negPrefix(entry.title)?.startsWith(`NEG-${family}-`) === true)
    expect(ofFamily('ENC')).toHaveLength(2)
    expect(ofFamily('RULE')).toHaveLength(10)
    expect(ofFamily('SCH')).toHaveLength(10)
    expect(ofFamily('REC')).toHaveLength(10)
    for (const entry of negEntries) expect(negPrefix(entry.title)?.startsWith(`NEG-${familyOf[entry.domain] ?? '?'}-`)).toBe(true)
  })

  it('NEG expected 通道纪律：err 为常例；rule 的 inputBinding/limit/unknown 面用 out（refused/unknown≠false）', () => {
    for (const entry of ALL_CASES) {
      if (negPrefix(entry.title) === undefined) continue
      if (hasKey(entry.expected, 'err')) {
        expect(entry.expected.err?.category).toBe('CONFIG_INVALID')
        continue
      }
      // 例外面（v2/10 §6.6 NEG-RULE-02/03/07/08）：refused/unknown 不得压成布尔或抛错
      expect(entry.domain).toBe('rule')
      const out = asRecord(entry.expected.out)
      expect(['refused', 'unknown']).toContain(out?.['outcome'])
    }
  })
})

// ── 六、enc：VEC 期望值照录与形态（不 import core；执行归 core enc-digest.test.ts）────────────
describe('enc 域：VEC-01..08 期望值照录 + NEG-ENC-01/02', () => {
  it('VEC-01..08 的 input/canonical/sha256 与 v2/10 §七 公布表逐条一致（不得自造摘要）', () => {
    const vectorIds = Object.keys(VEC)
    expect(vectorIds).toHaveLength(8)
    for (const [index, vectorId] of vectorIds.entries()) {
      const vector = VEC[vectorId]
      const entry = ALL_CASES.find((candidate) => candidate.id === `C-enc-${String(index + 1).padStart(3, '0')}`)
      expect(vector).toBeDefined()
      expect(entry).toBeDefined()
      if (vector === undefined || entry === undefined) continue
      expect(entry.title.startsWith(`${vectorId}｜`)).toBe(true)
      expect(asRecord(entry.input)?.['jsonText']).toBe(vector.input)
      const out = asRecord(entry.expected.out)
      expect(out?.['canonical']).toBe(vector.canonical)
      expect(out?.['sha256']).toBe(vector.sha256)
      expect(isHex64(out?.['sha256'])).toBe(true)
      // 规范文本无字符串外空白（ENC-03）；非 ASCII 原样输出不转 \u
      expect(hasWhitespaceOutsideStrings(String(out?.['canonical']))).toBe(false)
    }
  })

  it('VEC-05 字节摘要≠语义摘要（§2.5 两材料不得混用）；VEC-06 键序为 UTF-16 码元序', () => {
    const vec05 = VEC['VEC-05']
    const vec06 = VEC['VEC-06']
    expect(vec05).toBeDefined()
    expect(vec06).toBeDefined()
    if (vec05 === undefined || vec06 === undefined) return
    expect(VEC_05_BYTE_DIGEST).toHaveLength(64)
    expect(VEC_05_BYTE_DIGEST).not.toBe(vec05.sha256)
    const emoji = vec06.canonical.indexOf('\u{1f600}')
    const dalet = vec06.canonical.indexOf('\ufb33')
    expect(emoji).toBeGreaterThan(-1)
    expect(dalet).toBeGreaterThan(emoji)
    expect(vec06.canonical).not.toMatch(/\\u00f6|\\u20ac|\\ud83d|\\ufb33/i)
  })

  it('负向两单：NEG-ENC-01→E-ENC-003（域外数值 1e+30）、NEG-ENC-02→E-ENC-002（重复成员名）', () => {
    const negatives = inDomain('enc').filter((entry) => negPrefix(entry.title) !== undefined)
    expect(negatives.map((entry) => negPrefix(entry.title))).toEqual(['NEG-ENC-01', 'NEG-ENC-02'])
    expect(negatives[0]?.expected.err?.subcause).toBe('E-ENC-003')
    expect(negatives[1]?.expected.err?.subcause).toBe('E-ENC-002')
    for (const negative of negatives) expect(ENC_CODES).toContain(negative.expected.err?.subcause)
    expect(asRecord(negatives[0]?.input)?.['jsonText']).toBe('{"v":1e+30}')
    expect(asRecord(negatives[1]?.input)?.['jsonText']).toBe('{"a":1,"a":2}')
  })
})

// ── 七、rule：最小合法档结构与码级期望（不 import core；执行归 core rule-engine*.test.ts）─────
function expectProfileShape(profile: unknown, label: string): Record<string, unknown> {
  const bag = asRecord(profile)
  expect(bag, `${label} 档必须是对象`).toBeDefined()
  if (bag === undefined) return {}
  expect(typeof bag['profileId']).toBe('string')
  expect(isSemver(bag['version'])).toBe(true)
  expect(PROFILE_STATUSES).toContain(bag['status'])
  // ENC-08 摘要结构（semanticDigest；byte 不得顶替）
  const digest = asRecord(bag['semanticDigest'])
  expect([digest?.['algorithm'], digest?.['kind'], digest?.['canonicalizationId'], digest?.['canonicalizationVersion']]).toEqual(['sha-256', 'semantic', 'studio-next.jcs', 1])
  expect(isHex64(digest?.['value'])).toBe(true)
  // RULE-06 档声明算子全集（档外算子拒收 E-RULE-002）
  const operators = Array.isArray(bag['operators']) ? bag['operators'].map(String) : []
  expect(operators.length).toBeGreaterThan(0)
  expect(new Set(operators).size).toBe(operators.length)
  for (const operator of operators) expect(RULE_OPERATORS).toContain(operator)
  // §6.3 限额十项（七项可收紧＋三项档内固定）：键集恰等，不得缺省
  const limits = asRecord(bag['limits'])
  expect(Object.keys(asRecord(limits?.['ceiling']) ?? {}).sort()).toEqual([...LIMITS_APPLIED_NAMES].sort())
  expect(Object.keys(asRecord(limits?.['fixed']) ?? {}).sort()).toEqual([...FIXED_LIMIT_NAMES].sort())
  // §6.3 patternModel / determinism（RULE-08 确定性；Unicode 归一钉版）
  const patternModel = asRecord(bag['patternModel'])
  expect([patternModel?.['matchingModel'], patternModel?.['anchoring']]).toEqual(['linear-nfa', 'full-match'])
  expect(typeof patternModel?.['caseSensitive']).toBe('boolean')
  expect(Number(patternModel?.['maxQuantifierBound'])).toBeLessThanOrEqual(1000)
  const determinism = asRecord(bag['determinism'])
  expect(determinism?.['unicodeVersion']).toBe('Unicode 15.1.0')
  expect(['codepoint', 'nfc']).toContain(determinism?.['strComparison'])
  expect(['half-even', 'floor', 'ceiling']).toContain(asRecord(determinism?.['decimalContext'])?.['rounding'])
  // §6.5 档必带 caseSetRefs（无用例的档不得被跨实现声明支持）
  const caseSetRefs = Array.isArray(bag['caseSetRefs']) ? bag['caseSetRefs'] : []
  expect(caseSetRefs.length).toBeGreaterThan(0)
  for (const item of caseSetRefs) {
    const ref = asRecord(item)
    expect(typeof ref?.['setId']).toBe('string')
    expect(isSemver(ref?.['version'])).toBe(true)
    expect(isHex64(asRecord(ref?.['digest'])?.['value'])).toBe(true)
  }
  return bag
}
function expectRuleRefMatches(rule: unknown, profile: Record<string, unknown>, allowVersionMismatch: boolean): void {
  const bag = asRecord(rule)
  expect(bag).toBeDefined()
  if (bag === undefined) return
  const ref = asRecord(bag['ruleProfileRef'])
  expect(ref?.['profileId']).toBe(profile['profileId'])
  // NEG-RULE-09 的构造就是「引用的版本与档不一致」；其余 case 引用必须与档逐字段一致（禁「当前最新」）
  if (allowVersionMismatch) expect(ref?.['version']).not.toBe(profile['version'])
  else expect(ref?.['version']).toBe(profile['version'])
  expect(asRecord(ref?.['digest'])).toEqual(asRecord(profile['semanticDigest']))
  const decl = asRecord(bag['inputDecl'])
  expect(Array.isArray(decl?.['roots'])).toBe(true)
  for (const field of Array.isArray(decl?.['fields']) ? decl['fields'] : []) {
    const item = asRecord(field)
    expect(String(item?.['path']).startsWith('/')).toBe(true)
    expect(['string', 'object']).toContain(typeof item?.['type'])
    // RULE-02：absenceTolerant 逐字段声明（不得整组放行）
    expect([typeof item?.['required'], typeof item?.['absenceTolerant']]).toEqual(['boolean', 'boolean'])
  }
}

describe('rule 域：NEG-RULE-01..10 逐码一条（最小合法档＋单点构造）', () => {
  it('恰 10 条，title 前缀覆盖 NEG-RULE-01..10 各一次', () => {
    const entries = inDomain('rule')
    expect(entries).toHaveLength(10)
    expect(entries.map((entry) => negPrefix(entry.title)).sort()).toEqual(
      Array.from({ length: 10 }, (_value, index) => `NEG-RULE-${String(index + 1).padStart(2, '0')}`),
    )
  })

  it('输入是「最小合法档＋单点非法构造」：档结构面齐、规则引用与档摘要逐字段一致', () => {
    for (const entry of inDomain('rule')) {
      const input = asRecord(entry.input)
      expect(input).toBeDefined()
      if (input === undefined) continue
      if (hasKey(input, 'upgrade')) {
        const upgrade = asRecord(input['upgrade'])
        const previous = expectProfileShape(upgrade?.['previous'], `${entry.id} previous`)
        const next = expectProfileShape(upgrade?.['next'], `${entry.id} next`)
        expect(next['profileId']).toBe(previous['profileId'])
        expect(next['version']).not.toBe(previous['version'])
        expect(asRecord(upgrade?.['evidence'])).toBeDefined()
        continue
      }
      expectRuleRefMatches(input['rule'], expectProfileShape(input['profile'], entry.id), entry.expected.err?.subcause === 'E-RULE-010')
      // 静态拒绝位（err）不需要求值输入；求值面（out）必须有 inputs（JSON 值，jcs@1 域内）
      if (hasKey(entry.expected, 'out')) expect(asRecord(input['inputs'])).toBeDefined()
    }
  })

  it('err 通道：subcause ∈ §八 RULE 十二码（码级断言；CONFIG_INVALID 为契约 subject 分类）', () => {
    const errEntries = inDomain('rule').filter((entry) => hasKey(entry.expected, 'err'))
    expect(errEntries).toHaveLength(6)
    for (const entry of errEntries) {
      expect(entry.expected.err?.category).toBe('CONFIG_INVALID')
      expect(Object.keys(RULE_CODE_PHASES)).toContain(entry.expected.err?.subcause)
    }
    // 静态面拒绝位：NEG-RULE-01→001、04→003、05→004、06→001、09→010、10→010
    const codes = errEntries.map((entry) => entry.expected.err?.subcause)
    expect(new Set(codes)).toEqual(new Set(['E-RULE-001', 'E-RULE-003', 'E-RULE-004', 'E-RULE-010']))
    expect(codes.filter((code) => code === 'E-RULE-010')).toHaveLength(2)
  })

  it('out 通道：refused（输入绑定/限额）与 unknown（unknown 传播）不压布尔；码相位与 §八 一致', () => {
    const outEntries = inDomain('rule').filter((entry) => hasKey(entry.expected, 'out'))
    expect(outEntries).toHaveLength(4)
    expect(outEntries.map((entry) => asRecord(entry.expected.out)?.['outcome'])).toEqual(['refused', 'refused', 'refused', 'unknown'])
    const codes: unknown[] = []
    for (const entry of outEntries) {
      const out = asRecord(entry.expected.out)
      expect(EVAL_OUTCOMES).toContain(out?.['outcome'])
      for (const item of Array.isArray(out?.['diagnostics']) ? out['diagnostics'] : []) {
        const diagnostic = asRecord(item)
        expect(RULE_CODE_PHASES[String(diagnostic?.['code'])]).toBe(diagnostic?.['phase'])
        codes.push(diagnostic?.['code'])
      }
    }
    // 求值面码覆盖：NEG-RULE-02→E-RULE-005、03→006、07→008（inputBinding/limit 相位走 out 通道）
    expect(codes).toEqual(['E-RULE-005', 'E-RULE-006', 'E-RULE-008'])
  })
})

// ── 八、rec：ALL_RECORD_SCHEMAS 可执行子集（断言全绿）────────────────────────────────────────
describe('rec 域：ALL_RECORD_SCHEMAS 可执行子集（断言全绿）', () => {
  it('rec 十条全部按期望通道执行通过（err=形状闸拒绝）', async () => {
    const report = await runDomain('rec')
    expect(report.total).toBe(10)
    expect(report.failed).toEqual([])
  })

  it('正例对照：四族合法最少记录过同一 subject（防「恒拒」假绿）', () => {
    for (const record of [
      envelope('REC-AUTH-01', rootGrantPayload()),
      envelope('REC-LIFE-08', orgVacancyPayload()),
      envelope('REC-PERF-01', perfPayload()),
      envelope('REC-WORK-01', workIntakePayload()),
    ]) {
      expect(recSubject({ record })).toMatchObject({ ok: true, recordType: record['recordType'] })
    }
  })

  it('反证：把 rec 全批 err 期望改成 out 必红（谎报 subject 会被 runner 揪出）', async () => {
    const mutated = { version: 1, cases: ALL_CASES.map((entry) => (entry.domain === 'rec' ? { ...entry, expected: { out: { ok: true } } } : entry)) }
    expect((await runDomain('rec', mutated)).failed.length).toBe(10)
  })

  it('NEG-REC 覆盖：01..09 各族＋11 ASSET（10 无 NEG 行；12/13 归后续批次）', () => {
    expect(inDomain('rec').map((entry) => negPrefix(entry.title)).sort()).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '11'].map((suffix) => `NEG-REC-${suffix}`),
    )
  })
})

// ── 九、sch：标量族＋记录 schema 可执行子集（断言全绿）──────────────────────────────────────
describe('sch 域：标量/记录 schema 可执行子集（断言全绿）', () => {
  it('sch 十条全部按期望通道执行通过（err=schema/标量域拒绝）', async () => {
    const report = await runDomain('sch')
    expect(report.total).toBe(10)
    expect(report.failed).toEqual([])
  })

  it('正例对照：合法标量族与合法记录过同一 subject（防「恒拒」）', () => {
    for (const sample of [
      { op: 'scalar', family: 'token', value: 'studio-next' },
      { op: 'scalar', family: 'dotid', value: 'studio-next.records.v2' },
      { op: 'scalar', family: 'semver', value: '1.0.0' },
      { op: 'scalar', family: 'timestamp', value: '2026-10-28T00:00:00Z' },
      { op: 'scalar', family: 'recordTypeId', value: 'REC-ASSET-01' },
    ]) {
      expect(schSubject(sample)).toMatchObject({ ok: true })
    }
    expect(schSubject({ op: 'record', record: envelope('REC-PERF-01', perfPayload()) })).toMatchObject({ ok: true })
  })

  it('反证：把 sch 全批 err 期望改成 out 必红', async () => {
    const mutated = { version: 1, cases: ALL_CASES.map((entry) => (entry.domain === 'sch' ? { ...entry, expected: { out: { ok: true } } } : entry)) }
    expect((await runDomain('sch', mutated)).failed.length).toBe(10)
  })

  it('sch 的 err 只断 category（形状腿不合成码值）；标题里的码是 §八 语义归属且 ∈ SCH 八码', () => {
    const titled: Record<string, string> = {
      'C-sch-004': 'E-SCH-004', 'C-sch-005': 'E-SCH-001', 'C-sch-008': 'E-SCH-002', 'C-sch-009': 'E-SCH-002', 'C-sch-010': 'E-SCH-005',
    }
    for (const entry of inDomain('sch')) {
      // 码级断言归 MIG-04/05 的记录/资产面实现单：本批形状腿只断言拒绝（category 全等）
      expect(entry.expected.err?.subcause).toBeUndefined()
      const claimed = /E-SCH-\d{3}/.exec(entry.title)?.[0]
      if (claimed !== undefined) expect(SCH_CODES).toContain(claimed)
      expect(claimed).toBe(titled[entry.id])
    }
  })
})

// ── 十、port：端口常量/映射可执行子集（断言全绿）────────────────────────────────────────────
describe('port 域：13 端口名/PORT_VERSION/文件映射可执行子集', () => {
  it('port 三条全部按期望通道执行通过', async () => {
    const report = await runDomain('port')
    expect(report.total).toBe(3)
    expect(report.failed).toEqual([])
  })

  it('PORT_VERSION=v0（experimental 未升级）；13 端口模块各恰一 PORT_* 常量（含 gate/obs/ops，禁第 14 端口）', () => {
    expect(PORT_VERSION).toBe('v0')
    expect(PORT_MODULES).toHaveLength(13)
    const ids = PORT_MODULES.map(([, module]) => portIdOfModule(module))
    expect(new Set(ids).size).toBe(13)
    expect(ids).toEqual(['PORT-DEF', 'PORT-REG', 'PORT-AUTH', 'PORT-HR', 'PORT-WORK', 'PORT-EXEC', 'PORT-WS', 'PORT-EVD', 'PORT-HIST', 'PORT-TRUST', 'PORT-GATE', 'PORT-OBS', 'PORT-OPS'])
    expect(Object.keys(portFileMap())).toHaveLength(13)
  })

  it('反证：改坏端口名期望必红（13/13 映射是机械判据，不是清单自证）', async () => {
    const mutated = {
      version: 1,
      cases: ALL_CASES.map((entry) =>
        entry.id === 'C-port-001' ? { ...entry, expected: { out: { count: 13, names: ['PORT-DEF', 'PORT-GHOST'] } } } : entry,
      ),
    }
    const report = await runDomain('port', mutated)
    expect(report.failed.length).toBeGreaterThan(0)
    expect(report.failed.length).toBeLessThanOrEqual(3)
  })
})
