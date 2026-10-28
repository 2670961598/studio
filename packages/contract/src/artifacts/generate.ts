/**
 * 冻结 JSON Schema 工件的离线生成器（MIG-03 / IMPL-03-05）
 *
 * 依据链（实现单必须引用文档章节号——AGENTS §五.1）：
 *   - DEC-13-11（v2/09 §5.4 索引；v2/13 §六）：zod 只是**参考 authoring**，冻结交换工件
 *     **只许离线生成**，禁运行时重生成权威工件、禁 `z.fromJSONSchema()` 反向生成；
 *   - DEC-OPEN-15（v2/09 §5.3）：公共 namespace 登记者未设 → **未批不发 `$id`**；
 *   - v2/10 §4.1（工件身份＝`schemaRef {schemaId: dotid, schemaVersion: semver}`，不靠 `$id`）、
 *     §1.1（token/dotid/semver 标量语法）、§1.2（`studio-next` 保留段）、§3.1（唯一交换编码＝JSON）、
 *     §十一 待决表第 2 项（schema 冻结＝本单落位，命名/分发仍待决）；
 *   - v2/16 §三 contract 行（zod 降参考 authoring＋冻结工件离线生成＋漂移检查）；
 *   - v2/11 §一（74 类唯一登记处）、§0.9（13 AREA 登记处，封闭）；
 *   - plan/05 IMPL-03-05（领土与验收口径）、plan/03 §四（MIG-03 四步序③）、plan/04 §MIG-03 行。
 *
 * 纪律（本文件是**离线生成器**，不是运行时组件）：
 *   - 唯一写工件路径＝`cli.ts --write`；检查路径只做内存重生成＋逐字节比对（禁运行时重生成）；
 *   - 生成确定性：同一 zod 版本 → 同字节。冻结期元数据（生成时间/来源 commit）只进旁注索引，
 *     不参与内容比对（见 check.ts），故 `--check` 不因时钟或提交前进而变红；
 *   - 工件内不写本机路径：来源文件一律仓相对 posix 路径；工件内不发 `$id`、不写环境信息。
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { z } from 'zod'
import type { ZodType } from 'zod'
import {
  ACC_RECORD_SCHEMAS,
  ACC_RECORD_TYPES,
  ALL_RECORD_TYPES,
  ASSET_RECORD_SCHEMAS,
  ASSET_RECORD_TYPES,
  AUTH_RECORD_SCHEMAS,
  AUTH_RECORD_TYPES,
  CAP_RECORD_SCHEMAS,
  CAP_RECORD_TYPES,
  CHG_RECORD_SCHEMAS,
  CHG_RECORD_TYPES,
  EVD_RECORD_SCHEMAS,
  EVD_RECORD_TYPES,
  EVAL_RECORD_SCHEMAS,
  EVAL_RECORD_TYPES,
  LIFE_RECORD_SCHEMAS,
  LIFE_RECORD_TYPES,
  MEM_RECORD_SCHEMAS,
  MEM_RECORD_TYPES,
  OBS_RECORD_SCHEMAS,
  OBS_RECORD_TYPES,
  PERF_RECORD_SCHEMAS,
  PERF_RECORD_TYPES,
  RECORD_TYPE_COUNT,
  REV_RECORD_SCHEMAS,
  REV_RECORD_TYPES,
  WORK_RECORD_SCHEMAS,
  WORK_RECORD_TYPES,
} from '../records/index.ts'

// —— §1 冻结常量（工件自身的版本与口径；与 V2 规范版本分账） ——

/** 工件使用的 JSON Schema 方言（v2/10 §〇：draft 2020-12 仅作 schema 的**表述载体**） */
export const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** 冻结工件版本（工件自身的 artifactVersion；不是 V2 规范版本，也不是记录类型版本） */
export const ARTIFACT_VERSION = '1.0.0'

/** 依循的 V2 规范版本（v2/10 §4.1 `specVersion` 示例 `2.0.0`——按 §1.1 semver 三段合法） */
export const SPEC_VERSION = '2.0.0'

