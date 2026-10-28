/**
 * backup —— DOM-04 `cost_daily` 备份快照（只备份不重放；备份=恢复语义，非重建语义）
 *
 * 依据：docs/v2/16 §四（cost_daily 迁移处置：限域声明/备份快照/排除域清单/负向用例）、
 *       docs/v2/05 §三 DOM-04、plan/05 IMPL-04-03/04、v2/17 NEG-MIG-01/02。
 *
 * 纪律：
 *   - **只读源表**：本文件对 cost_daily 只发 SELECT；不 INSERT/UPDATE/DELETE（源表两枚
 *     append-only 触发器亦拒改，NEG-MIG-01 另测在库侧）。
 *   - **JSONL 稳定形**：一行一条 cost_daily 全列；键序固定（COST_DAILY_BACKUP_COLUMNS），
 *     行序固定 (cost_date, person_id, model, id) 升序（与 listCostDaily 同序）——同库同内容
 *     恒同字节，sha256 可复算。缺值列写 null（不省键），恢复方可逐列还原。
 *   - **sha256 侧车**：写 `<out>.sha256`，内容 `<hex>  <basename>\n`（sha256sum 可读形）；
 *     返回值同时给摘要，两侧一致才算备份完成。
 *   - **不重放**：备份件绝不进入 rebuild/drill 的重放路径；恢复须人工显式执行。对账规则
 *     未决（v2/17 GAP-V2-01）——备份恢复值与事件账投影值分列（NEG-MIG-02），不静默抹平。
 *   - **排除域清单单点定义**：EXCLUDED_DOMAINS / EXCLUDED_DOMAIN_REASONS 在本文件定义，
 *     rebuild / drill / dump 三处报告共用 excludedDomainRefs / renderExcludedDomainsSection
 *     （ledger.ts 反向引本文件取 dump 报告段——本文件不引 ledger，无环）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { configInvalid } from '@studio-next/contract'
import { str, type SqlRow } from './row-helpers.ts'

// ---------------------------------------------------------------------------
// 排除域清单（rebuild / drill / dump 报告唯一源；v2/16 §四 / v2/05 §三 DOM-04）
// ---------------------------------------------------------------------------

export const COST_DAILY_DOMAIN = 'cost_daily'

/** rebuild/drill/dump 的重放范围只有 events；此清单内的域一律只备份不重放 */
export const EXCLUDED_DOMAINS: readonly string[] = Object.freeze([COST_DAILY_DOMAIN])

/**
 * 排除理由（报告原文）：定型账 + 遗留不可重建 + 备份≠重建。措辞固定，供三处报告复用，
 * 任何重建/演练报告不得据此声称钱账已重建（v2/16 §四.2）。
 */
export const COST_DAILY_EXCLUSION_REASON =
  'DOM-04 历史钱账：cost_daily 为定型 append-only 账，只备份不重放，遗留不可重建（v2/16 §四；84b 抉择 7）——备份=恢复语义，非重建语义，报告不得把备份写作钱账重建完成'

export const EXCLUDED_DOMAIN_REASONS: Readonly<Record<string, string>> = Object.freeze({
  [COST_DAILY_DOMAIN]: COST_DAILY_EXCLUSION_REASON,
})

/** 备份件引用（报告只引路径/摘要/行数，不内嵌数据） */
export interface CostDailyBackupRef {
  readonly path: string
  readonly sha256: string
  readonly lines: number
}

/** 排除域条目：domain + 理由 + 备份引用（未生成备份时无 backup 键——报告如实写「未生成」） */
export interface ExcludedDomainRef {
  readonly domain: string
  readonly reason: string
  readonly backup?: CostDailyBackupRef
}

/** 排除域条目表（rebuild/drill/dump 报告共用；给出 backup 时挂到 cost_daily 条目） */
export function excludedDomainRefs(backup?: CostDailyBackupRef): readonly ExcludedDomainRef[] {
  return EXCLUDED_DOMAINS.map((domain) => {
    const reason = EXCLUDED_DOMAIN_REASONS[domain] ?? '未登记理由（禁止静默排除）'
    return backup === undefined || domain !== COST_DAILY_DOMAIN ? { domain, reason } : { domain, reason, backup }
  })
}

/** 「排除域」报告段（dump/drill/rebuild 同内容：域清单 / 理由 / 备份路径与 sha256 引用） */
export function renderExcludedDomainsSection(refs: readonly ExcludedDomainRef[]): string[] {
  if (refs.length === 0) return ['排除域：无（重放范围只有 events）']
  const lines: string[] = [`排除域：${refs.map((ref) => ref.domain).join('、')}（不重放；重建/导出范围只有 events）`]
  for (const ref of refs) {
    lines.push(`排除域理由：${ref.reason}`)
    if (ref.backup === undefined) {
      lines.push(`排除域备份：${ref.domain} 未随本次操作生成（备份=恢复语义；backupCostDaily → JSONL＋<out>.sha256）`)
    } else {
      lines.push(`排除域备份：${ref.domain} → ${ref.backup.path}（${ref.backup.lines} 行；sha256=${ref.backup.sha256}）`)
    }
  }
  return lines
}

