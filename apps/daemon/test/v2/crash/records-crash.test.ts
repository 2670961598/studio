/**
 * records-crash —— MIG-04 / IMPL-04-07：记录面第 6 注入点 records-commit（V5 crash 腿）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - plan/05 IMPL-04-07（记录面 crash 注入点登记；V2 crash 腿 kill 点重启三不变量）；
 *     plan/04 §1.4/§1.9.4-7（V5：每 kill 点重启后不丢终态/不假绿/不重复副作用；旧 crash-injection
 *     只登记不扩展，V2 腿落 apps/daemon/test/v2/crash/）
 *   - docs/v2/17 §1.1 V5（「现状五点＋V2 新增注入点；每个 kill 点重启后三不变量成立」）
 *   - docs/v2/05 §三 DOM-05（records＝记录投影，非第四事实源）；docs/v2/11 §〇（记录信封）
 *   - 冻结表：apps/daemon/src/engine/crash-points.ts 头注第 ⑥ 行（records-commit＝记录事务
 *     COMMIT 前/后缝隙；**无生产调用点**，注册名仅供本 V2 crash 子进程使用）
 *
 * 注入手法（真实子进程，无 mock）：
 *   临时目录真文件库 → 测试进程先落「崩溃前已提交」种子（event＋cost_daily＋records 终态行）
 *   → spawn 子进程：node:sqlite 打开同库 → BEGIN → INSERT records → 同步打印 PRE_COMMIT
 *   （事务内 records=2 的直证）→ SN_CRASH_POINT=records-commit 在 COMMIT 前 SIGKILL 自杀
 *   → 同库重启断言无半截行、events/cost_daily 零副作用 → 再 spawn 子进程正常 COMMIT 同一
 *   recordId → 行在且只一行。
 *
 * 三不变量：
 *   ① 不丢终态：种子终态行（records effective／events CLOSE／cost_daily final）跨崩溃与重放存活；
 *   ② 不假绿：子进程必须 signal=SIGKILL（code=null），且未命中点名时 child 以 exit 91 拒绝提交；
 *      事务内可见、重启后不可见的 2→1 行差＝「未 COMMIT」的唯一自洽读法；
 *   ③ 不重复副作用：重启提交后 records=2（每 id 恰一行）、events=1、cost_daily=1，零重复。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { currentVersion, openLedger, type Ledger } from '@studio-next/store'
import { CRASH_POINTS } from '../../../src/engine/crash-points.ts'
import {
  CRASHING_RECORD_ID,
  CRASH_POINT_NAME,
  DB_ENV,
  SEED_COST_ID,
  SEED_EVENT_ID,
  SEED_RECORD_ID,
  crashRecordRow,
  insertRecordRow,
  seedCostRow,
  seedEvent,
  seedRecordRow,
} from './fixtures/records-crash-scenario.ts'

const CHILD = fileURLToPath(new URL('./fixtures/records-crash-child.ts', import.meta.url))

let root = ''
let dbPath = ''
const live = new Set<ChildProcess>()

afterAll(async () => {
  for (const child of live) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  live.clear()
  if (root !== '') await rm(root, { recursive: true, force: true })
})

interface Snapshot {
  version: number
  records: number
  events: number
  costDaily: number
}

interface ChildRun {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

function countRows(db: DatabaseSync, table: 'records' | 'events' | 'cost_daily'): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as unknown as { c: number }
  return Number(row.c)
}

function snapshot(ledger: Ledger): Snapshot {
  return {
    version: currentVersion(ledger.db),
    records: countRows(ledger.db, 'records'),
    events: countRows(ledger.db, 'events'),
    costDaily: countRows(ledger.db, 'cost_daily'),
  }
}

function integrity(db: DatabaseSync): string {
  const row = db.prepare('PRAGMA integrity_check').get() as unknown as { integrity_check: string }
  return String(row.integrity_check)
}

function recordRowOf(db: DatabaseSync, recordId: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId) as unknown as
    | Record<string, unknown>
    | undefined
}

/** spawn 真子进程；点名为空串＝干净 env（保证不得误杀） */
function runChild(mode: 'crash' | 'commit', point: string): Promise<ChildRun> {
  const child = spawn(process.execPath, ['--no-warnings', CHILD], {
    env: { ...process.env, SN_RECORDS_CRASH_MODE: mode, [DB_ENV]: dbPath, SN_CRASH_POINT: point },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  live.add(child)
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk
  })
  return new Promise<ChildRun>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      live.delete(child)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

/** 取子进程证据行（前缀严格匹配，防止把别的输出当证据） */
function evidenceLine(run: ChildRun, prefix: 'PRE_COMMIT' | 'COMMITTED'): string {
  const line = run.stdout.split('\n').find((candidate) => candidate.startsWith(`${prefix} `))
  if (line === undefined) throw new Error(`子进程未输出 ${prefix} 证据行；stdout=${JSON.stringify(run.stdout)}`)
  return line.slice(prefix.length + 1)
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'studio-next-records-crash-'))
  dbPath = path.join(root, 'ledger.sqlite')
  const ledger = openLedger(dbPath)
  try {
    // 崩溃前已提交种子：event＋cost_daily＋records（三者各自独立提交）
    ledger.appendEvent(seedEvent())
    ledger.appendCostDaily(seedCostRow())
    insertRecordRow(ledger.db, seedRecordRow())
  } finally {
    ledger.close()
  }
})