/** v2/11 §一 复算冻结值：74 类 / 13 AREA（漂移检查在册比对，变了就红） */
export const FROZEN_RECORD_TYPE_COUNT = 74
export const FROZEN_AREA_COUNT = 13

/** 旁注索引文件名与数据件目录名（相对 artifacts/） */
export const ARTIFACT_INDEX_FILE = 'index.json'
export const ARTIFACT_RECORDS_DIR = 'records'

/**
 * 工件类别自述（**不是**公共 namespace 身份）：公共工件命名/分发属制作人待决
 * （v2/10 §十一 待决表第 3 项、DEC-OPEN-15），本单不臆造 `schemaId`。
 */
export const ARTIFACT_KIND = 'frozen-json-schema'

/** 工件域（旁注索引人读行；数据面精度以 `recordTypes`/`files` 为准） */
export const ARTIFACT_DOMAIN = 'v2/11 运行记录 13 AREA / 74 类（冻结记录形状）'

/** 生成命令与检查命令（写进旁注索引，供复算者照抄） */
export const GENERATE_COMMAND = 'node packages/contract/src/artifacts/cli.ts --write'
export const CHECK_COMMAND = 'bun run contract:check'

/**
 * 工件来源文件（仓相对 posix 路径；**不写本机路径**）。
 * 计 20 件＝records 分区出口/信封/通用骨架/13 族件（work 超 600 行拆四件）。
 */
export const RECORD_SOURCE_FILES: readonly string[] = [
  'packages/contract/src/records/index.ts',
  'packages/contract/src/records/envelope.ts',
  'packages/contract/src/records/common.ts',
  'packages/contract/src/records/auth.ts',
  'packages/contract/src/records/life.ts',
  'packages/contract/src/records/perf.ts',
  'packages/contract/src/records/work.ts',
  'packages/contract/src/records/work-intent.ts',
  'packages/contract/src/records/work-state.ts',
  'packages/contract/src/records/work-exec.ts',
  'packages/contract/src/records/work-close.ts',
  'packages/contract/src/records/evd.ts',
  'packages/contract/src/records/acc.ts',
  'packages/contract/src/records/chg.ts',
  'packages/contract/src/records/cap.ts',
  'packages/contract/src/records/rev.ts',
  'packages/contract/src/records/eval.ts',
  'packages/contract/src/records/asset.ts',
  'packages/contract/src/records/obs.ts',
  'packages/contract/src/records/mem.ts',
]

/** 结构自检条目（漂移检查/测试共用；`path` 为仓内相对位或记录类型） */
export interface ArtifactIssue {
  path: string
  message: string
}

// —— §2 13 AREA 分件表（序即 v2/11 §一 表序；每族件名 `<area>.schema.json`） ——

/** 一个 AREA 数据件的来源描述（族名/文件名/类目序/schema 闸） */
export interface RecordAreaSpec {
  /** 13 AREA 名（v2/11 §0.9 封闭集） */
  area: string
  /** 族名（v2/11 §一 节标题原文口径） */
  label: string
  /** 数据件文件名（相对 artifacts/records/） */
  file: string
  /** 本族类目（序即 v2/11 §一 表序） */
  types: readonly string[]
  /** 形状闸（records 分区各族导出；一类一 schema，值为整记录信封＋payload） */
  schemas: Readonly<Record<string, ZodType>>
}