/** dump 报告的结构面（结构化入参——本文件不反向依赖 ledger.ts，无环） */
export interface DumpReportView {
  readonly lines: number
  readonly excludedDomains: readonly ExcludedDomainRef[]
}

/** dump 报告渲染（人读；排除域段与 rebuild/drill 同源——cost_daily 不重放） */
export function renderDumpReport(view: DumpReportView, outPath?: string): string[] {
  const where = outPath === undefined ? '' : ` → ${outPath}`
  return [`已导出 ${view.lines} 行${where}`, ...renderExcludedDomainsSection(view.excludedDomains)]
}

// ---------------------------------------------------------------------------
// cost_daily 备份（JSONL + sha256；只读源表）
// ---------------------------------------------------------------------------

/**
 * 备份列冻结键序（= v12 DDL 列序；JSONL 每行按此序输出）。
 * 列集漂移由 assertFrozenColumns 拒——备份件须显式升级，不静默漏列。
 */
export const COST_DAILY_BACKUP_COLUMNS = [
  'id',
  'company',
  'person_id',
  'model',
  'cost_date',
  'tokens_in',
  'tokens_out',
  'cache_read',
  'cache_creation',
  'price_snapshot_id',
  'cost_usd',
  'basis',
  'kind',
  'adjusts_id',
  'closed_at',
  'closed_by',
  'note',
] as const

/** 一行备份记录（恢复行；与 COST_DAILY_BACKUP_COLUMNS 同列同序） */
export interface CostDailyBackupRow {
  id: string
  company: string
  person_id: string
  model: string
  cost_date: string
  tokens_in: number
  tokens_out: number
  cache_read: number
  cache_creation: number
  price_snapshot_id: string
  cost_usd: number
  basis: string
  kind: string
  adjusts_id: string | null
  closed_at: number
  closed_by: string
  note: string | null
}

/** backupCostDaily 结果：domain/path/sha256/lines + 侧车路径 */
export interface CostDailyBackupResult extends CostDailyBackupRef {
  readonly domain: typeof COST_DAILY_DOMAIN
  readonly digestPath: string
}

/** verifyBackup 结果：ok=复算摘要与期望一致；lines=备份件非空行数 */
export interface BackupVerifyResult {
  readonly ok: boolean
  readonly path: string
  readonly expected: string
  readonly actual: string
  readonly lines: number
}

/** 摘要（UTF-8 文本；导出供测试/调用方复算，不引入第二实现） */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 导出 cost_daily 为 JSONL + `<outPath>.sha256` 侧车。
 * **只读源表**（SELECT only），不写库、不改行；返回前已在返回值与侧车双写摘要。
 */
export function backupCostDaily(db: DatabaseSync, outPath: string): CostDailyBackupResult {
  if (typeof outPath !== 'string' || outPath.trim() === '') {
    configInvalid('store/backup:bad-path', '备份输出路径须为非空字符串')
  }
  assertFrozenColumns(db)
  // 行序与 listCostDaily 同序：稳定输出（同库同内容 → 同字节 → 同 sha256）
  const sql = `SELECT ${COST_DAILY_BACKUP_COLUMNS.join(', ')} FROM cost_daily ORDER BY cost_date ASC, person_id ASC, model ASC, id ASC`
  const rows = db.prepare(sql).all() as SqlRow[]
  const text = rows.map((row) => JSON.stringify(rowFromSql(row))).join('\n') + (rows.length > 0 ? '\n' : '')
  writeFileSync(outPath, text, 'utf8')
  const sha256 = sha256Hex(text)
  const digestPath = `${outPath}.sha256`
  writeFileSync(digestPath, `${sha256}  ${path.basename(outPath)}\n`, 'utf8')
  return { domain: COST_DAILY_DOMAIN, path: outPath, sha256, lines: rows.length, digestPath }
}

/**
 * 校验备份件：复算文件摘要并与期望比对（接受裸 hex 或 `sha256:` 前缀）。
 * 不解析内容语义——行数按 JSONL 非空行计；行内容形状由 readCostDailyBackup 闸。
 */
export function verifyBackup(backupPath: string, expectedSha256: string): BackupVerifyResult {
  const expected = normalizeSha256(expectedSha256)
  const text = readBackupText(backupPath)
  const actual = sha256Hex(text)
  const lines = text === '' ? 0 : text.split('\n').filter((line) => line !== '').length
  return { ok: actual === expected, path: backupPath, expected, actual, lines }
}

/** 读回备份行（恢复语义；逐行 JSON 解析 + 列集闸；空文件=0 行） */
export function readCostDailyBackup(backupPath: string): CostDailyBackupRow[] {
  const text = readBackupText(backupPath)
  const out: CostDailyBackupRow[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined || line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (err) {
      configInvalid('store/backup:bad-line', `备份件第 ${i + 1} 行 JSON 解析失败：${errorMessage(err)}`)
    }
    out.push(parseBackupRow(parsed, i + 1))
  }
  return out
}

// ---------------------------------------------------------------------------
// 内部件
// ---------------------------------------------------------------------------

