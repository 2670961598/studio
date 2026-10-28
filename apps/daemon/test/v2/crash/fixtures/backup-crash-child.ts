/**
 * backup-crash-child —— MIG-06 第 7 点 backup-snapshot V2 crash 腿子进程（真实 SIGKILL，无 mock）
 *
 * 依据：plan/03 MIG-06「记录面注入点补点」；plan/04 §1.6（记录面四点扩展）；docs/v2/17 §1.1 V5。
 *
 * 两种模式（SN_SURFACES_MODE 选择；库路径 SN_SURFACES_DB；输出件 SN_SURFACES_OUT）：
 *   - crash：用生产 backupCostDaily 把**全量**备份 staging 到 `<out>.partial`（含全量摘要侧车），
 *     随后只保留前半 JSONL 字节（模拟写入被截断、侧车已按全量身份落盘），同步打印 PRE_COMMIT，
 *     再在 rename 完成屏障前调 crashHook('backup-snapshot')——命中即 SIGKILL（canonical 永不出现）；
 *     未命中则清掉 staging 残留后 exit 91（绝不以 exit 0 冒充崩溃）。
 *   - commit：生产 backupCostDaily 直写 canonical `<out>`＋`<out>.sha256`（崩溃后的重跑腿）。
 *
 * 三不变量（断言在 surfaces-crash.test.ts）：
 *   不假绿＝未命中必须 exit 91、命中必须 SIGKILL；不丢终态＝源库只读、4 行原样；
 *   不重复副作用＝重跑覆盖出同一全量身份（sha 一致），不产生第二份 canonical。
 *
 * 边界：测试子进程，不进生产面；**不新增生产调用点**（crashHook 只在本测试夹具里调用）。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { openLedger } from '@studio-next/store'
import { backupCostDaily } from '../../../../../../packages/store/src/backup.ts'
import { crashHook } from '../../../../src/engine/crash-points.ts'
import {
  BACKUP_POINT,
  DB_ENV,
  EXPECTED_COST_ROWS,
  HALF_COST_ROWS,
  MODE_ENV,
  OUT_ENV,
  emit,
  fail,
  requireEnv,
} from './surfaces-crash-scenario.ts'

function main(): void {
  const mode = process.env[MODE_ENV]
  if (mode !== 'crash' && mode !== 'commit') fail(2, `${MODE_ENV} 须为 crash|commit，实为 ${String(mode)}`)
  const dbPath = requireEnv(DB_ENV)
  const outPath = requireEnv(OUT_ENV)

  const ledger = openLedger(dbPath)
  const rows = ledger.listCostDaily().length
  if (rows !== EXPECTED_COST_ROWS) fail(3, `备份源库基线不符（期望 cost_daily=${String(EXPECTED_COST_ROWS)}）：实为 ${String(rows)}`)

  const partialPath = `${outPath}.partial`
  const partialDigestPath = `${partialPath}.sha256`

  if (mode === 'crash') {
    // staging 全量（生产序列化＋侧车），再把字节截到一半：侧车仍声明全量身份
    const staged = backupCostDaily(ledger.db, partialPath)
    const fullText = readFileSync(partialPath, 'utf8')
    const lines = fullText.split('\n').filter((line) => line !== '')
    if (lines.length !== EXPECTED_COST_ROWS) fail(4, `staging 行数应为 ${String(EXPECTED_COST_ROWS)}，实为 ${String(lines.length)}`)
    const halfText = lines.slice(0, HALF_COST_ROWS).map((line) => `${line}\n`).join('')
    writeFileSync(partialPath, halfText, 'utf8')
    emit('PRE_COMMIT', {
      point: BACKUP_POINT,
      mode,
      totalLines: staged.lines,
      partialLines: HALF_COST_ROWS,
      declaredSha256: staged.sha256,
      digestPath: partialDigestPath,
      partialPath,
      outPath,
      sourceRows: rows,
    })
    crashHook(BACKUP_POINT) // 命中：SIGKILL（rename/canonical 永不执行）；未命中：零行为
    // 未命中点名＝本进程不得完成备份——清 staging 后以专用退出码上报（防假绿）
    rmSync(partialPath, { force: true })
    rmSync(partialDigestPath, { force: true })
    ledger.close()
    fail(91, 'CRASH_HOOK_NOT_ARMED：SN_CRASH_POINT 未命中 backup-snapshot；本进程不得完成备份（防假绿）')
  }

  // commit 模式：崩溃后的重跑（生产唯一备份写口；同库同内容 → 同字节 → 同 sha256）
  const backup = backupCostDaily(ledger.db, outPath)
  emit('COMMITTED', {
    point: BACKUP_POINT,
    mode,
    domain: backup.domain,
    lines: backup.lines,
    sha256: backup.sha256,
    digestPath: backup.digestPath,
    outPath,
  })
  ledger.close()
  if (backup.lines !== EXPECTED_COST_ROWS) process.exit(5)
}

main()
