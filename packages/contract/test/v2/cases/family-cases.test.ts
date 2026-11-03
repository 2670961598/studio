/**
 * family-cases.test.ts —— 六族契约 case 覆盖闸（studio-dev-553 / V2 差距分析 #28）
 *
 * 依据：`docs/sentinel-logs/V2差距分析-2026-11-03.md` #28（cases.json 96 条仅 43 引 v2；
 *   I/R/E/W/HR/WORK 族无 case）｜v2/17 §一 V1 行（「新增 case 覆盖每族至少一正一负」）｜
 *   v2/17 §四（I 族＝01 §三、R 族＝01 §四、E 族＝02 §十一、W 族＝04 §十二；HR/WORK 引 02 §三/11 §5.2）｜
 *   plan/04 §1.2（V1 契约先行法：id 形／docs 形／族前缀映射）｜CASES.md「六族 case 登记」节。
 *
 * 交付面（本文件即 fail-closed 闸）：
 *   1. 六族各域条数下限、id 形、docs 卷锚、族 ID 标题前缀——任一不满足即红；
 *   2. 每族至少一正向（expected.out）一负向（expected.err）——**未覆盖族 ⇒ 本闸红 ⇒ verify:v2 不绿**；
 *   3. 18 条 case 按域分派本地 subject 实跑全绿（正例=放行路径存在，负例=拒绝路径存在）；
 *   4. 负向 case 逐条断言**拒绝原因锚**（阻挡路径/前置记录/期限等），排除「形状误撞」式假绿；
 *   5. 反证：删一族 case／docs 漂移／title 前缀断裂 ⇒ 覆盖闸指名；改坏正向/负向期望 ⇒ runner 必红。
 *
 * 口径：subject 只消费契约包自己的纯判定件（records/auth·chg·emp-neg·work-state·life），
 *   零 IO、不取时钟、不打桩；族语义=拒绝条件，不是真机腿（V3 归各编排单）。
 */
import { describe, expect, it } from 'vitest'

import cases from '../../../cases.json' with { type: 'json' }
import { runCases, type SubjectFn } from '../../../src/index.ts'
import { configInvalid } from '../../../src/schemas/errors.ts'
import {
  checkRootActionPreflight,
  type RootActionRequest,
  type RootActionResolution,
} from '../../../src/records/auth.ts'
import { validateChangeSegment, type ChangeSegmentContext } from '../../../src/records/chg.ts'
import { validateCumulativeConflict, type CumulativeConflictInput } from '../../../src/records/emp-neg.ts'
import { validateEmploymentTransition } from '../../../src/records/life.ts'
import {
  validateCompletionRecord,
  validateWorkTransition,
  type CompletionRecordContext,
  type WorkTransitionContext,
} from '../../../src/records/work-state.ts'

// ── 一、族登记（docs 卷锚与标题前缀=机械映射；floor=本批冻结下限）──────────────────────
interface FamilySpec {
  readonly domain: string
  readonly family: string
  readonly docs: string
  readonly titlePattern: RegExp
  readonly idPattern: RegExp
  readonly floor: number
}

const FAMILIES: readonly FamilySpec[] = [
  { domain: 'i', family: 'I', docs: 'v2/01-§三', titlePattern: /^I-\d{1,2}｜/, idPattern: /^C-i-\d{3}$/, floor: 3 },
  { domain: 'r', family: 'R', docs: 'v2/01-§四', titlePattern: /^R-\d{1,2}｜/, idPattern: /^C-r-\d{3}$/, floor: 3 },
  { domain: 'e', family: 'E', docs: 'v2/02-§十一', titlePattern: /^E-\d{1,2}｜/, idPattern: /^C-e-\d{3}$/, floor: 3 },
  { domain: 'w', family: 'W', docs: 'v2/04-§十二', titlePattern: /^W-\d{2}｜/, idPattern: /^C-w-\d{3}$/, floor: 3 },
  { domain: 'hr', family: 'HR', docs: 'v2/02-§三', titlePattern: /^HR-\d{1,2}｜/, idPattern: /^C-hr-\d{3}$/, floor: 3 },
  { domain: 'work', family: 'WORK', docs: 'v2/11-§5.2', titlePattern: /^WORK-\d{1,2}｜/, idPattern: /^C-work-\d{3}$/, floor: 3 },
]
const FAMILY_DOMAINS: readonly string[] = FAMILIES.map((spec) => spec.domain)
const FAMILY_CASE_TOTAL = FAMILIES.reduce((sum, spec) => sum + spec.floor, 0)

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
interface ManifestLike {
  readonly version: number
  readonly cases: readonly CaseLike[]
}

