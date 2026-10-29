/**
 * readonly-open —— D12「只读打开/围栏」最小实现测试（PB-5 入口；PRB-14 可复测性）
 *
 * 依据：
 *   - docs/v2/17 §五 PB-5：入口 MIG-04（D12 只读打开/围栏）；PRB-14 负向「无围栏 /
 *     query_only=0」不允许被当成台账单写；
 *   - docs/80 §8.2：`openLedgerReadonly`＋`PRAGMA query_only=ON`；只读进程不跑 DDL；
 *     缺库/版本偏移的 Err 形状；
 *   - docs/probe/pb-5/report.md：PRB-14 两进程实测 query_only=0 / openLedger 无条件 migrate。
 *
 * 测试只对文档冻结口径负责（真 SQLite 文件，不用 :memory:；不 mock 引擎）：
 *   1. 只读可读、query_only=1、INSERT/UPDATE/DELETE/DDL 被引擎拒；
 *   2. 缺库拒绝且**不建库**；路径畸形/非文件 CONFIG_INVALID；
 *   3. 未迁移（无 schema_version / 空表）、落后 v14、领先 v16 各自拒绝且不升级；
 *   4. 打开/读/写尝试前后主库文件字节不变、schema_version 与 sqlite_master 全列不变
 *      （不跑 DDL 的机械证据）；SQLite 只读 WAL 连接可能生成 -shm/-wal 引擎侧文件，
 *      本测试只锚**主库文件**（db 文件）不被创建/修改；
 *   5. 同进程两连接同读、close 幂等；两真实子进程同读且子进程写被拒。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  currentVersion,
  LATEST_VERSION,
  migrate,
  openLedger,
  openLedgerReadonly,
  type OpenLedgerReadonlyResult,
  type ReadOnlyLedger,
  type ReadOnlyLedgerError,
  type ReadOnlyLedgerOpen,
} from '../../src/index.ts'
import { eventRecord, T0, ulid } from './fixtures.ts'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
/** 仓根：packages/store/test/v2 → 四层上 */
const REPO_ROOT = path.resolve(TEST_DIR, '../../../..')
const STORE_INDEX_URL = pathToFileURL(path.join(REPO_ROOT, 'packages/store/src/index.ts')).href

let root = ''

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-v2-readonly-'))
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 真 SQLite 夹具：openLedger 建库/迁移后写入 count 条合法事件，关闭并返回路径 */
function seedLedger(name: string, count: number): string {
  const target = path.join(root, name)
  const ledger = openLedger(target)
  try {
    for (let i = 0; i < count; i += 1) {
      ledger.appendEvent(eventRecord({ id: ulid(T0, i + 1), issue: `STUDIO-${500 + i}` }))
    }
  } finally {
    ledger.close()
  }
  return target
}

function expectOk(result: OpenLedgerReadonlyResult): ReadOnlyLedger {
  expect(result.kind).toBe('ok')
  if (result.kind !== 'ok') throw new Error(`期望 Ok，实得 Err：${JSON.stringify(result.error)}`)
  return result.value
}

function expectErr(
  result: OpenLedgerReadonlyResult,
  expected: Partial<ReadOnlyLedgerError>,
): ReadOnlyLedgerError {
  expect(result.kind).toBe('err')
  if (result.kind !== 'err') throw new Error('期望 Err，实得 Ok')
  expect(result.error).toMatchObject(expected)
  return result.error
}

function eventCount(face: ReadOnlyLedger): number {
  const row = face.db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c?: unknown }
  return Number(row.c)
}

/** PRAGMA 单行读（测试探针；只读连接上也可读） */
function pragma(face: ReadOnlyLedger, name: string): Record<string, unknown> {
  return face.db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>
}

interface FileSnapshot {
  readonly size: number
  readonly mtimeMs: number
  readonly sha256: string
}

