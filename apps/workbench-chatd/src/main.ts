/**
 * workbench-chatd 入口（Phase1 模块 A / P1-1b + 模块 C 最小刀）。
 * 启动：node --experimental-strip-types apps/workbench-chatd/src/main.ts [--memory]
 * env：见 src/config.ts（WORKBENCH_CHATD_SOCKET / _TOKEN / _ALLOW_NO_AUTH / _DB / _DELAY_MS /
 *       _DRAIN_TIMEOUT_MS / _LOG / _WAKE_LEASE_MS）。
 * 存储：缺省内存 mock（向后兼容）；WORKBENCH_CHATD_DB=<绝对路径> 即 SQLite 持久化（send/read/ack/claim
 *       落库、重启恢复）；--memory 显式强制内存（优先于 env）。数据库文件 0600。
 * wake：claim 授予租约（TTL=WORKBENCH_CHATD_WAKE_LEASE_MS，缺省 30s）；过期重投≤3 次，超限 dead-letter；
 *       迁移全量落 append-only 审计（wake_events）。
 * 日志：stderr 单行 JSON；ready 事件（event:"ready"）= socket 可用信号（测试/看护消费）。
 */
import { loadConfig, ChatdConfigError, type ChatdConfig } from './config.ts'
import { createChatdServer } from './server.ts'
import { installSignalHandlers } from './lifecycle.ts'
import { createLogger } from './log.ts'
import { SERVER_NAME, SERVER_VERSION, WORKBENCH_CHATD_PROTOCOL } from './health.ts'

function main(): void {
  let config: ChatdConfig
  const bootLog = createLogger('info')
  try {
    config = loadConfig()
  } catch (err) {
    bootLog.error('config_invalid', { message: err instanceof ChatdConfigError ? err.message : String(err) })
    process.exit(1)
  }
  const log = createLogger(config.logLevel)
  if (config.token === undefined) log.warn('auth_disabled', { hint: '已显式 WORKBENCH_CHATD_ALLOW_NO_AUTH=1（仅 mock/dev/test）；未配 WORKBENCH_CHATD_TOKEN，生产必配' })
  const chatd = createChatdServer(config, log)

  process.on('unhandledRejection', (reason: unknown) => {
    log.error('unhandled_rejection', { message: reason instanceof Error ? reason.message : String(reason) })
    process.exit(1)
  })

  chatd
    .start()
    .then(() => {
      log.info('ready', {
        server: SERVER_NAME,
        version: SERVER_VERSION,
        store: config.storeMode,
        protocol: WORKBENCH_CHATD_PROTOCOL,
        socketPath: config.socketPath,
        dbPath: config.dbPath ?? null,
        auth: config.token !== undefined ? 'token' : 'off',
        delayMs: config.delayMs,
        wakeLeaseMs: config.wakeLeaseMs,
        pid: process.pid,
      })
      installSignalHandlers({ log, shutdown: () => chatd.stop(), exit: (code) => { process.exit(code) } })
    })
    .catch((err: unknown) => {
      log.error('start_failed', { message: err instanceof Error ? err.message : String(err) })
      process.exit(1)
    })
}

main()
