/**
 * readonly —— D12「只读打开/围栏」最小实现（PB-5 入口）
 *
 * 依据：
 *   - docs/v2/17 §五 PB-5：入口要求 MIG-04 的 D12 只读打开/围栏；PRB-14 负向登记
 *     「无围栏/`query_only=0`」时不得宣称台账单写；
 *   - docs/80 §8.2（v1 运行时与公共接口）：`openLedgerReadonly` +
 *     `PRAGMA query_only=ON`；只读进程不跑 DDL；缺库/版本偏移的拒绝形状；
 *   - docs/probe/pb-5/report.md：PRB-14 实测 `query_only=0`、`openLedger` 无条件
 *     `migrate`、两进程无框架围栏——本件只清偿「只读打开不跑 DDL / query_only=1」
 *     这一段，不冒充 WriterLease 跨进程写围栏。
 *
 * 语义（与 docs/80 §8.2 对齐）：
 *   1. `new DatabaseSync(path, { readOnly:true })`：缺库时**不建库**；打开后立即
 *      `PRAGMA query_only=ON` 并回读校验（driver.openSqliteReadonly）；
 *   2. **不调用 migrate()、不执行任何 DDL、不设 journal_mode/synchronous**——只读打开
 *      前后库文件字节与 schema_version/sqlite_master 不变（见 test/v2）；
 *   3. schema_version 只读校验：缺表/落后 → `rejected_version`/`EVOLVE_REJECT`/
 *      `schema-behind`；库领先 → 同形 `schema-ahead`；**不自动升级、不静默降级读**；
 *   4. 缺库 → `unavailable`/`STALL`/`db-missing`（不建库）；路径畸形/非文件/
 *      expectedSchemaVersion 非法 → `CONFIG_INVALID`（docs/80 §5.7：CONFIG_INVALID
 *      只给路径/配置缺失或畸形，版本不匹配一律 EVOLVE_REJECT）；
 *   5. 返回的 `ReadOnlyLedger` 只暴露只读句柄与版本，**没有** `Ledger` 的
 *      appendEvent/begin/kvSet 等写方法；`close()` 幂等。
 *
 * 边界（本件不冒充）：
 *   - docs/80 §8.2 目标 face 的 `query/get/payload`（记录面查询、游标、载荷）归后续
 *     记录面刀；本最小实现只提供引擎只读句柄（`db`），调用方在其上执行 SELECT；
 *   - 本件不实现 `WriterLeasePort`/`FenceToken`：PRB-14 的「第二写者被框架围栏拒绝」
 *     仍缺写侧围栏，D12 只给读侧只读打开；不得据本件宣称台账单写已成立。
 *
 * 任务口径冲突（诚实登记）：任务摘要写「缺库/未迁移 → CONFIG_INVALID」，与 docs/80
 * §8.2/§5.7 的明确分类相反；按 AGENTS §五.1「以文档为准、不默许代码漂移」，本件落
 * 文档分类并在测试锁死，未改文档/契约。若产品口径要改为 CONFIG_INVALID，须先走文档
 * 批示流，再同批改实现与测试。
 */
import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type {
  ClassifiedError,
  ErrorCategory,
  FailureCategory,
  Result,
} from '@studio-next/contract'
import { openSqliteReadonly } from './driver.ts'
import { LATEST_VERSION } from './migrations.ts'

/**
 * 只读打开入参（docs/80 §8.2 目标签名）。
 * `readOnly`/`queryOnly` 恒 true——不提供 false 分支；运行期收到 false 即 CONFIG_INVALID
 * （TS 字面量挡编译期，JS 调用方仍须如实拒）。
 */
export interface ReadOnlyLedgerOpen {
  readonly path: string
  /** 调用方声明自己需要的 schema 版本（docs/80 §8.2）；须 ≤ 本代码 LATEST_VERSION */
  readonly expectedSchemaVersion: number
  readonly readOnly: true
  readonly queryOnly: true
}

/**
 * 只读打开失败（docs/80 §5.7 目标两轴：`failure` 处置轴 + `category` 观测轴）。
 * 契约 `ClassifiedError` 现状尚无 `failure` 字段（docs/80 §5.7 已登记为目标差距），
 * 本件在 store 侧补上而不改契约包（避免越界改公共形状）——待契约目标落地后收编。
 */
