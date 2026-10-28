/**
 * records-crash-child —— MIG-04 / IMPL-04-07 V2 crash 腿子进程（真实 SIGKILL，无 mock）
 *
 * 依据：plan/05 IMPL-04-07（V2 crash 腿）；docs/v2/17 §1.1 V5（kill 点重启三不变量）；
 *       plan/04 §1.4（V5：真进程 SIGKILL 生命周期只能 daemon 侧 spawn 承载）。
 *
 * 两种模式（由 SN_RECORDS_CRASH_MODE 选择；库路径由 SN_RECORDS_CRASH_DB 给）：
 *   - crash：node:sqlite 打开库（openLedger→migrate）→ BEGIN → INSERT records → 同步打印
 *     PRE_COMMIT（事务内 records=2 的直证）→ crashHook('records-commit')（COMMIT 前）→
 *     **命中时不返回、进程被 SIGKILL**；未命中也绝不 COMMIT（ROLLBACK 后 exit 91，防假绿）。
 *   - commit：同一 recordId 正常 BEGIN→INSERT→COMMIT（模拟崩溃后的重放提交）。
 *
 * 三不变量（本进程只负责制造崩溃/提交，断言在 records-crash.test.ts）：
 *   不丢终态＝种子行在独立已提交事务里；不假绿＝未命中点名 exit 91 而非 0；不重复副作用＝
 *   同一 recordId 的 INSERT 只在回滚后发生一次。
 *
 * 边界：测试子进程，不进生产面；**不新增生产调用点**（crashHook 只在本测试夹具里调用）。
 */
import { writeSync } from 'node:fs'
import { currentVersion, openLedger, type Ledger } from '@studio-next/store'
import { crashHook } from '../../../../src/engine/crash-points.ts'
import {
  CRASH_POINT_NAME,
  CRASHING_RECORD_ID,
  DB_ENV,
  crashRecordRow,
  insertRecordRow,
} from './records-crash-scenario.ts'

interface Counts {
  version: number
  records: number
  events: number
  costDaily: number
}

/** 同步输出一行证据（SIGKILL 前必须离开本进程——writeSync 写内核管道，非 stdout 缓冲） */
function emit(prefix: string, value: unknown): void {
  writeSync(1, `${prefix} ${JSON.stringify(value)}\n`)
}

function fail(code: number, message: string): never {
  writeSync(2, `${message}\n`)
  process.exit(code)
}

function counts(ledger: Ledger): Counts {
  const row = ledger.db.prepare('SELECT COUNT(*) AS c FROM records').get() as { c: number }
  return {
    version: currentVersion(ledger.db),
    records: Number(row.c),
    events: ledger.queryEvents().length,
    costDaily: ledger.listCostDaily().length,
  }
}

function main(): void {
  const mode = process.env['SN_RECORDS_CRASH_MODE']
  if (mode !== 'crash' && mode !== 'commit') fail(2, `SN_RECORDS_CRASH_MODE 须为 crash|commit，实为 ${String(mode)}`)
  const dbPath = process.env[DB_ENV]
  if (dbPath === undefined || dbPath === '') fail(2, `${DB_ENV} 缺库路径（真文件库，不用 :memory:）`)

  const ledger = openLedger(dbPath)
  const before = counts(ledger)
  if (before.records !== 1 || before.events !== 1 || before.costDaily !== 1) {
    ledger.close()
    fail(3, `种子基线不符（期望 records=1/events=1/costDaily=1）：${JSON.stringify(before)}`)
  }

  if (mode === 'crash') {
    // 提交前缝隙：记录事务已 INSERT、COMMIT 未发
    ledger.db.exec('BEGIN')
    insertRecordRow(ledger.db, crashRecordRow())
    const inTx = counts(ledger)
    if (inTx.records !== 2) {
      ledger.db.exec('ROLLBACK')
      ledger.close()
      fail(4, `事务内 records 应为 2（种子＋缝隙行），实为 ${String(inTx.records)}`)
    }
    emit('PRE_COMMIT', { ...inTx, recordId: CRASHING_RECORD_ID })
    crashHook(CRASH_POINT_NAME) // 命中：SIGKILL（COMMIT 永不执行）；未命中：零行为
    // 未命中点名＝本进程不得提交——回滚后以专用退出码上报，绝不以 exit 0 冒充崩溃
    ledger.db.exec('ROLLBACK')
    ledger.close()
    fail(91, 'CRASH_HOOK_NOT_ARMED：SN_CRASH_POINT 未命中 records-commit；本进程不得提交（防假绿）')
  }

  // commit 模式：崩溃后的正常提交（同一 recordId；回滚无残留 → 本次应成功落 1 行）
  ledger.db.exec('BEGIN')
  insertRecordRow(ledger.db, crashRecordRow())
  ledger.db.exec('COMMIT')
  const after = counts(ledger)
  const inserted = ledger.db.prepare('SELECT record_id FROM records WHERE record_id = ?').get(CRASHING_RECORD_ID) !== undefined
  ledger.close()
  emit('COMMITTED', { mode, ...after, inserted })
  if (!inserted || after.records !== 2 || after.events !== 1 || after.costDaily !== 1) {
    process.exit(5)
  }
}

main()
