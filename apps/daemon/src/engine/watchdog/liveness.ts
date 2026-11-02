/**
 * watchdog/liveness —— 工人活性面（看门狗 silentMs 锚；studio-dev-505）
 *
 * 规格依据（实现单引用）：
 *   - docs/02-F1-08 看门狗三道：daemon 侧兜底的判定面=工人活性，不是平台单据字段刷新；
 *   - docs/17-§2 相位 4 末段 / 相位 7 心跳：在工静默告警（stall_alarm）的静默定义；
 *   - docs/v2/07-§三 EXEC-01/EXEC-02：看护参数随派发；长周期工作必设进展信号/活性观察面；
 *     EXEC-03「常态更新不得杀活 worker」；EXEC-05 终态判据不压缩为布尔。
 *
 * 判定面与观测面分离（本件只产**证据**，判定在 core decide、处置在引擎）：
 *   - 活性锚（lastActivityAt）优先序＝会话 mtime（adapter 面，跨重启可读）> 流事件时刻
 *     （引擎泵收面）> 缺省（交 decide 回退 issue.updated——回退面在台账 note 可审计）；
 *   - 存活（pidAlive）与活性是**两件事**：进程活着 ≠ 在干活（僵死进程仍会达阈被杀）；
 *     只有「进程已退出」才走免杀收口路径（不冒认杀死）。
 *
 * 边界：纯读探测（readdir/stat/process.kill(pid,0)），零台账写入、零平台 IO；时钟一律
 * 入参（引擎 tick 时钟），与 core 时间纪律同源。本件不判定、不处置。
 */
import { probeExecutorActivity } from '@studio-next/adapters'
import type { LivenessSource, WorkerLiveness } from '@studio-next/core'
import type { WorkRecord } from '@studio-next/store'
import type { Inflight } from '../tick/types.ts'

/** 在途工位活性快照（A 面 kill 前复核与 decide 喂数共用） */
export interface InflightActivity {
  /** 活性锚 epoch-ms（无任何 worker 侧证据时缺省） */
  readonly lastActivityAt?: number
  /** 活性锚来源（有 lastActivityAt 时必有） */
  readonly source?: LivenessSource
  /** 进程是否存活（pid 不可判定＝true——不据此免杀） */
  readonly pidAlive: boolean
  /** 可审计归因（台账 note 用；只含 mtime/来源/错误，不含凭据） */
  readonly detail: string
  /** 探测不可用/部分失败归因（不静默） */
  readonly probeError?: string
}

/** pid 存活探测：ESRCH=已退出；EPERM=存在但不可信号（视为存活）；pid<=0=不可判定（视存活） */
export function isProcessAlive(pid: number | undefined): boolean {
  if (pid === undefined || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * 在途工位活性探测（A 面）。
 * 会话 mtime 需 `Handle.executorSessionId`（dsh 流首会话事件后由适配器回填）；未回填时
 * 只有流事件锚——两锚缺失＝无证据，交 decide 回退 issue.updated（旧世界字节不变）。
 */
export function probeInflightActivity(entry: Inflight, at: number, opts: { dshHome?: string } = {}): InflightActivity {
  const session = probeExecutorActivity({
    executor: entry.executor,
    ...(entry.handle.executorSessionId !== undefined ? { executorSessionId: entry.handle.executorSessionId } : {}),
    ...(opts.dshHome !== undefined ? { dshHome: opts.dshHome } : {}),
    now: at,
  })
  const streamAt = entry.lastStreamEventAt
  let lastActivityAt: number | undefined
  let source: LivenessSource | undefined
  if (session.lastActivityAt !== undefined && (lastActivityAt === undefined || session.lastActivityAt >= lastActivityAt)) {
    lastActivityAt = session.lastActivityAt
    source = session.source
  }
  if (streamAt !== undefined && (lastActivityAt === undefined || streamAt > lastActivityAt)) {
    lastActivityAt = streamAt
    source = 'stream-event'
  }
  const pidAlive = isProcessAlive(entry.handle.pid)
  const parts = [
    `${entry.executor} session=${entry.handle.sessionId} pid=${entry.handle.pid}`,
    `pidAlive=${pidAlive}`,
    session.lastActivityAt !== undefined ? `sessionMtime=${new Date(session.lastActivityAt).toISOString()}（${session.detail}）` : `session=${session.reason ?? 'unavailable'}`,
    streamAt !== undefined ? `streamEventAt=${new Date(streamAt).toISOString()}` : 'streamEvent=（无事件或未泵收）',
  ]
  return {
    ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
    ...(source !== undefined ? { source } : {}),
    pidAlive,
    detail: parts.join('；'),
    ...(session.reason !== undefined && session.reason !== 'not-found' && session.reason !== 'session-id-unknown' ? { probeError: session.detail } : {}),
  }
}

/** 在途活性 → decide 入参（无 worker 侧证据＝undefined：decide 回退 issue.updated） */
export function livenessOfActivity(activity: InflightActivity): WorkerLiveness | undefined {
  if (activity.lastActivityAt === undefined || activity.source === undefined) return undefined
  return {
    lastActivityAt: activity.lastActivityAt,
    source: activity.source,
    ...(activity.probeError !== undefined ? { probeError: activity.probeError } : {}),
  }
}

/**
 * 台账工位行 → 活性锚（B 面/无在途句柄）。
 *   - interrupted：确定性消亡（worker 已收口、无句柄）→ workerGone=true，引擎即时收口，
 *     不再等陈旧锚 60min（studio-dev-505 实证：16 单 interrupted 记录平均早于 WORKER_DEAD
 *     判定 ~60min）；
 *   - failed：终态但非「消亡面」口径，只作活性锚（从死亡时刻起算阈值，不即时）；
 *   - done：成功收口（收割迁移在途崩溃面）——不作活性证据，交 decide 回退（不冒认死亡）；
 *   - running：孤儿行（正常进程内不产生）——从 started_at 起算，仍走阈值。
 */
export function recordLiveness(rec: WorkRecord | undefined): WorkerLiveness | undefined {
  if (rec === undefined) return undefined
  if (rec.status === 'done') return undefined
  const anchor = rec.ended_at ?? rec.started_at
  return {
    lastActivityAt: anchor,
    source: 'work-record',
    ...(rec.status === 'interrupted' ? { workerGone: true } : {}),
  }
}

/** 按 executor 分级解析生效阈值（缺省回退 base；坏配在配置装载期 fail-closed 拒启） */
export function effectiveStallAfterMs(
  base: number,
  byExecutor: Readonly<Record<string, number>> | undefined,
  executor: string | undefined,
): number {
  if (byExecutor === undefined || executor === undefined) return base
  return byExecutor[executor] ?? base
}
