/**
 * workbench-chatd 生命周期（Phase1 模块 A / P1-1b）：SIGTERM/SIGINT → 优雅停机（drain）→ exit。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A（优雅停止）；
 *       提案-Phase1聊天服务-2026-11-17.md §1.1（升级/停机：停旧→health+smoke）。
 * 语义：首个信号触发一次 drain；drain 期间再收信号不重启流程（记 warn）。
 * exit 注入仅为可测试性；生产由 main 传 process.exit。
 */
import type { Logger } from './log.ts'

export interface ShutdownDeps {
  readonly log: Logger
  readonly shutdown: () => Promise<void>
  readonly exit: (code: number) => void
}

export function installSignalHandlers(deps: ShutdownDeps): void {
  let shuttingDown = false
  const onSignal = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      deps.log.warn('signal_ignored', { signal, reason: 'already shutting down' })
      return
    }
    shuttingDown = true
    deps.log.info('signal', { signal })
    deps
      .shutdown()
      .then(() => {
        deps.log.info('shutdown_complete', { signal })
        deps.exit(0)
      })
      .catch((err: unknown) => {
        deps.log.error('shutdown_failed', { signal, message: err instanceof Error ? err.message : String(err) })
        deps.exit(1)
      })
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
}
