/**
 * control/restart/selfcheck-run —— 重启后自检的落盘/留痕编排（studio-dev-504 S5）
 *
 * 从 run.ts 析出（20-§十五.三 尺寸阈 600 行「先拆再增」）：纯判定器在 ./selfcheck.ts，
 * 本件负责「取探针→判定→写 selfcheck-*.json→SCHEMA_EVOLVE;RESTART;phase=selfcheck 留痕→
 * 失败 DAILY_ALARM+ESCALATE」。不阻塞主循环首拍（serve 在拍边界调用一次）。
 *
 * 依据：#497 plan §4.8（四口径/失败即 ALARM/不宣称恢复）；C-1（事件名不扩契约，note 过渡）。
 */
import path from 'node:path'
import type { Ledger } from '@studio-next/store'
import { appendDaemonEvent, appendRestartEvent, restartNote } from './channel.ts'
import { writeSelfcheckReport, type RestartCheckpoint } from './checkpoint.ts'
import { evaluateRestartSelfcheck, type RestartSelfcheckProbes } from './selfcheck.ts'

export interface RestartSelfcheckDeps {
  ledger: Ledger
  rootDir: string
  company: string
  checkpoint: RestartCheckpoint
  ticksSinceStart: number
  processStartedAt: number
  cursorLoopSeen: boolean
  takeover: number
  versionAlignPolicy: 'advance' | 'strict' | 'off'
  /** tick 口径窗口（restartSelfcheckTicks） */
  minTicks: number
  restartProbe: {
    models: () => { catalogLoaded: boolean; mainWorkerTier: string | undefined; demoBypass: boolean }
    executors: () => Promise<{ count: number; failures: readonly string[] }>
  }
  metaOf: (personId: string) => { level: number; dept: string }
  log: (line: string) => void
  error: (line: string) => void
  now: () => number
}

/** 检查点摘要缺失（last-exit 有 restart 标记但读不回）：ALARM 如实上报，不静默跳自检 */
export function alarmRestartCheckpointMissing(
  ledger: Ledger,
  args: { company: string; level: number; dept: string; requestId: string | undefined; now: number },
): void {
  try {
    appendDaemonEvent(ledger, {
      event: 'DAILY_ALARM',
      company: args.company,
      level: args.level,
      dept: args.dept,
      now: args.now,
      note: `RESTART_SELFCHECK_FAIL;reason=checkpoint-missing;request_id=${args.requestId ?? '-'}`,
    })
  } catch {
    // 台账不可写：调用方仍落错误行，留痕缺口不静默
  }
}

/** 拍边界执行一次自检（幂等由调用方 selfcheckDone 闸保证；恒不抛——失败只留痕） */
export async function runRestartSelfcheckAtBoundary(deps: RestartSelfcheckDeps): Promise<void> {
  const { ledger, checkpoint } = deps
  const meta = deps.metaOf(checkpoint.authorizer.personId)
  try {
    const execProbe = await deps.restartProbe.executors()
    const probes: RestartSelfcheckProbes = {
      ticksSinceStart: deps.ticksSinceStart,
      tickSeq: () => Number(ledger.kvGet('tick.seq') ?? '0'),
      cursor: () => {
        const v = ledger.kvGet('activity.cursor')
        return v === null || v === '' ? null : v
      },
      heartbeatSeen: () => ledger.queryEvents({ company: deps.company, since: deps.processStartedAt }).some((e) => e.event === 'HEARTBEAT'),
      cursorLoopSeen: () => deps.cursorLoopSeen,
      models: () => deps.restartProbe.models(),
      executor: () => execProbe,
      takeover: () => deps.takeover,
      versionAlign: () => (deps.versionAlignPolicy === 'off' ? 'off' : checkpoint.repoHead === null ? 'unknown' : 'aligned'),
      now: deps.now,
      minTicks: deps.minTicks,
    }
    const report = evaluateRestartSelfcheck(checkpoint, probes)
    const file = writeSelfcheckReport(deps.rootDir, report)
    appendRestartEvent(ledger, {
      company: deps.company,
      ...meta,
      now: deps.now(),
      note: restartNote('selfcheck', [
        ['result', report.result],
        ['tick', report.checks.tick.pass ? 'pass' : 'fail'],
        ['cursor', report.checks.cursor.pass ? 'pass' : 'fail'],
        ['models', report.checks.models.pass ? 'pass' : 'fail'],
        ['executor', report.checks.executor.pass ? 'pass' : 'fail'],
        ['checkpoint_ref', report.checkpointRef ?? 'none'],
        ['file', path.basename(file)],
      ]),
    })
    if (report.result === 'pass') {
      deps.log(`[serve] 受权重启自检四口径全过（tick/cursor/models/executor）——恢复宣告成立（${file}）`)
      return
    }
    deps.error(`[serve] 受权重启自检失败：${JSON.stringify(report.checks)}（${file}）——不宣称已恢复`)
    appendDaemonEvent(ledger, {
      event: 'DAILY_ALARM',
      company: deps.company,
      ...meta,
      now: deps.now(),
      note: `RESTART_SELFCHECK_FAIL;request_id=${checkpoint.requestId};tick=${report.checks.tick.pass ? 'pass' : 'fail'};cursor=${report.checks.cursor.pass ? 'pass' : 'fail'};models=${report.checks.models.pass ? 'pass' : 'fail'};executor=${report.checks.executor.pass ? 'pass' : 'fail'};inflight_reconcile=${report.inflightReconcile.pass ? 'pass' : 'fail'}`,
    })
    appendDaemonEvent(ledger, {
      event: 'ESCALATE',
      company: deps.company,
      ...meta,
      now: deps.now(),
      note: `RESTART_SELFCHECK_FAIL 具名接收：部门主管/制作人——自查点 ${checkpoint.requestId} 重启后未达四口径，禁止宣称已恢复`,
    })
  } catch (err) {
    deps.error(`[serve] 受权重启自检执行异常：${err instanceof Error ? err.message : String(err)}（不宣称已恢复）`)
    try {
      appendDaemonEvent(ledger, {
        event: 'DAILY_ALARM',
        company: deps.company,
        ...meta,
        now: deps.now(),
        note: `RESTART_SELFCHECK_FAIL;request_id=${checkpoint.requestId};reason=selfcheck-exception`,
      })
    } catch {
      // 台账不可写：日志已如实上报，留痕缺口不静默
    }
  }
}