/** 列集冻结闸：cost_daily 实际列序必须与备份列序逐列一致（漂移=备份件需显式升级） */
function assertFrozenColumns(db: DatabaseSync): void {
  let rows: SqlRow[]
  try {
    rows = db.prepare('PRAGMA table_info(cost_daily)').all() as SqlRow[]
  } catch (err) {
    configInvalid('store/backup:no-table', `cost_daily 不可读（库是否已迁移到 v12？）：${errorMessage(err)}`)
  }
  const actual = rows.map((row) => String(row['name']))
  const expected: readonly string[] = COST_DAILY_BACKUP_COLUMNS
  if (actual.length !== expected.length || actual.some((name, i) => name !== expected[i])) {
    configInvalid(
      'store/backup:column-drift',
      `cost_daily 列集=${actual.join(',')} 与备份列集=${expected.join(',')} 不一致（备份件须显式升级，不静默漏列）`,
    )
  }
}

function rowFromSql(row: SqlRow): CostDailyBackupRow {
  return {
    id: str(row, 'id'),
    company: str(row, 'company'),
    person_id: str(row, 'person_id'),
    model: str(row, 'model'),
    cost_date: str(row, 'cost_date'),
    tokens_in: Number(row['tokens_in']),
    tokens_out: Number(row['tokens_out']),
    cache_read: Number(row['cache_read']),
    cache_creation: Number(row['cache_creation']),
    price_snapshot_id: str(row, 'price_snapshot_id'),
    cost_usd: Number(row['cost_usd']),
    basis: str(row, 'basis'),
    kind: str(row, 'kind'),
    adjusts_id: nullOrStr(row['adjusts_id']),
    closed_at: Number(row['closed_at']),
    closed_by: str(row, 'closed_by'),
    note: nullOrStr(row['note']),
  }
}

function parseBackupRow(input: unknown, lineNo: number): CostDailyBackupRow {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    configInvalid('store/backup:bad-row', `备份件第 ${lineNo} 行须为 JSON 对象`)
  }
  const raw = input as Record<string, unknown>
  const missing = COST_DAILY_BACKUP_COLUMNS.filter((key) => !(key in raw))
  if (missing.length > 0) {
    configInvalid('store/backup:bad-row', `备份件第 ${lineNo} 行缺列：${missing.join(',')}`)
  }
  return {
    id: requireStr(raw, 'id', lineNo),
    company: requireStr(raw, 'company', lineNo),
    person_id: requireStr(raw, 'person_id', lineNo),
    model: requireStr(raw, 'model', lineNo),
    cost_date: requireStr(raw, 'cost_date', lineNo),
    tokens_in: requireNum(raw, 'tokens_in', lineNo),
    tokens_out: requireNum(raw, 'tokens_out', lineNo),
    cache_read: requireNum(raw, 'cache_read', lineNo),
    cache_creation: requireNum(raw, 'cache_creation', lineNo),
    price_snapshot_id: requireStr(raw, 'price_snapshot_id', lineNo),
    cost_usd: requireNum(raw, 'cost_usd', lineNo),
    basis: requireStr(raw, 'basis', lineNo),
    kind: requireStr(raw, 'kind', lineNo),
    adjusts_id: requireNullableStr(raw, 'adjusts_id', lineNo),
    closed_at: requireNum(raw, 'closed_at', lineNo),
    closed_by: requireStr(raw, 'closed_by', lineNo),
    note: requireNullableStr(raw, 'note', lineNo),
  }
}

/** 类型闸：坏类型即拒（不做 String()/Number() 静默强转——「不静默抹平」含值类型面） */
function requireStr(raw: Record<string, unknown>, key: string, lineNo: number): string {
  const value = raw[key]
  if (typeof value !== 'string') {
    configInvalid('store/backup:bad-row', `备份件第 ${lineNo} 行 ${key} 须为字符串（实际 ${typeof value}）`)
  }
  return value
}

function requireNum(raw: Record<string, unknown>, key: string, lineNo: number): number {
  const value = raw[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    configInvalid('store/backup:bad-row', `备份件第 ${lineNo} 行 ${key} 须为有限数值（实际 ${typeof value}）`)
  }
  return value
}

function requireNullableStr(raw: Record<string, unknown>, key: string, lineNo: number): string | null {
  const value = raw[key]
  if (value === null) return null
  if (typeof value !== 'string') {
    configInvalid('store/backup:bad-row', `备份件第 ${lineNo} 行 ${key} 须为字符串或 null（实际 ${typeof value}）`)
  }
  return value
}

function nullOrStr(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function readBackupText(backupPath: string): string {
  try {
    return readFileSync(backupPath, 'utf8')
  } catch (err) {
    configInvalid('store/backup:missing', `备份件不可读（${backupPath}）：${errorMessage(err)}`)
  }
}

function normalizeSha256(value: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const bare = trimmed.startsWith('sha256:') ? trimmed.slice('sha256:'.length) : trimmed
  if (!/^[0-9a-fA-F]{64}$/.test(bare)) {
    configInvalid('store/backup:bad-sha256', `sha256 须为 64 位十六进制（可带 sha256: 前缀）：${String(value)}`)
  }
  return bare.toLowerCase()
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