describe('第 6 点登记与种子基线', () => {
  it('CRASH_POINTS 长度=9：①-⑤ 旧五点＋⑥ records-commit＋MIG-06 ⑦-⑨；前六项名称与顺序逐字不变', () => {
    expect(CRASH_POINTS).toEqual([
      'dispatch-reserved',
      'dispatch-launched',
      'harvest-verdict',
      'heartbeat-write',
      'shutdown-drain',
      'records-commit',
      'backup-snapshot',
      'projection-rebuild',
      'exclusion-report',
    ])
    expect(CRASH_POINTS).toHaveLength(9)
    expect(CRASH_POINTS[5]).toBe(CRASH_POINT_NAME)
  })

  it('崩溃前基线：库 v15、records/events/cost_daily 各 1 行、终态行 effective、integrity ok', () => {
    const ledger = openLedger(dbPath)
    try {
      expect(currentVersion(ledger.db)).toBe(15)
      expect(snapshot(ledger)).toEqual({ version: 15, records: 1, events: 1, costDaily: 1 })
      expect(integrity(ledger.db)).toBe('ok')
      expect(recordRowOf(ledger.db, SEED_RECORD_ID)?.['effective_state']).toBe('effective')
      expect(ledger.queryEvents().map((event) => event.id)).toEqual([SEED_EVENT_ID])
      expect(ledger.listCostDaily().map((row) => row.id)).toEqual([SEED_COST_ID])
    } finally {
      ledger.close()
    }
  })
})