const MANIFEST = cases as unknown as ManifestLike
const ALL_CASES = MANIFEST.cases
const hasKey = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key)
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
const inFamily = (domain: string): readonly CaseLike[] => ALL_CASES.filter((entry) => entry.domain === domain)

// ── 二、覆盖闸（纯函数；导出以便反证「删一族必指名」）──────────────────────────────────
/** docs 卷锚：精确节锚（允许追加括注，如 `v2/01-§三（I-1）`），不允许以别的节前缀蒙混 */
function docsMatches(docs: unknown, spec: FamilySpec): boolean {
  if (typeof docs !== 'string') return false
  return docs === spec.docs || docs.startsWith(`${spec.docs}（`) || docs.startsWith(`${spec.docs}(`)
}

export function familyCoverageViolations(manifest: unknown): string[] {
  const bag = asRecord(manifest)
  const list = bag?.['cases']
  if (!Array.isArray(list)) return ['清单 cases 非数组']
  const violations: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const id = asRecord(raw)?.['id']
    if (typeof id !== 'string') {
      violations.push('存在无字符串 id 的 case')
      continue
    }
    if (seen.has(id)) violations.push(`${id} id 重复（契约 id 一经合入永不复用）`)
    seen.add(id)
  }
  for (const spec of FAMILIES) {
    const entries = list.filter((entry) => asRecord(entry)?.['domain'] === spec.domain) as unknown as CaseLike[]
    if (entries.length < spec.floor) {
      violations.push(`${spec.family} 族 case 数 ${entries.length} < 下限 ${spec.floor}（${spec.domain} 域）`)
    }
    if (!entries.some((entry) => hasKey(entry.expected, 'out'))) violations.push(`${spec.family} 族缺正向 case（expected.out）`)
    if (!entries.some((entry) => hasKey(entry.expected, 'err'))) violations.push(`${spec.family} 族缺负向 case（expected.err）`)
    for (const entry of entries) {
      if (!docsMatches(entry.docs, spec)) {
        violations.push(`${entry.id} docs=${entry.docs} 未精确锚定 ${spec.docs}（族卷锚漂移）`)
      }
      if (!spec.titlePattern.test(entry.title)) {
        violations.push(`${entry.id} title 不以 ${spec.family} 族 ID 前缀开头（族映射断裂）`)
      }
      if (!spec.idPattern.test(entry.id)) {
        violations.push(`${entry.id} id 形不符 C-${spec.domain}-<三位序号>（族域映射断裂）`)
      }
    }
  }
  return violations
}

// ── 三、本地 subject 接线（按 input.kind 分派到纯判定件）──────────────────────────────
type Outcome = { readonly ok: boolean; readonly issues?: readonly unknown[] }
function ensureOk(subcause: string, outcome: Outcome): { readonly ok: true } {
  if (!outcome.ok) configInvalid(subcause, JSON.stringify(outcome.issues ?? []))
  return { ok: true }
}
function kindOf(input: unknown): { readonly bag: Record<string, unknown>; readonly kind: string } {
  const bag = asRecord(input)
  if (bag === undefined) configInvalid('family/input-shape')
  return { bag, kind: String(bag['kind']) }
}

const iSubject: SubjectFn = (input) => {
  const { bag, kind } = kindOf(input)
  if (kind !== 'rootPreflight') configInvalid('i/kind', kind)
  const request = bag['request'] as unknown as RootActionRequest
  const resolution = bag['resolution'] as unknown as RootActionResolution
  return ensureOk('i/root-preflight', checkRootActionPreflight(bag['record'], request, resolution))
}

const rSubject: SubjectFn = (input) => {
  const { bag, kind } = kindOf(input)
  if (kind !== 'changeSegment') configInvalid('r/kind', kind)
  const ctx = (asRecord(bag['ctx']) ?? {}) as unknown as ChangeSegmentContext
  return ensureOk('r/change-segment', validateChangeSegment(bag['record'], ctx))
}

const eSubject: SubjectFn = (input) => {
  const { bag, kind } = kindOf(input)
  if (kind !== 'cumulativeConflict') configInvalid('e/kind', kind)
  return ensureOk('e/cumulative-conflict', validateCumulativeConflict(bag['input'] as unknown as CumulativeConflictInput))
}

const wSubject: SubjectFn = (input) => {
  const { bag, kind } = kindOf(input)
  if (kind !== 'completion') configInvalid('w/kind', kind)
  const ctx = (asRecord(bag['ctx']) ?? {}) as unknown as CompletionRecordContext
  return ensureOk('w/completion', validateCompletionRecord(bag['record'], ctx))
}

