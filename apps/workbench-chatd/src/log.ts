/**
 * workbench-chatd 结构化日志（Phase1 模块 A / P1-1b）。
 * 依据：docs/sentinel-logs/Phase1实现拆解-2026-11-17.md 模块 A；提案-Phase1聊天服务 §1.1（stdout/stderr 归档）。
 * 形态：stderr 单行 JSON（NDJSON），launchd StandardErrorPath 归档；不写文件、不引依赖。
 * 纪律：绝不把 token/密钥值写进 fields（调用方也不得传）；本文件不感知业务语义。
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 }
const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']

export interface Logger {
  readonly debug: (event: string, fields?: Readonly<Record<string, unknown>>) => void
  readonly info: (event: string, fields?: Readonly<Record<string, unknown>>) => void
  readonly warn: (event: string, fields?: Readonly<Record<string, unknown>>) => void
  readonly error: (event: string, fields?: Readonly<Record<string, unknown>>) => void
}

const defaultSink = (line: string): void => {
  process.stderr.write(`${line}\n`)
}

/** 建日志器；level 以下丢弃。sink 可注入（测试用）。 */
export function createLogger(level: LogLevel, sink: (line: string) => void = defaultSink): Logger {
  const write = (lv: LogLevel, event: string, fields: Readonly<Record<string, unknown>> | undefined): void => {
    if (LEVEL_WEIGHT[lv] < LEVEL_WEIGHT[level]) return
    sink(JSON.stringify({ ts: new Date().toISOString(), level: lv, event, ...(fields ?? {}) }))
  }
  return {
    debug: (event, fields) => { write('debug', event, fields) },
    info: (event, fields) => { write('info', event, fields) },
    warn: (event, fields) => { write('warn', event, fields) },
    error: (event, fields) => { write('error', event, fields) },
  }
}

/** 解析日志级别；非法值返回 undefined（由 config 报错）。 */
export function parseLogLevel(value: string): LogLevel | undefined {
  const v = value.trim().toLowerCase()
  return (LEVELS as readonly string[]).includes(v) ? (v as LogLevel) : undefined
}
