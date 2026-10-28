/**
 * 冻结 JSON Schema 工件的漂移检查器（MIG-03 / IMPL-03-05）
 *
 * 依据链：
 *   - DEC-13-11（v2/13 §六）：冻结工件只许**离线生成**；检查＝内存重生成后与落盘工件比对，
 *     **禁运行时重生成权威工件**（本文件只读：不写任何工件）；
 *   - DEC-OPEN-15：未批不发 `$id` → 检查器把「id 关键字命中数＝0」列为硬断言；
 *   - v2/10 §4.1/§3.1（工件身份 schemaRef；唯一交换编码＝JSON）、v2/16 §三 contract 行；
 *   - plan/05 IMPL-03-05 验收口径：`bun run contract:check` exit 0、工件零 id、74 类全覆盖。
 *
 * 比对口径（三面）：
 *   ① **内容面**（逐字节）：13 个 AREA 数据件由当前 zod 形状重新生成并与磁盘文本逐字节相等；
 *      旁注索引同法重建（生成时间/来源 commit/zod 版本从磁盘回读——冻结期元数据不参与内容比对）；
 *   ② **结构面**：13 AREA 并集＝§一 74 类（无重复/无遗漏/无异类）、数据件根 `$schema` 为
 *      draft 2020-12、文件集恰为 14 件（13＋索引，多件/缺件都判红）；
 *   ③ **身份面**：全部工件原文与结构上 id 关键字命中＝0（DEC-OPEN-15）。
 *
 * 边界：本文件零写入、零网络、零 git；时钟与提交前进不改变判定（故可在任意后续提交复跑）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ARTIFACT_AREAS,
  ARTIFACT_INDEX_FILE,
  ARTIFACT_KIND,
  ARTIFACT_RECORDS_DIR,
  FROZEN_AREA_COUNT,
  FROZEN_RECORD_TYPE_COUNT,
  JSON_SCHEMA_DIALECT,
  SPEC_VERSION,
  buildIndex,
  checkAreaCoverage,
  generateAreaDoc,
  resolveZodVersion,
  serializeArtifact,
  type ArtifactIssue,
  type FreezeMeta,
} from './generate.ts'

/** 被禁的 JSON Schema 身份关键字（DEC-OPEN-15：公共 namespace 登记者未设 → 未批不发） */
const ID_KEY = '$id'

/** 漂移检查结论（`ok=false` 即 exit 1；`findings` 逐条给人话修法） */
export interface ArtifactCheckReport {
  ok: boolean
  artifactsDir: string
  /** 已实际比对内容的文件数（缺件不计） */
  checkedFiles: number
  /** AREA 数据件数（期望 13） */
  areaFiles: number
  /** 数据件 `$defs` 合计（期望 74） */
  schemaCount: number
  /** AREA 数（期望 13） */
  areaCount: number
  /** id 关键字命中数（结构键位；期望 0） */
  idCount: number
  findings: ArtifactIssue[]
  warnings: string[]
}

export interface CheckArtifactsOptions {
  /** 工件目录（默认本包 artifacts/；负例自测可注入临时目录） */
  artifactsDir?: string
}

/** 本包工件目录（packages/contract/artifacts/）——由本文件位置推出，不读环境变量、不写本机路径 */
export function defaultArtifactsDir(): string {
  return fileURLToPath(new URL('../../artifacts/', import.meta.url))
}

/** 读文本；缺失/不可读返回 undefined（由调用方记 finding，不抛错） */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 递归列目录内文件（仓/件相对 posix；跳过点文件——`.DS_Store` 不算工件漂移） */
function listFiles(dir: string, prefix = ''): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析 JSON 对象；非对象/不可解析返回 undefined */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** 递归数某个键名出现次数（结构口径：JSON 对象成员名精确匹配） */
function countKeyOccurrences(value: unknown, key: string, depth = 0): number {
  if (depth > 64 || value === null || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countKeyOccurrences(item, key, depth + 1), 0)
  let count = 0
  for (const [member, memberValue] of Object.entries(value as Record<string, unknown>)) {
    if (member === key) count += 1
    count += countKeyOccurrences(memberValue, key, depth + 1)
  }
  return count
}

/** 子串出现次数（原文口径：连引号的键字面量；键位以外出现同判——保证 grep 面也为 0） */
function countSubstring(text: string, needle: string): number {
  let count = 0
  let index = text.indexOf(needle)
  while (index >= 0) {
    count += 1
    index = text.indexOf(needle, index + needle.length)
  }
  return count
}