const hrSubject: SubjectFn = (input) => {
  const { bag, kind } = kindOf(input)
  if (kind !== 'employmentTransition') configInvalid('hr/kind', kind)
  return ensureOk('hr/employment-transition', validateEmploymentTransition(bag['record']))
}

const workSubject: SubjectFn = (input) => {
  const { bag, kind } = kindOf(input)
  if (kind !== 'workTransition') configInvalid('work/kind', kind)
  const ctx = (asRecord(bag['ctx']) ?? {}) as unknown as WorkTransitionContext
  return ensureOk('work/work-transition', validateWorkTransition(bag['record'], ctx))
}

const SUBJECTS: Readonly<Record<string, SubjectFn>> = {
  i: iSubject,
  r: rSubject,
  e: eSubject,
  w: wSubject,
  hr: hrSubject,
  work: workSubject,
}

/**
 * 负向 case 的「拒绝原因锚」——subject 抛出的 detail 是判定件 issues 的 JSON，
 * 锚到具体 issue path 才证明拒在文档声明的那个条件上（而非输入形状先行失败）。
 * 键集必须与六族 `expected.err` case 集**逐一对齐**（下方测试断言，防表漂移）。
 */
const REJECTION_REASONS: Readonly<Record<string, string>> = {
  'C-i-002': 'payload.external_signature',
  'C-i-003': 'request.action_scope',
  'C-r-002': 'payload.no_override',
  'C-r-003': 'payload.decided_by',
  'C-e-002': 'conflicts.0.disposition',
  'C-e-003': 'cumulativeView.conclusion',
  'C-w-002': 'payload.completion_basis',
  'C-w-003': 'payload.collector_identity',
  'C-hr-002': 'payload.to_state',
  'C-hr-003': 'payload.review_terms',
  'C-work-002': 'payload.to_state',
  'C-work-003': 'payload.evidence_refs',
}

// ── 四、覆盖闸（fail-closed：未覆盖族 ⇒ verify:v2 不绿）─────────────────────────────
describe('六族 case 覆盖闸（I/R/E/W/HR/WORK；未覆盖即红）', () => {
  it('六族各 ≥3 条、每族至少一正一负、docs 卷锚与族 ID 标题前缀全对', () => {
    expect(familyCoverageViolations(MANIFEST)).toEqual([])
  })

  it('六族 case 合计 ≥18；清单总数 ≥114、引 v2 的 case ≥61（本批 96/43 → 114/61）', () => {
    const familyCases = ALL_CASES.filter((entry) => FAMILY_DOMAINS.includes(entry.domain))
    expect(familyCases.length).toBeGreaterThanOrEqual(FAMILY_CASE_TOTAL)
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(114)
    expect(ALL_CASES.filter((entry) => entry.docs.startsWith('v2/')).length).toBeGreaterThanOrEqual(61)
  })

  it('反证：逐族删空 ⇒ 覆盖闸指名该族（闸不是恒真）', () => {
    for (const spec of FAMILIES) {
      const mutated = { version: 1, cases: ALL_CASES.filter((entry) => entry.domain !== spec.domain) }
      const violations = familyCoverageViolations(mutated)
      expect(violations.some((line) => line.startsWith(`${spec.family} 族`))).toBe(true)
    }
  })

  it('反证：每族删到只剩正向（负向缺）⇒ 闸指名缺负向', () => {
    for (const spec of FAMILIES) {
      const kept = ALL_CASES.filter(
        (entry) => entry.domain !== spec.domain || hasKey(entry.expected, 'out'),
      )
      const violations = familyCoverageViolations({ version: 1, cases: kept })
      expect(violations.some((line) => line.includes(`${spec.family} 族缺负向`))).toBe(true)
    }
  })

  it('反证：docs 卷锚漂移 ⇒ 闸指名（卷锚不是「以本族前缀开头」就放行）', () => {
    const drifted = ALL_CASES.map((entry) => (entry.id === 'C-i-001' ? { ...entry, docs: 'v2/99-§X' } : entry))
    const violations = familyCoverageViolations({ version: 1, cases: drifted })
    expect(violations.some((line) => line.includes('C-i-001 docs=v2/99-§X'))).toBe(true)
  })

  it('反证：title 族 ID 前缀断裂 ⇒ 闸指名（族映射不是自由文本）', () => {
    const drifted = ALL_CASES.map((entry) => (entry.id === 'C-r-001' ? { ...entry, title: 'X-1｜伪装族号' } : entry))
    const violations = familyCoverageViolations({ version: 1, cases: drifted })
    expect(violations.some((line) => line.includes('C-r-001 title 不以 R 族'))).toBe(true)
  })

  it('反证：id 域前缀断裂／id 复用 ⇒ 闸指名', () => {
    const brokenId = ALL_CASES.map((entry) => (entry.id === 'C-e-001' ? { ...entry, id: 'C-zz-001' } : entry))
    expect(familyCoverageViolations({ version: 1, cases: brokenId }).some((line) => line.includes('C-zz-001 id 形不符'))).toBe(true)
    const duplicated = [...ALL_CASES, ALL_CASES.find((entry) => entry.id === 'C-w-001')]
    expect(familyCoverageViolations({ version: 1, cases: duplicated }).some((line) => line.includes('C-w-001 id 重复'))).toBe(true)
  })
})

