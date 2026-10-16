/**
 * 契约 runner（docs/25-§二 / F2-14；规格见同包 CASES.md）
 * 职责边界：只做「数据进、断言出」——加载清单、按域分发 subject、按冻结语义匹配。
 * runner 对实现细节零知识；subject 由被测域的实现方注册（依赖方向：实现包 → 契约包）。
 *
 * 匹配语义（冻结，改=改 CASES.md+批示）：
 *   对象：expected 的键是断言集，省略键=不关心；数组：等长且无序双射；
 *   字符串 "__NULL__"：断言实际值为显式 null；原语：===（禁 NaN）。
 */
import { CaseManifestSchema, type CaseManifest } from './cases-schema.ts'

export type SubjectFn = (input: unknown) => unknown | Promise<unknown>

export interface RunReport {
  total: number
  passed: number
  failed: { id: string; reason: string }[]
}

/** 被测 subject 抛出的错误形状（对齐 kernel.ClassifiedError；宽松匹配 category） */
interface ThrownShape { category?: unknown; subcause?: unknown }

const NULL_SENTINEL = '__NULL__'

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** expected 哨兵只能以字符串字面量出现在期望树中 */
function matchValue(expected: unknown, actual: unknown, path: string, errs: string[]): void {
  if (expected === NULL_SENTINEL) {
    if (actual !== null) errs.push(`${path}: 期望显式 null，实际 ${JSON.stringify(actual)}`)
    return
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      errs.push(`${path}: 期望数组长度 ${expected.length}，实际 ${Array.isArray(actual) ? actual.length : '非数组'}`)
      return
    }
    // 无序双射：每个期望元素在未消费的实际元素中找到一个匹配
    const used = new Set<number>()
    for (const exp of expected) {
      let found = -1
      for (let i = 0; i < actual.length; i++) {
        if (used.has(i)) continue
        const sub: string[] = []
        matchValue(exp, actual[i], `${path}[${i}]`, sub)
        if (sub.length === 0) { found = i; break }
      }
      if (found < 0) errs.push(`${path}: 数组无序匹配失败，缺 ${JSON.stringify(exp)}`)
      else used.add(found)
    }
    return
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      errs.push(`${path}: 期望对象，实际 ${JSON.stringify(actual)}`)
      return
    }
    for (const key of Object.keys(expected)) {
      matchValue(expected[key], actual[key], `${path}.${key}`, errs)
    }
    return
  }
  if (typeof expected === 'number' && Number.isNaN(expected)) {
    errs.push(`${path}: 契约禁用 NaN 作为期望值`)
    return
  }
  if (expected !== actual) {
    errs.push(`${path}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
  }
}

async function runOne(entry: { id: string; input: unknown; expected: Record<string, unknown> }, subject: SubjectFn): Promise<string[]> {
  const errs: string[] = []
  try {
    const actual = await subject(entry.input)
    if ('err' in entry.expected) {
      errs.push(`期望抛错 ${JSON.stringify(entry.expected.err)}，实际正常返回 ${JSON.stringify(actual)}`)
      return errs
    }
    matchValue(entry.expected['out'], actual, '$', errs)
    return errs
  } catch (thrown) {
    if ('out' in entry.expected) {
      errs.push(`期望正常返回，实际抛错：${String(thrown)}`)
      return errs
    }
    const shape = (thrown ?? {}) as ThrownShape
    const want = entry.expected['err'] as { category: string; subcause?: string }
    if (shape.category !== want.category) {
      errs.push(`错误类别期望 ${want.category}，实际 ${JSON.stringify(shape.category)}`)
    }
    if (want.subcause !== undefined && shape.subcause !== want.subcause) {
      errs.push(`错误子因期望 ${want.subcause}，实际 ${JSON.stringify(shape.subcause)}`)
    }
    return errs
  }
}

/** 跑清单：先过 schema，再按域分发。domains 过滤用于「本包只注册了自己域的 subject」。 */
export async function runCases(
  rawManifest: unknown,
  subjects: Record<string, SubjectFn>,
  opts?: { domains?: string[] },
): Promise<RunReport> {
  const parsed = CaseManifestSchema.safeParse(rawManifest)
  if (!parsed.success) {
    throw new Error(`cases.json 清单自身不合法：${JSON.stringify(parsed.error.issues)}`)
  }
  const manifest: CaseManifest = parsed.data
  const report: RunReport = { total: 0, passed: 0, failed: [] }
  for (const entry of manifest.cases) {
    if (opts?.domains && !opts.domains.includes(entry.domain)) continue
    report.total++
    const subject = subjects[entry.domain]
    if (!subject) {
      report.failed.push({ id: entry.id, reason: `域 ${entry.domain} 未注册 subject` })
      continue
    }
    const errs = await runOne(entry, subject)
    if (errs.length === 0) report.passed++
    else report.failed.push({ id: entry.id, reason: errs.join('；') })
  }
  return report
}