/** 首个差异字节与双侧摘录（漂移定位用；只取 80 字节窗口，避免刷屏） */
function firstDiff(expected: string, actual: string): { offset: number; expectedExcerpt: string; actualExcerpt: string } {
  const limit = Math.min(expected.length, actual.length)
  let offset = 0
  while (offset < limit && expected.charCodeAt(offset) === actual.charCodeAt(offset)) offset += 1
  const from = Math.max(0, offset - 40)
  const excerpt = (text: string): string => text.slice(from, offset + 40).replaceAll('\n', '\\n').replaceAll('\t', '\\t')
  return { offset, expectedExcerpt: excerpt(expected), actualExcerpt: excerpt(actual) }
}

/** 从磁盘索引回读冻结期元数据（三项）+ 校验索引自述字段 */
function readFreezeMeta(path: string, text: string, findings: ArtifactIssue[]): FreezeMeta | undefined {
  const doc = parseJsonObject(text)
  if (doc === undefined) {
    findings.push({ path, message: '旁注索引不是可解析的 JSON 对象（无法回读冻结期元数据）' })
    return undefined
  }
  if (doc['artifactKind'] !== ARTIFACT_KIND) {
    findings.push({ path, message: `artifactKind 期望 ${ARTIFACT_KIND}（实际 ${String(doc['artifactKind'])}）` })
  }
  if (doc['specVersion'] !== SPEC_VERSION) {
    findings.push({ path, message: `specVersion 期望 ${SPEC_VERSION}（实际 ${String(doc['specVersion'])}）` })
  }
  const generatedAt = doc['generatedAt']
  const sourceCommit = doc['sourceCommit']
  const generator = doc['generator']
  const zodVersion = isRecord(generator) ? generator['zodVersion'] : undefined
  if (typeof generatedAt !== 'string' || Number.isNaN(Date.parse(generatedAt))) {
    findings.push({ path, message: 'generatedAt 缺失或不是可解析的 ISO 时间戳' })
  }
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(sourceCommit)) {
    findings.push({ path, message: 'sourceCommit 缺失或不是 40 位小写十六进制提交哈希' })
  }
  if (typeof zodVersion !== 'string' || zodVersion.length === 0) {
    findings.push({ path, message: 'generator.zodVersion 缺失（离线生成的依赖版本须在册）' })
  }
  if (typeof generatedAt !== 'string' || typeof sourceCommit !== 'string' || typeof zodVersion !== 'string') return undefined
  return { generatedAt, sourceCommit, zodVersion }
}

/**
 * 漂移检查主函数（纯读）。
 * 返回结论对象；`ok=false` 的调用方（cli/test）应判失败（CLI exit 1）。
 */