export const ARTIFACT_AREAS: readonly RecordAreaSpec[] = [
  {
    area: 'AUTH',
    label: 'AUTH 权责族（含 §2.1 通用骨架 CMD/DEC/RCP/COR/EVT 8 类，合计 16 类）',
    file: 'auth.schema.json',
    types: AUTH_RECORD_TYPES,
    schemas: AUTH_RECORD_SCHEMAS,
  },
  { area: 'LIFE', label: 'LIFE 生命周期族（任职 01..06＋组织 07..11，11 类）', file: 'life.schema.json', types: LIFE_RECORD_TYPES, schemas: LIFE_RECORD_SCHEMAS },
  { area: 'PERF', label: 'PERF 绩效族（1 类）', file: 'perf.schema.json', types: PERF_RECORD_TYPES, schemas: PERF_RECORD_SCHEMAS },
  { area: 'WORK', label: 'WORK 任务族（21 类）', file: 'work.schema.json', types: WORK_RECORD_TYPES, schemas: WORK_RECORD_SCHEMAS },
  { area: 'EVD', label: 'EVD 证据族（6 类）', file: 'evd.schema.json', types: EVD_RECORD_TYPES, schemas: EVD_RECORD_SCHEMAS },
  { area: 'ACC', label: 'ACC 问责救济族（2 类）', file: 'acc.schema.json', types: ACC_RECORD_TYPES, schemas: ACC_RECORD_SCHEMAS },
  { area: 'CHG', label: 'CHG 变更链族（1 类）', file: 'chg.schema.json', types: CHG_RECORD_TYPES, schemas: CHG_RECORD_SCHEMAS },
  { area: 'CAP', label: 'CAP 能力供给族（4 类）', file: 'cap.schema.json', types: CAP_RECORD_TYPES, schemas: CAP_RECORD_SCHEMAS },
  { area: 'REV', label: 'REV 复盘族（1 类）', file: 'rev.schema.json', types: REV_RECORD_TYPES, schemas: REV_RECORD_SCHEMAS },
  { area: 'EVAL', label: 'EVAL 结构评价族（1 类）', file: 'eval.schema.json', types: EVAL_RECORD_TYPES, schemas: EVAL_RECORD_SCHEMAS },
  { area: 'ASSET', label: 'ASSET 资产族（2 类）', file: 'asset.schema.json', types: ASSET_RECORD_TYPES, schemas: ASSET_RECORD_SCHEMAS },
  { area: 'OBS', label: 'OBS 观察族（4 类）', file: 'obs.schema.json', types: OBS_RECORD_TYPES, schemas: OBS_RECORD_SCHEMAS },
  { area: 'MEM', label: 'MEM 记忆族（4 类）', file: 'mem.schema.json', types: MEM_RECORD_TYPES, schemas: MEM_RECORD_SCHEMAS },
]

/**
 * 13 AREA 覆盖自检（机械）：并集逐项等于 `ALL_RECORD_TYPES`。
 * 断言四件——无重复、无遗漏、无异类、计数＝冻结值（74/13）；另核每族 schema 闸覆盖其类目。
 */
export function checkAreaCoverage(): ArtifactIssue[] {
  const issues: ArtifactIssue[] = []
  const seen = new Set<string>()
  const flattened: string[] = []
  for (const area of ARTIFACT_AREAS) {
    if (area.types.length === 0) issues.push({ path: area.area, message: 'AREA 类目为空（13 AREA 均须非空）' })
    for (const recordType of area.types) {
      if (seen.has(recordType)) issues.push({ path: recordType, message: `记录类重复登记（AREA ${area.area}；74 类须一一对应）` })
      seen.add(recordType)
      flattened.push(recordType)
      if (area.schemas[recordType] === undefined) issues.push({ path: recordType, message: `AREA ${area.area} 缺形状 schema（形状闸未覆盖该类）` })
    }
  }
  for (const recordType of ALL_RECORD_TYPES) {
    if (!seen.has(recordType)) issues.push({ path: recordType, message: 'AREA 分件遗漏该类（冻结工件须 74 类全覆盖）' })
  }
  for (const recordType of seen) {
    if (!(ALL_RECORD_TYPES as readonly string[]).includes(recordType)) {
      issues.push({ path: recordType, message: '未在 §一 74 类登记处登记（不得新增记录类）' })
    }
  }
  if (flattened.length !== ALL_RECORD_TYPES.length) {
    issues.push({ path: 'records', message: `AREA 并集 ${flattened.length} 类 ≠ 登记处 ${ALL_RECORD_TYPES.length} 类` })
  }
  if (ALL_RECORD_TYPES.length !== FROZEN_RECORD_TYPE_COUNT || RECORD_TYPE_COUNT !== FROZEN_RECORD_TYPE_COUNT) {
    issues.push({ path: 'records', message: `登记处类数 ${RECORD_TYPE_COUNT} ≠ 冻结值 ${FROZEN_RECORD_TYPE_COUNT}（v2/11 §一 复算）` })
  }
  if (ARTIFACT_AREAS.length !== FROZEN_AREA_COUNT) {
    issues.push({ path: 'records', message: `AREA 件数 ${ARTIFACT_AREAS.length} ≠ 冻结值 ${FROZEN_AREA_COUNT}（v2/11 §0.9）` })
  }
  return issues
}

