/**
 * workbench-chatd 入口（Phase1 模块 A / P1-1b）。
 * 启动：node --experimental-strip-types apps/workbench-chatd/src/main.ts
 * env：见 src/config.ts（WORKBENCH_CHATD_SOCKET / _TOKEN / _ALLOW_NO_AUTH / _DELAY_MS / _DRAIN_TIMEOUT_MS / _LOG）。
 * 日志：stderr 单行 JSON；ready 事件（event:"ready"）= socket 可用信号（测试/看护消费）。
 */
import { loadConfig, ChatdConfigError, type ChatdConfig } from './config.ts'
import { createChatdServer } from './server.ts'
import { installSignalHandlers } from './lifecycle.ts'
import { createLogger } from './log.ts'
import { SERVER_MODE, SERVER_NAME, SERVER_VERSION, WORKBENCH_CHATD_PROTOCOL } from './health.ts'

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
        mode: SERVER_MODE,
        protocol: WORKBENCH_CHATD_PROTOCOL,
        socketPath: config.socketPath,
        auth: config.token !== undefined ? 'token' : 'off',
        delayMs: config.delayMs,
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
