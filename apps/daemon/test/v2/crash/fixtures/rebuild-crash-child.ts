/**
 * rebuild-crash-child —— MIG-06 第 8 点 projection-rebuild V2 crash 腿子进程（真实 SIGKILL，无 mock）
 *
 * 依据：plan/03 MIG-06「记录面注入点补点」；plan/04 §1.6（投影重建中）；docs/v2/17 §1.1 V5；
 *       docs/v2/16 §一 B11（rebuild 循环体只 appendEvent；单事务全量再生，不留半截库）。
 *
 * 两种模式（SN_SURFACES_MODE 选择；目标库 SN_SURFACES_DB；输入 JSONL SN_SURFACES_SOURCE）：
 *   - crash：openLedger(target)→BEGIN→用生产 appendEvent 重放前一半（重放游标 replayed=⌊N/2⌋）
 *     →同步打印 PRE_COMMIT（事务内 events=一半）→COMMIT 前调 crashHook('projection-rebuild')
 *     ——命中即 SIGKILL（COMMIT 永不执行）；未命中则 ROLLBACK 后 exit 91（防假绿）。
 *   - run：生产 rebuild(source,target) 全量再生（崩溃后的重跑腿）；幂等由父测试连跑两次验证。
 *
 * 口径：本仓 rebuild 无持久化「投影游标」列（游标＝事务内重放进度，非第二事实源；daemon_kv 的
 * activity.cursor 归引擎装配，不属 store 重建事务）——本子进程如实只造「半投影行已写、COMMIT 未发」。
 *
 * 边界：测试子进程，不进生产面；**不新增生产调用点**（crashHook 只在本测试夹具里调用）。
 */
import { openLedger, rebuild } from '@studio-next/store'
import { crashHook } from '../../../../src/engine/crash-points.ts'
import {
  DB_ENV,
  EXPECTED_EVENTS,
  HALF_EVENTS,
  MODE_ENV,
  REBUILD_POINT,
  SOURCE_ENV,
  emit,
  fail,
  readJsonlLines,
  requireEnv,
} from './surfaces-crash-scenario.ts'

function main(): void {
  const mode = process.env[MODE_ENV]
  if (mode !== 'crash' && mode !== 'run') fail(2, `${MODE_ENV} 须为 crash|run，实为 ${String(mode)}`)
  const target = requireEnv(DB_ENV)
  const source = requireEnv(SOURCE_ENV)
  const lines = readJsonlLines(source)
  if (lines.length !== EXPECTED_EVENTS) fail(3, `输入 JSONL 行数应为 ${String(EXPECTED_EVENTS)}，实为 ${String(lines.length)}`)

  if (mode === 'crash') {
    const ledger = openLedger(target)
    const before = ledger.queryEvents().length
    if (before !== 0) fail(4, `重建目标库应为空（0 events），实为 ${String(before)}`)
    ledger.db.exec('BEGIN')
    for (const line of lines.slice(0, HALF_EVENTS)) {
      ledger.appendEvent(JSON.parse(line))
    }
    const inTx = ledger.queryEvents().length
    if (inTx !== HALF_EVENTS) {
      ledger.db.exec('ROLLBACK')
      ledger.close()
      fail(5, `事务内 events 应为 ${String(HALF_EVENTS)}（半投影），实为 ${String(inTx)}`)
    }
    emit('PRE_COMMIT', {
      point: REBUILD_POINT,
      mode,
      replayed: HALF_EVENTS,
      total: EXPECTED_EVENTS,
      eventsInTx: inTx,
      version: ledger.version(),
      target,
      source,
    })
    crashHook(REBUILD_POINT) // 命中：SIGKILL（COMMIT 永不执行）；未命中：零行为
    ledger.db.exec('ROLLBACK')
    ledger.close()
    fail(91, 'CRASH_HOOK_NOT_ARMED：SN_CRASH_POINT 未命中 projection-rebuild；本进程不得提交（防假绿）')
  }

  // run 模式：崩溃后的重跑（生产 rebuild；单事务全量再生）
  const result = rebuild(source, target)
  const ledger = openLedger(target)
  const dbEvents = ledger.queryEvents().length
  const distinct = ledger.db.prepare('SELECT COUNT(DISTINCT id) AS c FROM events').get() as unknown as { c: number }
  const ids = ledger.queryEvents().map((event) => event.id)
  const costDaily = ledger.listCostDaily().length
  ledger.close()
  emit('REBUILT', {
    point: REBUILD_POINT,
    mode,
    events: result.events,
    version: result.version,
    excludedDomains: result.excludedDomains,
    dbEvents,
    distinctIds: Number(distinct.c),
    ids,
    costDaily,
  })
  if (result.events !== EXPECTED_EVENTS || dbEvents !== EXPECTED_EVENTS || Number(distinct.c) !== EXPECTED_EVENTS) {
    process.exit(5)
  }
}

main()