// —— §3 生成（内存；唯一权威来源＝当前 zod 形状） ——

/** 一类记录形状 → JSON Schema 子模式（去掉根 `$schema`：文件根唯一持有，2020-12 资源根纪律） */
export function generateRecordSchema(recordType: string, schema: ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, {
    // 记录由生产者写入、读取方校验：冻结面取 input 侧（本批 74 类无 default/transform，输出等价）
    io: 'input',
    // 不可表示类型（若有）落 `{}` 而不是让生成失败：工件是可校验交换面，不承诺语义
    unrepresentable: 'any',
    target: 'draft-2020-12',
  })
  // 只留 JSON 可序列化面（zod 返回体带不可枚举的 `~standard` 元数据）
  const plain = JSON.parse(JSON.stringify(generated)) as Record<string, unknown>
  delete plain['$schema']
  if (plain['type'] !== 'object') {
    throw new Error(`${recordType}：记录形状必须是 object（实际 ${String(plain['type'])}）——信封形状被破坏`)
  }
  return plain
}

/** 一个 AREA 数据件（合法 JSON Schema 文档：`$defs` 逐类＋`oneOf` 族内联合入口） */
export interface FrozenAreaDoc {
  $schema: string
  title: string
  description: string
  $defs: Record<string, Record<string, unknown>>
  oneOf: readonly { $ref: string }[]
}

/** 数据件固定说明行（不含 id 关键字字面量：冻结面零 id 是验收口径之一） */
function areaDescription(area: RecordAreaSpec): string {
  return [
    `${area.label}。`,
    '离线生成自 packages/contract/src/records 的 zod 形状（DEC-13-11：zod 仅参考 authoring，本文件是冻结交换工件；禁运行时重生成）。',
    '按 $defs 的类目键取单类形状；oneOf 为本族联合入口（各类 recordType 为 const，恒一命中）。',
    '本文件不发 JSON Schema 的 id 关键字（DEC-OPEN-15：公共 namespace 登记者未设，未批不发；工件身份走 schemaRef {schemaId, schemaVersion}——v2/10 §4.1）。',
    `生成时间/来源提交/摘要见 ${ARTIFACT_INDEX_FILE}。`,
  ].join('')
}

/** 生成一个 AREA 数据件（确定性：键序＝类目序，schema 键序＝zod 输出序） */
export function generateAreaDoc(area: RecordAreaSpec): FrozenAreaDoc {
  const defs: Record<string, Record<string, unknown>> = {}
  for (const recordType of area.types) {
    const schema = area.schemas[recordType]
    if (schema === undefined) throw new Error(`AREA ${area.area}：记录类 ${recordType} 缺形状 schema`)
    defs[recordType] = generateRecordSchema(recordType, schema)
  }
  const oneOf = area.types.map((recordType) => ({ $ref: `#/$defs/${recordType}` }))
  return {
    $schema: JSON_SCHEMA_DIALECT,
    title: `Studio Next V2 冻结记录形状 · ${area.area}（${area.types.length} 类）`,
    description: areaDescription(area),
    $defs: defs,
    oneOf,
  }
}

/** 工件序列化（2 空格缩进＋末行换行；逐字节比对的字节口径就是本函数输出） */
export function serializeArtifact(doc: unknown): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

/** UTF-8 字节长度 */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** sha-256（verifiable 摘要口径写入旁注索引，供复算者核对文件字节） */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

// —— §4 旁注索引（版本/生成时间/74 类/来源/零 id） ——