export interface ReadOnlyLedgerError extends ClassifiedError {
  readonly failure: FailureCategory
}

/**
 * 只读 face（D12 最小面）：不是 `Ledger`，类型上不暴露 appendEvent/begin/kvSet。
 * `db` 是已 readOnly+query_only 的引擎句柄；写语句由 SQLite 拒绝。目标 face 的
 * `query/get/payload` 记录面归后续刀（见文件头注边界）。
 */
export interface ReadOnlyLedger {
  /** 打开路径（调用方原样传入） */
  readonly path: string
  /** 打开时校验通过的 schema_version（恰好等于调用方 expectedSchemaVersion） */
  readonly schemaVersion: number
  /** 恒 true：打开即 readOnly（文件不存在不建库） */
  readonly readOnly: true
  /** 恒 true：打开后 PRAGMA query_only=ON 且回读为 1 */
  readonly queryOnly: true
  /** 只读引擎句柄；不提供 Ledger 写方法 */
  readonly db: DatabaseSync
  /** 关闭连接（幂等；重复调用不抛） */
  close(): void
}

/** `openLedgerReadonly` 的 Result（v2 端口 Result 判别：`kind:'ok'|'err'`） */
export type OpenLedgerReadonlyResult = Result<ReadOnlyLedger, ReadOnlyLedgerError>

/** 稳定 subcause 常量（与 docs/80 §8.2 的表逐字对齐；下游不得当判等键） */
const SUBCAUSE_DB_MISSING = 'db-missing'
const SUBCAUSE_SCHEMA_BEHIND = 'schema-behind'
const SUBCAUSE_SCHEMA_AHEAD = 'schema-ahead'
const SUBCAUSE_PATH_INVALID = 'readonly-path-invalid'
const SUBCAUSE_PATH_NOT_FILE = 'readonly-path-not-file'
const SUBCAUSE_EXPECTED_INVALID = 'readonly-expected-version-invalid'
const SUBCAUSE_FLAGS_INVALID = 'readonly-flags-invalid'
const SUBCAUSE_OPEN_FAILED = 'db-open-failed'
const SUBCAUSE_STAT_FAILED = 'readonly-stat-failed'
const SUBCAUSE_READ_FAILED = 'ledger-read-failed'

/** 构造 `Err`（detail 可选；exactOptionalPropertyTypes 下缺省不落 undefined 键） */
function fail(
  failure: FailureCategory,
  category: ErrorCategory,
  subcause: string,
  detail?: string,
): OpenLedgerReadonlyResult {
  const error: ReadOnlyLedgerError =
    detail === undefined ? { failure, category, subcause } : { failure, category, subcause, detail }
  return { kind: 'err', error }
}

/** 错误文本脱敏：docs/80 §5.8 错误不得含本机绝对路径；把入参路径及其绝对形态替换为占位符 */
function sanitize(err: unknown, path: string): string {
  const message = err instanceof Error ? err.message : String(err)
  if (path === '') return message
  return message.split(path).join('<ledger>').split(resolve(path)).join('<ledger>')
}

/** ENOENT 判定（缺库≠不可读：前者 db-missing，后者 STALL/readonly-stat-failed） */
function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'ENOENT'
  )
}

/**
 * 只读 schema_version 探测（**零 DDL**）：
 *   - 无 `schema_version` 表 ⇒ 0（未迁移；由调用方判 schema-behind）；
 *   - 表在但无行 ⇒ 0；
 *   - MAX(version) 非整数 ⇒ 抛出，调用方按 `ledger-read-failed`/STALL 拒（fail-closed）。
 */
function readSchemaVersion(db: DatabaseSync): number {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get()
  if (table === undefined) return 0
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as
    | { version?: unknown }
    | undefined
  const raw = row?.version
  if (raw === null || raw === undefined) return 0
  const version = Number(raw)
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`schema_version 版本列不是非负整数：${String(raw)}`)
  }
  return version
}

