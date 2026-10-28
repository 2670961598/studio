/**
 * artifacts.test.ts —— 冻结 JSON Schema 工件与漂移检查（MIG-03 / IMPL-03-05）
 *
 * 依据：plan/05 IMPL-03-05 验收口径（`bun run contract:check` exit 0｜`test:v2 -- packages/contract` 绿｜
 *   `typecheck:v2` 零错｜工件落位且零 `$id`）；DEC-13-11（离线生成冻结工件、禁运行时重生成）；
 *   DEC-OPEN-15（未批不发 `$id`）；v2/16 §三 contract 行；v2/10 §4.1（`schemaRef`/`specVersion`）/§1.1/§3.1；
 *   v2/11 §一（74 类）／§0.9（13 AREA 封闭）。
 *
 * 断言五面（不依赖 `bun run contract:check` 子进程；直接导入检查器跑一遍——单书允许的验收形态）：
 *   ① 13 AREA 覆盖＝§一 74 类（无重复/无遗漏/无异类）；
 *   ② 工件落位：13 AREA 数据件＋index.json，各件根方言/`$defs` 类目序/`recordType` const 自洽；
 *   ③ 旁注索引：版本/生成时间/74 类/来源文件/零 id 策略/逐件 sha-256 复算；
 *   ④ 零 id 关键字（原文 `"$id"` 与结构键位双口径）；
 *   ⑤ 检查器 PASS＋两条负例（改一个 schema／删一件 → 必红），并核 `contract:check` 脚本在册。
 *
 * 边界：本文件只读工件；负例在系统临时目录的副本上做（不写仓内工件、不改 records/ports、不碰 cases.json）。
 */
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ALL_RECORD_TYPES, RECORD_TYPE_COUNT } from '../../../src/records/index.ts'
import {
  ARTIFACT_AREAS,
  ARTIFACT_INDEX_FILE,
  ARTIFACT_KIND,
  ARTIFACT_RECORDS_DIR,
  ARTIFACT_VERSION,
  FROZEN_AREA_COUNT,
  FROZEN_RECORD_TYPE_COUNT,
  JSON_SCHEMA_DIALECT,
  SPEC_VERSION,
  checkAreaCoverage,
  checkArtifacts,
  defaultArtifactsDir,
} from '../../../src/artifacts/index.ts'

/** 工件目录（本包 artifacts/；由检查器同款口径给出） */
const ARTIFACTS_DIR = defaultArtifactsDir()
/** 仓根（本文件位 packages/contract/test/v2/artifacts/ → 上五级） */
const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url))
/** 13 个 AREA 数据件的件相对路径（records/<area>.schema.json） */
const DATA_FILES: readonly string[] = ARTIFACT_AREAS.map((area) => `${ARTIFACT_RECORDS_DIR}/${area.file}`)
/** 被禁的 JSON Schema 身份关键字（DEC-OPEN-15） */
const ID_KEY = '$id'

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('期望 JSON 对象')
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('期望 JSON 数组')
  return value
}

function readJson(path: string): Record<string, unknown> {
  return asRecord(JSON.parse(readFileSync(path, 'utf8')))
}

/** 递归列文件（件相对 posix；跳过点文件） */
function listFiles(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

/** 递归数键名出现次数（结构口径） */
function countIdKeys(value: unknown, depth = 0): number {
  if (depth > 64 || value === null || typeof value !== 'object') return 0
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + countIdKeys(item, depth + 1), 0)
  let count = 0
  for (const [key, memberValue] of Object.entries(asRecord(value))) {
    if (key === ID_KEY) count += 1
    count += countIdKeys(memberValue, depth + 1)
  }
  return count
}