/** 冻结期元数据（唯一不参与内容比对的三项；检查时从磁盘索引回读，保证可复算） */
export interface FreezeMeta {
  /** 生成时间（ISO-8601 带偏移；冻结期元数据，不参与漂移比对） */
  generatedAt: string
  /** 来源 commit（records 形状定稿提交；冻结期元数据，不参与漂移比对） */
  sourceCommit: string
  /** 生成时的 zod 版本（漂移告警用；不参与内容比对——内容差异自有逐字节比对兜底） */
  zodVersion: string
}

/** 索引内单件条目 */
export interface ArtifactFileEntry {
  file: string
  area: string
  schemaCount: number
  recordTypes: readonly string[]
  bytes: number
  sha256: string
}

/** 旁注索引（artifacts/index.json；工件头注的机读形态） */
export interface ArtifactIndex {
  artifactKind: string
  artifactVersion: string
  specVersion: string
  domain: string
  generatedAt: string
  sourceCommit: string
  sourceFiles: readonly string[]
  generator: {
    tool: string
    zodVersion: string
    jsonSchemaDialect: string
    target: string
    io: string
    unrepresentable: string
    command: string
    checkCommand: string
  }
  schemaIdPolicy: {
    emitted: boolean
    count: number
    basis: string
    resolution: string
  }
  schemaCount: number
  areaCount: number
  recordTypes: readonly string[]
  files: readonly ArtifactFileEntry[]
}

/** 构建旁注索引（数据件摘要按同一序列化函数计算；`meta` 由调用方给，检查时从磁盘回读） */
export function buildIndex(meta: FreezeMeta): ArtifactIndex {
  const files: ArtifactFileEntry[] = ARTIFACT_AREAS.map((area) => {
    const text = serializeArtifact(generateAreaDoc(area))
    return {
      file: `${ARTIFACT_RECORDS_DIR}/${area.file}`,
      area: area.area,
      schemaCount: area.types.length,
      recordTypes: [...area.types],
      bytes: utf8ByteLength(text),
      sha256: sha256Hex(text),
    }
  })
  return {
    artifactKind: ARTIFACT_KIND,
    artifactVersion: ARTIFACT_VERSION,
    specVersion: SPEC_VERSION,
    domain: ARTIFACT_DOMAIN,
    generatedAt: meta.generatedAt,
    sourceCommit: meta.sourceCommit,
    sourceFiles: [...RECORD_SOURCE_FILES],
    generator: {
      tool: 'zod',
      zodVersion: meta.zodVersion,
      jsonSchemaDialect: JSON_SCHEMA_DIALECT,
      target: 'draft-2020-12',
      io: 'input',
      unrepresentable: 'any',
      command: GENERATE_COMMAND,
      checkCommand: CHECK_COMMAND,
    },
    schemaIdPolicy: {
      emitted: false,
      count: 0,
      basis: 'DEC-OPEN-15：公共 namespace 登记者未设，未批不发 JSON Schema 的 id 关键字；工件身份走 schemaRef {schemaId, schemaVersion}（v2/10 §4.1）',
      resolution: '命名/发布/公开标签属制作人待决（v2/10 §十一 待决表第 3 项）——本工件不自封公共身份',
    },
    schemaCount: files.reduce((sum, entry) => sum + entry.schemaCount, 0),
    areaCount: files.length,
    recordTypes: [...ALL_RECORD_TYPES],
    files,
  }
}

/** 当前 zod 版本（经 CJS require 读包元数据；读不到记 `unknown`，不阻断离线生成） */
export function resolveZodVersion(): string {
  try {
    const require = createRequire(import.meta.url)
    const pkg: unknown = require('zod/package.json')
    if (typeof pkg === 'object' && pkg !== null) {
      const version = (pkg as { version?: unknown }).version
      if (typeof version === 'string') return version
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 全部工件的仓/件相对路径（索引在根，13 数据件在 records/；序＝类目序） */
export function artifactFilePaths(): string[] {
  return [ARTIFACT_INDEX_FILE, ...ARTIFACT_AREAS.map((area) => `${ARTIFACT_RECORDS_DIR}/${area.file}`)]
}