/** 主库文件快照（字节＋mtime＋sha256；不锚 -wal/-shm 引擎侧文件） */
function fileSnapshot(target: string): FileSnapshot {
  const content = readFileSync(target)
  return {
    size: content.length,
    mtimeMs: statSync(target).mtimeMs,
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

interface SchemaSnapshot {
  readonly versions: readonly unknown[]
  readonly objects: readonly unknown[]
  readonly userVersion: number
}

/** schema_version 全列 + sqlite_master 全对象 + PRAGMA user_version（DDL 不发生的机械证据） */
function schemaSnapshot(target: string): SchemaSnapshot {
  const db = new DatabaseSync(target)
  try {
    const versions = db
      .prepare('SELECT version, applied_at, sha8 FROM schema_version ORDER BY version ASC')
      .all()
    const objects = db
      .prepare(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
      )
      .all()
    const user = db.prepare('PRAGMA user_version').get() as { user_version?: unknown }
    return {
      versions: [...versions],
      objects: [...objects],
      userVersion: Number(user.user_version),
    }
  } finally {
    db.close()
  }
}

/** 写尝试：DML 三类 + DDL 两类，全部应被 SQLite 只读连接拒绝 */
const WRITE_STATEMENTS: readonly { readonly label: string; readonly sql: string }[] = [
  {
    label: 'INSERT',
    sql: "INSERT INTO schema_version (version, applied_at, sha8) VALUES (99, 0, 'readonly-probe')",
  },
  {
    label: 'UPDATE',
    sql: "UPDATE schema_version SET sha8 = 'readonly-probe' WHERE version = 1",
  },
  { label: 'DELETE', sql: 'DELETE FROM schema_version WHERE version = 1' },
  {
    label: 'CREATE TABLE',
    sql: 'CREATE TABLE readonly_should_not_exist (id TEXT PRIMARY KEY)',
  },
  { label: 'DROP TABLE', sql: 'DROP TABLE events' },
]

function expectWritesRejected(face: ReadOnlyLedger): void {
  for (const { label, sql } of WRITE_STATEMENTS) {
    let error: unknown
    try {
      face.db.exec(sql)
    } catch (err) {
      error = err
    }
    expect(error, `${label} 应被只读连接拒绝`).toBeInstanceOf(Error)
    const message = error instanceof Error ? error.message : String(error)
    expect(message, `${label} 的错误须为 SQLite 只读拒写`).toMatch(/readonly database/i)
  }
}

describe('openLedgerReadonly（D12 只读打开/围栏）', () => {
  it('只读可读：query_only=1 / journal_mode=wal / schemaVersion=LATEST / 事件行逐字可读', () => {
    const target = seedLedger('readable.db', 2)
    const face = expectOk(openLedgerReadonly(target))
    try {
      expect(face.schemaVersion).toBe(LATEST_VERSION)
      expect(face.readOnly).toBe(true)
      expect(face.queryOnly).toBe(true)
      expect(face.db).toBeInstanceOf(DatabaseSync)

      expect(pragma(face, 'query_only')['query_only']).toBe(1)
      expect(pragma(face, 'journal_mode')['journal_mode']).toBe('wal')
      expect(eventCount(face)).toBe(2)
      const rows = face.db.prepare('SELECT issue FROM events ORDER BY id ASC').all() as Array<{
        issue: string
      }>
      expect(rows.map((row) => row.issue)).toEqual(['STUDIO-500', 'STUDIO-501'])
    } finally {
      face.close()
      face.close() // close 幂等
    }
  })

  it('写拒绝：INSERT/UPDATE/DELETE/CREATE/DROP 全部被只读引擎拒绝，行集不变', () => {
    const target = seedLedger('writes.db', 2)
    const face = expectOk(openLedgerReadonly(target))
    try {
      expectWritesRejected(face)
      expect(eventCount(face)).toBe(2)
      const versions = face.db.prepare('SELECT COUNT(*) AS c FROM schema_version').get() as {
        c?: unknown
      }
      expect(Number(versions.c)).toBe(LATEST_VERSION)
    } finally {
      face.close()
    }
  })

  it('不跑 DDL/不写库：主库文件字节不变，schema_version 与 sqlite_master 全列不变', () => {
    const target = seedLedger('stable.db', 1)
    const beforeSchema = schemaSnapshot(target)
    const beforeFile = fileSnapshot(target)

    const face = expectOk(openLedgerReadonly(target))
    try {
      expect(eventCount(face)).toBe(1)
      expectWritesRejected(face)
    } finally {
      face.close()
    }

    // 主库文件（db）既未重建也未改写；-shm/-wal 是 SQLite 只读 WAL 连接的引擎侧文件
    expect(fileSnapshot(target)).toEqual(beforeFile)
    // 没有 DDL：schema_version 行集/每条 applied_at+sha8、sqlite_master 全对象逐列一致
    expect(schemaSnapshot(target)).toEqual(beforeSchema)
  })

  it('缺库拒绝且不建库；路径畸形/非普通文件 CONFIG_INVALID', async () => {
    const missing = path.join(root, 'missing.db')
    const missingError = expectErr(openLedgerReadonly(missing), {
      failure: 'unavailable',
      category: 'STALL',
      subcause: 'db-missing',
    })
    expect(missingError.detail).toBeUndefined()
    expect(existsSync(missing)).toBe(false)

    expectErr(openLedgerReadonly(''), {
      failure: 'rejected_precondition',
      category: 'CONFIG_INVALID',
      subcause: 'readonly-path-invalid',
    })

    const directory = path.join(root, 'not-a-file')
    await mkdir(directory, { recursive: true })
    expectErr(openLedgerReadonly(directory), {
      failure: 'rejected_precondition',
      category: 'CONFIG_INVALID',
      subcause: 'readonly-path-not-file',
    })
  })

  it('未迁移/落后拒绝且不升级：无 schema_version 表、空表、v14 三种', () => {
    // 无 schema_version 表（裸库）
    const raw = path.join(root, 'unmigrated.db')
    const rawDb = new DatabaseSync(raw)
    rawDb.exec('CREATE TABLE stray (id TEXT PRIMARY KEY)')
    rawDb.close()
    const rawError = expectErr(openLedgerReadonly(raw), {
      failure: 'rejected_version',
      category: 'EVOLVE_REJECT',
      subcause: 'schema-behind',
    })
    expect(rawError.detail).toContain('未迁移')

    const rawCheck = new DatabaseSync(raw)
    try {
      const tables = rawCheck
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
      // 只读打开没有建 schema_version 表，也没有跑任何迁移
      expect(tables.map((table) => table.name)).toEqual(['stray'])
    } finally {
      rawCheck.close()
    }

    // schema_version 表在但零行（迁移半途/手工建表）
    const empty = path.join(root, 'empty-version.db')
    const emptyDb = new DatabaseSync(empty)
    emptyDb.exec(
      'CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, sha8 TEXT NOT NULL)',
    )
    emptyDb.close()
    expectErr(openLedgerReadonly(empty), {
      failure: 'rejected_version',
      category: 'EVOLVE_REJECT',
      subcause: 'schema-behind',
    })

    // 落后一版：upTo=LATEST-1，只读打开须拒且不得自动补迁移
    const behind = path.join(root, 'v14.db')
    const behindDb = new DatabaseSync(behind)
    migrate(behindDb, { upTo: LATEST_VERSION - 1 })
    behindDb.close()
    const behindError = expectErr(openLedgerReadonly(behind), {
      failure: 'rejected_version',
      category: 'EVOLVE_REJECT',
      subcause: 'schema-behind',
    })
    expect(behindError.detail).toContain(`v${LATEST_VERSION - 1}`)

    const behindCheck = new DatabaseSync(behind)
    try {
      expect(currentVersion(behindCheck)).toBe(LATEST_VERSION - 1)
    } finally {
      behindCheck.close()
    }
  })

  it('schema 领先拒绝；expectedSchemaVersion 对象形态与版本/旗标闸', () => {
    const target = seedLedger('ahead.db', 1)
    const writer = new DatabaseSync(target)
    try {
      writer
        .prepare('INSERT INTO schema_version (version, applied_at, sha8) VALUES (?, ?, ?)')
        .run(LATEST_VERSION + 1, T0, 'future-schema')
    } finally {
      writer.close()
    }
    const aheadError = expectErr(openLedgerReadonly(target), {
      failure: 'rejected_version',
      category: 'EVOLVE_REJECT',
      subcause: 'schema-ahead',
    })
    expect(aheadError.detail).toContain(`v${LATEST_VERSION + 1}`)

    const normal = seedLedger('object-form.db', 1)
    const explicit: ReadOnlyLedgerOpen = {
      path: normal,
      expectedSchemaVersion: LATEST_VERSION,
      readOnly: true,
      queryOnly: true,
    }
    const face = expectOk(openLedgerReadonly(explicit))
    face.close()

    // 调用方要求更低版本 ⇒ 库相对它是「更新」⇒ schema-ahead（不静默降级读）
    expectErr(
      openLedgerReadonly({
        path: normal,
        expectedSchemaVersion: LATEST_VERSION - 1,
        readOnly: true,
        queryOnly: true,
      }),
      { failure: 'rejected_version', category: 'EVOLVE_REJECT', subcause: 'schema-ahead' },
    )

    // 期望版本超出本代码已知 LATEST ⇒ 配置非法（不是库的问题）
    expectErr(
      openLedgerReadonly({
        path: normal,
        expectedSchemaVersion: LATEST_VERSION + 1,
        readOnly: true,
        queryOnly: true,
      }),
      {
        failure: 'rejected_precondition',
        category: 'CONFIG_INVALID',
        subcause: 'readonly-expected-version-invalid',
      },
    )

    // 运行期 JS 传入 false 旗标（TS 字面量挡编译期，运行期仍须如实拒）
    const badFlags = {
      path: normal,
      expectedSchemaVersion: LATEST_VERSION,
      readOnly: false,
      queryOnly: true,
    } as unknown as ReadOnlyLedgerOpen
    expectErr(openLedgerReadonly(badFlags), {
      failure: 'rejected_precondition',
      category: 'CONFIG_INVALID',
      subcause: 'readonly-flags-invalid',
    })
  })

  it('两连接同读：写被拒不影响另一连接；close 幂等', () => {
    const target = seedLedger('two-connections.db', 3)
    const first = expectOk(openLedgerReadonly(target))
    const second = expectOk(openLedgerReadonly(target))
    try {
      expect(eventCount(first)).toBe(3)
      expect(eventCount(second)).toBe(3)
      expect(pragma(first, 'query_only')['query_only']).toBe(1)
      expect(pragma(second, 'query_only')['query_only']).toBe(1)

      expectWritesRejected(first)
      // 第一连接的写尝试不改变库，第二连接继续可读
      expect(eventCount(second)).toBe(3)
    } finally {
      first.close()
      first.close()
      second.close()
      second.close()
    }
  })

  it('两进程同读：真实子进程各开只读连接，读同值且写被拒（PRB-14 可复测）', () => {
    const target = seedLedger('two-processes.db', 4)
    const parent = expectOk(openLedgerReadonly(target))
    try {
      const first = runReadonlyChild(target)
      const second = runReadonlyChild(target)
      expect(first).toMatchObject({
        ok: true,
        schemaVersion: LATEST_VERSION,
        queryOnly: 1,
        journalMode: 'wal',
        count: 4,
      })
      expect(first.write).not.toBe('accepted')
      expect(second).toEqual(first)
      // 父进程连接与两个子进程同读同一文件；父连接仍可读
      expect(eventCount(parent)).toBe(4)
    } finally {
      parent.close()
    }
  })
})

interface ChildReadonlyResult {
  readonly ok: boolean
  readonly schemaVersion?: number
  readonly queryOnly?: number
  readonly journalMode?: string
  readonly count?: number
  readonly write?: string
  readonly error?: unknown
}

/** 真实子进程：动态 import 仓内 store index → openLedgerReadonly → 读 + 写尝试 → JSON 上报 */
function runReadonlyChild(target: string): ChildReadonlyResult {
  const script = `
(async () => {
  const { openLedgerReadonly } = await import(${JSON.stringify(STORE_INDEX_URL)})
  const result = openLedgerReadonly(${JSON.stringify(target)})
  if (result.kind !== 'ok') {
    console.log(JSON.stringify({ ok: false, error: result.error }))
    process.exitCode = 2
    return
  }
  const face = result.value
  const queryOnly = face.db.prepare('PRAGMA query_only').get() || {}
  const journalMode = face.db.prepare('PRAGMA journal_mode').get() || {}
  const row = face.db.prepare('SELECT COUNT(*) AS c FROM events').get() || {}
  let write = 'accepted'
  try {
    face.db.exec("INSERT INTO schema_version (version, applied_at, sha8) VALUES (99, 0, 'child')")
  } catch (err) {
    write = String((err && err.code) || 'threw')
  }
  const schemaVersion = face.schemaVersion
  face.close()
  face.close()
  console.log(JSON.stringify({
    ok: true,
    schemaVersion,
    queryOnly: queryOnly.query_only,
    journalMode: journalMode.journal_mode,
    count: row.c,
    write,
  }))
})().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
`
  // vitest 当前由 node 跑；若直接以 bun 跑测试，则用 bun -e（不带 --input-type）
  const runtimeArgs =
    'bun' in process.versions
      ? ['-e', script]
      : ['--no-warnings', '--input-type=module', '-e', script]
  let stdout: string
  try {
    stdout = execFileSync(process.execPath, runtimeArgs, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: process.env,
    })
  } catch (err) {
    const failure = err as { stderr?: unknown; message?: string }
    const stderr = typeof failure.stderr === 'string' ? failure.stderr : ''
    throw new Error(`只读子进程失败：${stderr !== '' ? stderr : String(failure.message)}`)
  }
  return JSON.parse(stdout.trim()) as ChildReadonlyResult
}