describe('records-commit 崩溃注入（提交前缝隙）', () => {
  it('未命中点名=零行为：SN_CRASH_POINT=dispatch-reserved 不自杀，且子进程绝不提交（exit 91）', async () => {
    const run = await runChild('crash', 'dispatch-reserved')
    expect(run.code).toBe(91)
    expect(run.signal).toBeNull()
    expect(run.stderr).toContain('CRASH_HOOK_NOT_ARMED')
    expect(JSON.parse(evidenceLine(run, 'PRE_COMMIT'))).toMatchObject({ records: 2, recordId: CRASHING_RECORD_ID })

    const ledger = openLedger(dbPath)
    try {
      expect(snapshot(ledger)).toEqual({ version: 15, records: 1, events: 1, costDaily: 1 })
      expect(recordRowOf(ledger.db, CRASHING_RECORD_ID)).toBeUndefined()
    } finally {
      ledger.close()
    }
  })

  it('命中 records-commit：INSERT 后 COMMIT 前 SIGKILL → 重启同库无半截行、events/cost_daily 零副作用', async () => {
    const run = await runChild('crash', CRASH_POINT_NAME)

    // —— 不假绿：真进程硬杀，不是 exit 0 / 优雅停 ——
    expect(run.code).toBeNull()
    expect(run.signal).toBe('SIGKILL')
    expect(run.stderr).not.toContain('CRASH_HOOK_NOT_ARMED')

    // —— 命中点直证：事务内与 COMMIT 前插入已生效（records=2），随后才死 ——
    const inTx = JSON.parse(evidenceLine(run, 'PRE_COMMIT')) as { version: number; records: number; events: number; costDaily: number; recordId: string }
    expect(inTx).toMatchObject({ version: 15, records: 2, events: 1, costDaily: 1, recordId: CRASHING_RECORD_ID })

    // —— 重启同库：未 COMMIT 的事务回滚（无半截行），已提交种子存活 ——
    const ledger = openLedger(dbPath)
    let afterCrash: Snapshot
    try {
      afterCrash = snapshot(ledger)
      expect(afterCrash).toEqual({ version: 15, records: 1, events: 1, costDaily: 1 })
      expect(recordRowOf(ledger.db, CRASHING_RECORD_ID)).toBeUndefined()
      expect(recordRowOf(ledger.db, SEED_RECORD_ID)).toBeDefined()
      expect(recordRowOf(ledger.db, SEED_RECORD_ID)?.['effective_state']).toBe('effective')
      expect(ledger.queryEvents().map((event) => event.id)).toEqual([SEED_EVENT_ID])
      expect(ledger.queryEvents()[0]?.event).toBe('CLOSE')
      expect(ledger.listCostDaily().map((row) => row.id)).toEqual([SEED_COST_ID])
      expect(ledger.listCostDaily()[0]?.cost_usd).toBe(0.25)
      expect(integrity(ledger.db)).toBe('ok')
    } finally {
      ledger.close()
    }
    // 证据行（非断言替代）：硬杀信号＋事务内/重启后行数对照
    console.log(`[records-commit] signal=${String(run.signal)} code=${String(run.code)} 事务内records=${inTx.records} 重启后=${JSON.stringify(afterCrash)}`)
  })

  it('重启正常提交同一 recordId：行在且只有一行；events/cost_daily 零重复副作用（终态不丢）', async () => {
    const run = await runChild('commit', '')
    expect(run.code).toBe(0)
    expect(run.signal).toBeNull()
    const committed = JSON.parse(evidenceLine(run, 'COMMITTED')) as Snapshot & { inserted: boolean }
    expect(committed).toMatchObject({ version: 15, records: 2, events: 1, costDaily: 1, inserted: true })

    const ledger = openLedger(dbPath)
    try {
      expect(snapshot(ledger)).toEqual({ version: 15, records: 2, events: 1, costDaily: 1 })
      // 崩溃缝隙行正常提交：字段与场景一致、只一行（回滚无残留、重放不双写）
      const crashRow = recordRowOf(ledger.db, CRASHING_RECORD_ID)
      expect(crashRow).toBeDefined()
      expect(crashRow?.['record_type']).toBe('REC-EVT-01')
      expect(crashRow?.['record_area']).toBe('AUTH')
      expect(crashRow?.['effective_state']).toBe('effective')
      expect(crashRow?.['produced_at']).toBe(crashRecordRow().produced_at)
      expect(crashRow?.['payload']).toBe(crashRecordRow().payload)
      const duplicated = ledger.db.prepare('SELECT COUNT(*) AS c FROM records WHERE record_id = ?').get(CRASHING_RECORD_ID) as unknown as {
        c: number
      }
      expect(Number(duplicated.c)).toBe(1)
      // 不丢终态：种子行与崩溃前事件/钱账原样；不重复副作用：三表计数不因记录提交而增加
      expect(recordRowOf(ledger.db, SEED_RECORD_ID)).toBeDefined()
      expect(recordRowOf(ledger.db, SEED_RECORD_ID)?.['effective_state']).toBe('effective')
      expect(ledger.queryEvents().map((event) => event.id)).toEqual([SEED_EVENT_ID])
      expect(ledger.queryEvents()[0]?.event).toBe('CLOSE')
      expect(ledger.listCostDaily().map((row) => row.id)).toEqual([SEED_COST_ID])
      expect(ledger.listCostDaily()[0]?.cost_usd).toBe(0.25)
      expect(countRows(ledger.db, 'records')).toBe(2)
      expect(countRows(ledger.db, 'events')).toBe(1)
      expect(countRows(ledger.db, 'cost_daily')).toBe(1)
      expect(integrity(ledger.db)).toBe('ok')
    } finally {
      ledger.close()
    }
    expect(existsSync(dbPath)).toBe(true)
  })
})