// ── 五、可执行子集：18 条按域分派实跑（正例放行／负例拒绝）────────────────────────────
describe('六族 case 可执行子集（本地 subject 实跑）', () => {
  it('六域 18 条全部按期望通道执行通过', async () => {
    const report = await runCases(MANIFEST, SUBJECTS as Record<string, SubjectFn>, { domains: [...FAMILY_DOMAINS] })
    expect(report.total).toBe(FAMILY_CASE_TOTAL)
    expect(report.failed).toEqual([])
  })

  it('正例对照：六族正向 case 经 subject 返回 ok（防「恒拒」假绿）', async () => {
    for (const spec of FAMILIES) {
      const positive = inFamily(spec.domain).find((entry) => hasKey(entry.expected, 'out'))
      expect(positive, `${spec.family} 族缺正向 case`).toBeDefined()
      if (positive === undefined) continue
      await expect(Promise.resolve(SUBJECTS[spec.domain]?.(positive.input))).resolves.toMatchObject({ ok: true })
    }
  })

  it('反证：六族正向期望改成 err ⇒ 恰 6 条红（谎报放行必被 runner 揪出）', async () => {
    const mutated = {
      version: 1,
      cases: ALL_CASES.map((entry) =>
        FAMILY_DOMAINS.includes(entry.domain) && hasKey(entry.expected, 'out')
          ? { ...entry, expected: { err: { category: 'CONFIG_INVALID' } } }
          : entry,
      ),
    }
    const report = await runCases(mutated, SUBJECTS as Record<string, SubjectFn>, { domains: [...FAMILY_DOMAINS] })
    expect(report.failed).toHaveLength(FAMILIES.length)
  })

  it('反证：六族负向期望改成 out ⇒ 12 条红（拒绝路径不是纸面声明）', async () => {
    const mutated = {
      version: 1,
      cases: ALL_CASES.map((entry) =>
        FAMILY_DOMAINS.includes(entry.domain) && hasKey(entry.expected, 'err')
          ? { ...entry, expected: { out: { ok: true } } }
          : entry,
      ),
    }
    const report = await runCases(mutated, SUBJECTS as Record<string, SubjectFn>, { domains: [...FAMILY_DOMAINS] })
    expect(report.failed).toHaveLength(FAMILY_CASE_TOTAL - FAMILIES.length)
  })
})

// ── 六、负向拒绝原因锚（防「形状误撞」假绿）──────────────────────────────────────────
describe('六族负向 case 拒绝原因锚（文档声明条件 = 实际拒因）', () => {
  it('原因表与负向 case 集逐一对齐（防表漂移/漏锚）', () => {
    const negatives = ALL_CASES
      .filter((entry) => FAMILY_DOMAINS.includes(entry.domain) && hasKey(entry.expected, 'err'))
      .map((entry) => entry.id)
    expect(Object.keys(REJECTION_REASONS).sort()).toEqual([...negatives].sort())
  })

  it('每条负向 case 的抛错 detail 命中其声明锚（拒绝不是形状误撞）', async () => {
    for (const [id, anchor] of Object.entries(REJECTION_REASONS)) {
      const entry = ALL_CASES.find((candidate) => candidate.id === id)
      expect(entry, `${id} 不在清单`).toBeDefined()
      if (entry === undefined) continue
      let thrown: { detail?: unknown } | undefined
      try {
        await SUBJECTS[entry.domain]?.(entry.input)
      } catch (err) {
        thrown = err as { detail?: unknown }
      }
      expect(thrown, `${id} 应拒却放行`).toBeDefined()
      expect(String(thrown?.detail ?? ''), `${id} 拒因未命中 ${anchor}`).toContain(anchor)
    }
  })
})
