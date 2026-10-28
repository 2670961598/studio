/**
 * exclusion-crash-child —— MIG-06 第 9 点 exclusion-report V2 crash 腿子进程（真实 SIGKILL，无 mock）
 *
 * 依据：plan/03 MIG-06「记录面注入点补点」；plan/04 §1.6（rebuild 排除域报告写入中）；
 *       docs/v2/17 §1.1 V5；docs/v2/16 §四（报告不得声称钱账已重建；排除域显式列 cost_daily）。
 *
 * 两种模式（SN_SURFACES_MODE 选择；目标库 SN_SURFACES_DB；输入 JSONL SN_SURFACES_SOURCE；
 * 报告件 SN_SURFACES_OUT）：
 *   - crash：生产 rebuild 提交后，用生产 renderRebuildReport 渲染报告，把前一半行写进
 *     `<out>.partial`（缺排除域理由/备份行），同步打印 PRE_COMMIT，再在 rename 前调
 *     crashHook('exclusion-report')——命中即 SIGKILL（canonical 报告永不出现）；未命中则清掉
 *     staging 后 exit 91（防假绿）。
 *   - commit：同一渲染结果写 `<out>.partial` 后 rename 到 canonical（崩溃后的重跑腿）。
 *
 * 口径：store 只渲染报告文本，文件落盘写面由调用方承载——本子进程如实现「staging→rename」
 * 完成屏障；生产调用方若无此屏障则同受本点语义约束（登记缺口见基线追加节）。
 *
 * 边界：测试子进程，不进生产面；**不新增生产调用点**（crashHook 只在本测试夹具里调用）。
 */
import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { rebuild } from '@studio-next/store'
import { renderRebuildReport } from '../../../../../../packages/store/src/rebuild.ts'
import { crashHook } from '../../../../src/engine/crash-points.ts'
import {
  DB_ENV,
  EXCLUSION_POINT,
  EXPECTED_EVENTS,
  MODE_ENV,
  OUT_ENV,
  SOURCE_ENV,
  emit,
  fail,
  readJsonlLines,
  requireEnv,
} from './surfaces-crash-scenario.ts'

function main(): void {
  const mode = process.env[MODE_ENV]
  if (mode !== 'crash' && mode !== 'commit') fail(2, `${MODE_ENV} 须为 crash|commit，实为 ${String(mode)}`)
  const target = requireEnv(DB_ENV)
  const source = requireEnv(SOURCE_ENV)
  const reportPath = requireEnv(OUT_ENV)
  const lines = readJsonlLines(source)
  if (lines.length !== EXPECTED_EVENTS) fail(3, `输入 JSONL 行数应为 ${String(EXPECTED_EVENTS)}，实为 ${String(lines.length)}`)

  // 报告所据的重建结果：crash/commit 两腿都走生产 rebuild（目标已重建时 appendEvent 幂等跳过）
  const result = rebuild(source, target)
  const report = renderRebuildReport(result, target)
  const partialPath = `${reportPath}.partial`

  if (mode === 'crash') {
    const keep = Math.floor(report.length / 2)
    writeFileSync(partialPath, report.slice(0, keep).map((line) => `${line}\n`).join(''), 'utf8')
    emit('PRE_COMMIT', {
      point: EXCLUSION_POINT,
      mode,
      events: result.events,
      version: result.version,
      reportLines: report.length,
      partialLines: keep,
      excludedDomains: result.excludedDomains,
      target,
      reportPath,
      partialPath,
    })
    crashHook(EXCLUSION_POINT) // 命中：SIGKILL（rename 永不执行）；未命中：零行为
    rmSync(partialPath, { force: true })
    fail(91, 'CRASH_HOOK_NOT_ARMED：SN_CRASH_POINT 未命中 exclusion-report；本进程不得完成报告（防假绿）')
  }

  // commit 模式：staging → rename 完成屏障（崩溃后的重跑）
  writeFileSync(partialPath, report.map((line) => `${line}\n`).join(''), 'utf8')
  renameSync(partialPath, reportPath)
  emit('COMMITTED', {
    point: EXCLUSION_POINT,
    mode,
    events: result.events,
    version: result.version,
    reportLines: report.length,
    excludedDomains: result.excludedDomains,
    target,
    reportPath,
  })
  if (result.events !== EXPECTED_EVENTS) process.exit(5)
}

main()