export function checkArtifacts(options: CheckArtifactsOptions = {}): ArtifactCheckReport {
  const artifactsDir = options.artifactsDir ?? defaultArtifactsDir()
  const findings: ArtifactIssue[] = []
  const warnings: string[] = []

  // ① 结构面：13 AREA 覆盖＝§一 74 类（无重复/无遗漏/无异类/计数＝冻结值）
  findings.push(...checkAreaCoverage())

  // ② 冻结期元数据：从磁盘索引回读（生成时间/来源 commit/zod 版本不参与内容比对）
  const indexRel = ARTIFACT_INDEX_FILE
  const indexText = readText(join(artifactsDir, indexRel))
  if (indexText === undefined) {
    findings.push({ path: indexRel, message: '缺旁注索引（artifacts/index.json）——冻结期元数据与文件摘要无在册处' })
  }
  const meta = indexText === undefined ? undefined : readFreezeMeta(indexRel, indexText, findings)

  // ③ 内容面：期望文本（当前 zod 形状 → 内存重生成；索引用磁盘元数据重建，故可复算）
  const expected = new Map<string, string>()
  for (const area of ARTIFACT_AREAS) {
    expected.set(`${ARTIFACT_RECORDS_DIR}/${area.file}`, serializeArtifact(generateAreaDoc(area)))
  }
  if (meta !== undefined) expected.set(indexRel, serializeArtifact(buildIndex(meta)))

  // ④ 文件集：工件目录只许 14 件（13 AREA 数据件＋索引）；多件＝冻结面被旁路，缺件＝工件丢失
  for (const rel of listFiles(artifactsDir)) {
    if (!expected.has(rel)) {
      findings.push({ path: rel, message: '工件目录出现未登记文件（冻结面只许 13 个 AREA 数据件＋index.json）' })
    }
  }

  // ⑤ 逐件比对：逐字节＋零 id 关键字＋数据件根方言/类目数
  let checkedFiles = 0
  let idCount = 0
  let schemaCount = 0
  for (const [rel, expectedText] of expected) {
    const text = readText(join(artifactsDir, rel))
    if (text === undefined) {
      findings.push({ path: rel, message: '缺件（冻结工件期望存在）' })
      continue
    }
    checkedFiles += 1
    const structuredId = (() => {
      const doc = parseJsonObject(text)
      return doc === undefined ? 0 : countKeyOccurrences(doc, ID_KEY)
    })()
    idCount += structuredId
    const rawId = countSubstring(text, `"${ID_KEY}"`)
    if (rawId > 0) {
      findings.push({ path: rel, message: `id 关键字命中 ${rawId} 处（DEC-OPEN-15：未批不发；工件身份走 schemaRef）` })
    }
    if (rel.startsWith(`${ARTIFACT_RECORDS_DIR}/`)) {
      const doc = parseJsonObject(text)
      if (doc === undefined) {
        findings.push({ path: rel, message: '不是可解析的 JSON 对象（数据件须是 JSON Schema 文档）' })
      } else {
        if (doc['$schema'] !== JSON_SCHEMA_DIALECT) {
          findings.push({ path: rel, message: `根方言期望 ${JSON_SCHEMA_DIALECT}（实际 ${String(doc['$schema'])}）` })
        }
        const defs = doc['$defs']
        schemaCount += isRecord(defs) ? Object.keys(defs).length : 0
        if (!isRecord(defs)) findings.push({ path: rel, message: '$defs 缺失或不是对象（一类一子模式）' })
      }
    }
    if (text !== expectedText) {
      const diff = firstDiff(expectedText, text)
      findings.push({
        path: rel,
        message: `内容漂移（首个差异字节 ${diff.offset}）：期望「${diff.expectedExcerpt}」实际「${diff.actualExcerpt}」`,
      })
    }
  }

  // ⑥ 计数面：74 类 / 13 AREA（冻结值；数据件缺件时 counted 会少于冻结值，缺件已另行判红）
  if (schemaCount !== FROZEN_RECORD_TYPE_COUNT) {
    findings.push({ path: ARTIFACT_RECORDS_DIR, message: `数据件 $defs 合计 ${schemaCount} ≠ 冻结值 ${FROZEN_RECORD_TYPE_COUNT}` })
  }
  if (ARTIFACT_AREAS.length !== FROZEN_AREA_COUNT) {
    findings.push({ path: ARTIFACT_RECORDS_DIR, message: `AREA 件数 ${ARTIFACT_AREAS.length} ≠ 冻结值 ${FROZEN_AREA_COUNT}` })
  }

  // ⑦ 告警面（不判红）：zod 版本漂移——内容若有差异由⑤逐字节兜底，版本漂移本身只提示重冻结
  if (meta !== undefined) {
    const runtimeZodVersion = resolveZodVersion()
    if (meta.zodVersion !== runtimeZodVersion) {
      warnings.push(`zod 版本漂移：工件冻结于 ${meta.zodVersion}，当前 ${runtimeZodVersion}（内容无差异时仍建议走提案流复核重冻结）`)
    }
  }

  return {
    ok: findings.length === 0,
    artifactsDir,
    checkedFiles,
    areaFiles: ARTIFACT_AREAS.length,
    schemaCount,
    areaCount: ARTIFACT_AREAS.length,
    idCount,
    findings,
    warnings,
  }
}

/** 人读报告（CLI stdout 用；结论行含修法指引；目录按仓相对显示，不把本机绝对路径写进证据） */
export function formatCheckReport(report: ArtifactCheckReport): string {
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const relativeDir = relative(repoRoot, report.artifactsDir)
  const shownDir = relativeDir === '' || relativeDir.startsWith('..') ? report.artifactsDir : `${relativeDir}/`
  const lines = [
    'contract:check —— 冻结 JSON Schema 工件漂移检查（MIG-03 / IMPL-03-05；DEC-13-11）',
    `工件目录：${shownDir}`,
    `文件：${report.checkedFiles} 件已比对（AREA 数据件 ${report.areaFiles}＋旁注索引 1）；记录类 ${report.schemaCount}/${FROZEN_RECORD_TYPE_COUNT}；AREA ${report.areaCount}/${FROZEN_AREA_COUNT}；id 关键字命中 ${report.idCount}`,
  ]
  for (const warning of report.warnings) lines.push(`WARN ${warning}`)
  for (const finding of report.findings) lines.push(`FAIL ${finding.path} —— ${finding.message}`)
  lines.push(
    report.ok
      ? '结论：PASS（工件与当前 zod 形状逐字节一致，零漂移；工件零 id 关键字）'
      : `结论：FAIL（${report.findings.length} 项漂移；修法＝改 zod 后重新冻结（--write）须走提案流——DEC-13-11）`,
  )
  return `${lines.join('\n')}\n`
}