describe('冻结 JSON Schema 工件（MIG-03 / IMPL-03-05）', () => {
  it('13 AREA 覆盖恰为 §一 74 类（无重复/无遗漏/无异类）', () => {
    expect(checkAreaCoverage()).toEqual([])
    expect(ARTIFACT_AREAS.length).toBe(FROZEN_AREA_COUNT)
    const flattened = ARTIFACT_AREAS.flatMap((area) => [...area.types])
    expect(flattened.length).toBe(FROZEN_RECORD_TYPE_COUNT)
    expect(flattened.length).toBe(RECORD_TYPE_COUNT)
    expect(new Set(flattened).size).toBe(FROZEN_RECORD_TYPE_COUNT)
    expect([...flattened].sort()).toEqual([...ALL_RECORD_TYPES].sort())
    // 13 个 AREA 件名互不重复（每族一件，族名即文件名前缀）
    expect(new Set(DATA_FILES).size).toBe(FROZEN_AREA_COUNT)
  })

  it('工件落位：13 AREA 数据件＋index.json，各件根方言/类目序/recordType const 自洽', () => {
    expect(listFiles(ARTIFACTS_DIR)).toEqual([ARTIFACT_INDEX_FILE, ...DATA_FILES].sort())
    let total = 0
    for (const area of ARTIFACT_AREAS) {
      const text = readFileSync(join(ARTIFACTS_DIR, ARTIFACT_RECORDS_DIR, area.file), 'utf8')
      const doc = asRecord(JSON.parse(text))
      expect(doc['$schema']).toBe(JSON_SCHEMA_DIALECT)
      expect(String(doc['title'])).toContain(area.area)
      const defs = asRecord(doc['$defs'])
      expect(Object.keys(defs)).toEqual([...area.types])
      for (const recordType of area.types) {
        const def = asRecord(defs[recordType])
        expect(def['type']).toBe('object')
        expect(def['additionalProperties']).toBe(false)
        const properties = asRecord(def['properties'])
        expect(asRecord(properties['recordType'])['const']).toBe(recordType)
      }
      const oneOf = asArray(doc['oneOf']).map((entry) => asRecord(entry)['$ref'])
      expect(oneOf).toEqual(area.types.map((recordType) => `#/$defs/${recordType}`))
      total += Object.keys(defs).length
    }
    expect(total).toBe(FROZEN_RECORD_TYPE_COUNT)
    expect(total).toBe(ALL_RECORD_TYPES.length)
  })

  it('旁注索引：版本/生成时间/74 类/来源/零 id 策略/逐件 sha-256 在册', () => {
    const indexPath = join(ARTIFACTS_DIR, ARTIFACT_INDEX_FILE)
    const text = readFileSync(indexPath, 'utf8')
    const index = asRecord(JSON.parse(text))
    expect(index['artifactKind']).toBe(ARTIFACT_KIND)
    expect(index['artifactVersion']).toBe(ARTIFACT_VERSION)
    expect(index['specVersion']).toBe(SPEC_VERSION)
    expect(String(index['artifactVersion'])).toMatch(/^\d+\.\d+\.\d+$/)
    const generatedAt = String(index['generatedAt'])
    expect(Number.isNaN(Date.parse(generatedAt))).toBe(false)
    expect(String(index['sourceCommit'])).toMatch(/^[0-9a-f]{40}$/)
    expect(index['schemaCount']).toBe(FROZEN_RECORD_TYPE_COUNT)
    expect(index['areaCount']).toBe(FROZEN_AREA_COUNT)
    expect(index['recordTypes']).toEqual([...ALL_RECORD_TYPES])

    // 零 id 策略在册（DEC-OPEN-15）：工件不自封公共身份
    const policy = asRecord(index['schemaIdPolicy'])
    expect(policy['emitted']).toBe(false)
    expect(policy['count']).toBe(0)
    expect(String(policy['basis'])).toContain('DEC-OPEN-15')

    // 来源文件：仓相对 posix、不得出现本机路径
    const sourceFiles = asArray(index['sourceFiles']).map(String)
    expect(sourceFiles.length).toBeGreaterThan(0)
    for (const source of sourceFiles) {
      expect(source.startsWith('packages/contract/src/records/')).toBe(true)
      expect(source.startsWith('/')).toBe(false)
      expect(source.includes('\\')).toBe(false)
    }
    expect(text.includes(REPO_ROOT)).toBe(false)

    // 逐件摘要复算（sha-256 of UTF-8 bytes）
    const entries = asArray(index['files']).map(asRecord)
    expect(entries.length).toBe(FROZEN_AREA_COUNT)
    let sum = 0
    for (const entry of entries) {
      const rel = String(entry['file'])
      expect(DATA_FILES).toContain(rel)
      const dataText = readFileSync(join(ARTIFACTS_DIR, rel), 'utf8')
      expect(entry['bytes']).toBe(Buffer.byteLength(dataText, 'utf8'))
      expect(entry['sha256']).toBe(createHash('sha256').update(dataText, 'utf8').digest('hex'))
      sum += Number(entry['schemaCount'])
    }
    expect(sum).toBe(FROZEN_RECORD_TYPE_COUNT)
  })

  it('零 id 关键字：14 件原文与结构双口径均为 0（DEC-OPEN-15）', () => {
    const files = listFiles(ARTIFACTS_DIR)
    expect(files.length).toBe(FROZEN_AREA_COUNT + 1)
    let structural = 0
    for (const rel of files) {
      const text = readFileSync(join(ARTIFACTS_DIR, rel), 'utf8')
      expect(text.split(`"${ID_KEY}"`).length - 1).toBe(0)
      structural += countIdKeys(JSON.parse(text))
    }
    expect(structural).toBe(0)
  })

  it('漂移检查器对当前工件 PASS：74 类/13 AREA/14 件/零 id（直接导入跑一遍）', () => {
    const report = checkArtifacts()
    expect(report.findings).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.checkedFiles).toBe(FROZEN_AREA_COUNT + 1)
    expect(report.areaFiles).toBe(FROZEN_AREA_COUNT)
    expect(report.schemaCount).toBe(FROZEN_RECORD_TYPE_COUNT)
    expect(report.areaCount).toBe(FROZEN_AREA_COUNT)
    expect(report.idCount).toBe(0)
  })

  it('漂移检查器判得出漂移（负例：改一个数据件的最小长度 → 红且定位到件）', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'contract-artifacts-drift-'))
    try {
      const tempArtifacts = join(tempRoot, 'artifacts')
      cpSync(ARTIFACTS_DIR, tempArtifacts, { recursive: true })
      const target = join(tempArtifacts, ARTIFACT_RECORDS_DIR, 'acc.schema.json')
      const original = readFileSync(target, 'utf8')
      expect(original.includes('"minLength": 1')).toBe(true)
      const mutated = original.replace('"minLength": 1', '"minLength": 2')
      expect(mutated).not.toBe(original)
      writeFileSync(target, mutated, 'utf8')

      const report = checkArtifacts({ artifactsDir: tempArtifacts })
      expect(report.ok).toBe(false)
      expect(report.findings.some((finding) => finding.path === 'records/acc.schema.json')).toBe(true)
      expect(report.findings.some((finding) => finding.message.includes('内容漂移'))).toBe(true)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('漂移检查器判得出缺件（负例：删一个数据件 → 红）', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'contract-artifacts-missing-'))
    try {
      const tempArtifacts = join(tempRoot, 'artifacts')
      cpSync(ARTIFACTS_DIR, tempArtifacts, { recursive: true })
      rmSync(join(tempArtifacts, ARTIFACT_RECORDS_DIR, 'perf.schema.json'))
      const report = checkArtifacts({ artifactsDir: tempArtifacts })
      expect(report.ok).toBe(false)
      expect(report.findings.some((finding) => finding.path === 'records/perf.schema.json' && finding.message.includes('缺件'))).toBe(true)
      expect(report.schemaCount).toBeLessThan(FROZEN_RECORD_TYPE_COUNT)
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  it('contract:check 在根与包 manifest 在册，且入口文件存在', () => {
    const rootPkg = readJson(join(REPO_ROOT, 'package.json'))
    const rootScripts = asRecord(rootPkg['scripts'])
    expect(typeof rootScripts['contract:check']).toBe('string')
    expect(String(rootScripts['contract:check'])).toContain('packages/contract/src/artifacts/cli.ts')

    const pkgPkg = readJson(join(REPO_ROOT, 'packages/contract/package.json'))
    const pkgScripts = asRecord(pkgPkg['scripts'])
    expect(typeof pkgScripts['contract:check']).toBe('string')
    expect(String(pkgScripts['contract:check'])).toContain('src/artifacts/cli.ts')

    expect(existsSync(join(REPO_ROOT, 'packages/contract/src/artifacts/cli.ts'))).toBe(true)
  })
})