/**
 * 只读打开台账库（D12）。
 *
 * 两种入参形态：
 *   - `openLedgerReadonly(path)`：便捷形态，expectedSchemaVersion 缺省 = LATEST_VERSION；
 *   - `openLedgerReadonly({ path, expectedSchemaVersion, readOnly:true, queryOnly:true })`：
 *     docs/80 §8.2 的显式声明形态。
 *
 * 失败一律返回 `Err`（不抛）：缺库/打不开/读 schema 失败/版本偏移都有稳定 subcause；
 * 路径与版本入参畸形走 CONFIG_INVALID（构造期类错误的 Result 承载形态）。
 */
export function openLedgerReadonly(path: string): OpenLedgerReadonlyResult
export function openLedgerReadonly(options: ReadOnlyLedgerOpen): OpenLedgerReadonlyResult
export function openLedgerReadonly(input: string | ReadOnlyLedgerOpen): OpenLedgerReadonlyResult {
  const pathForm = typeof input === 'string'
  if (!pathForm && (input.readOnly !== true || input.queryOnly !== true)) {
    return fail(
      'rejected_precondition',
      'CONFIG_INVALID',
      SUBCAUSE_FLAGS_INVALID,
      'readOnly/queryOnly 必须恒为 true（不提供可写分支）',
    )
  }
  const target = pathForm ? input : input.path
  if (typeof target !== 'string' || target.trim() === '') {
    return fail(
      'rejected_precondition',
      'CONFIG_INVALID',
      SUBCAUSE_PATH_INVALID,
      'path 必须是非空字符串',
    )
  }
  const expected = pathForm ? LATEST_VERSION : input.expectedSchemaVersion
  if (!Number.isInteger(expected) || expected < 1 || expected > LATEST_VERSION) {
    return fail(
      'rejected_precondition',
      'CONFIG_INVALID',
      SUBCAUSE_EXPECTED_INVALID,
      `expectedSchemaVersion 须为 1..${LATEST_VERSION} 的整数，实得 ${String(expected)}`,
    )
  }

  // 路径形态：缺库 → db-missing（不建库）；非普通文件 → CONFIG_INVALID（路径畸形）
  let isFile: boolean
  try {
    isFile = statSync(target).isFile()
  } catch (err) {
    if (isMissingFileError(err)) {
      return fail('unavailable', 'STALL', SUBCAUSE_DB_MISSING)
    }
    return fail('unavailable', 'STALL', SUBCAUSE_STAT_FAILED, sanitize(err, target))
  }
  if (!isFile) {
    return fail(
      'rejected_precondition',
      'CONFIG_INVALID',
      SUBCAUSE_PATH_NOT_FILE,
      'path 指向的不是普通文件',
    )
  }

  let db: DatabaseSync
  try {
    db = openSqliteReadonly(target)
  } catch (err) {
    return fail('unavailable', 'STALL', SUBCAUSE_OPEN_FAILED, sanitize(err, target))
  }

  /** 打开后任何失败都必须关闭句柄（不把半开/可写句柄外泄） */
  const closeQuietly = (): void => {
    try {
      db.close()
    } catch {
      // 关闭失败不覆盖原始分类；连接随进程退出回收
    }
  }

  let actual: number
  try {
    actual = readSchemaVersion(db)
  } catch (err) {
    closeQuietly()
    return fail('unavailable', 'STALL', SUBCAUSE_READ_FAILED, sanitize(err, target))
  }

  if (actual < expected) {
    closeQuietly()
    const actualLabel = actual === 0 ? '未迁移（schema_version 无记录）' : `v${actual}`
    return fail(
      'rejected_version',
      'EVOLVE_REJECT',
      SUBCAUSE_SCHEMA_BEHIND,
      `期望 schema v${expected}，实际 ${actualLabel}；只读打开不自动迁移`,
    )
  }
  if (actual > expected) {
    closeQuietly()
    return fail(
      'rejected_version',
      'EVOLVE_REJECT',
      SUBCAUSE_SCHEMA_AHEAD,
      `期望 schema v${expected}，实际 v${actual}（库更新）；只读打开不静默降级读`,
    )
  }

  let closed = false
  const face: ReadOnlyLedger = {
    path: target,
    schemaVersion: actual,
    readOnly: true,
    queryOnly: true,
    db,
    close(): void {
      if (closed) return
      closed = true
      db.close()
    },
  }
  return { kind: 'ok', value: face }
}
