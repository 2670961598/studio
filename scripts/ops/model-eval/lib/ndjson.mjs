/**
 * ndjson.mjs —— dsh headless `--json` 事件流解析与汇总（纯函数）
 *
 * 形态依据：packages/adapters/src/streams.ts（dsh 八类事件真机形态）＋
 * dsh-headless json-stream 投影源码：
 *   session{sessionId,cwd} → status(turn_start|step_start|step_end{usage?}|turn_end{reason}) →
 *   thinking/text{文本块} → tool_call{callId,tool,input} → tool_result{callId,status} →
 *   final{sessionId,reason,text}；开跑前失败为顶层 error{message}。
 * 铁律（docs/31-§7 P08）：终态只认 turn_end.reason.kind==='completed'；final 非空不算完成。
 * usage 只在 status/step_end 上（camelCase 四桶；不完整则整条省略）。
 */
import { tail } from './redact.mjs'

/**
 * 逐行解析 NDJSON。空行/非 JSON 行不丢——计入 badLines（留证据，不粉饰）。
 * @returns {{ events: object[], badLines: string[] }}
 */
export function parseNdjson(text) {
  const events = []
  const badLines = []
  for (const rawLine of String(text ?? '').split('\n')) {
    const line = rawLine.replace(/^\uFEFF/, '').trim()
    if (line === '') continue
    let obj
    try {
      obj = JSON.parse(line)
    } catch {
      badLines.push(line.slice(0, 200))
      continue
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      badLines.push(line.slice(0, 200))
      continue
    }
    events.push(obj)
  }
  return { events, badLines }
}

function finite(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function addUsage(total, usage) {
  if (usage === null || typeof usage !== 'object') return total
  if (total === null) total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0 }
  const input = finite(usage.inputTokens)
  const output = finite(usage.outputTokens)
  const cacheRead = finite(usage.cacheReadTokens)
  const cacheWrite = finite(usage.cacheWriteTokens)
  if (input !== undefined) total.input += input
  if (output !== undefined) total.output += output
  if (cacheRead !== undefined) total.cacheRead += cacheRead
  if (cacheWrite !== undefined) total.cacheWrite += cacheWrite
  total.steps += 1
  return total
}

/**
 * 事件序列 → 汇总（不改入参）。
 * @returns {{ sessionId: string|null, steps: number, toolCalls: number, toolErrors: number,
 *            usage: object|null, turnEnd: object|null, finalText: string|null,
 *            lastText: string, errorEvent: string|null, turnReason: object|null }}
 */
export function summarizeEvents(events) {
  let sessionId = null
  let steps = 0
  let toolCalls = 0
  let toolErrors = 0
  let usage = null
  let turnEnd = null
  let finalText = null
  let lastText = ''
  let errorEvent = null
  for (const ev of events) {
    switch (ev.type) {
      case 'session':
        if (typeof ev.sessionId === 'string') sessionId = ev.sessionId
        break
      case 'status':
        if (ev.phase === 'step_start') steps += 1
        else if (ev.phase === 'step_end') usage = addUsage(usage, ev.usage)
        else if (ev.phase === 'turn_end') turnEnd = ev
        break
      case 'text':
        if (typeof ev.text === 'string' && ev.text !== '') lastText = ev.text
        break
      case 'tool_call':
        toolCalls += 1
        break
      case 'tool_result':
        if (ev.status === 'error') toolErrors += 1
        break
      case 'final':
        if (typeof ev.text === 'string') finalText = ev.text
        break
      case 'error':
        if (errorEvent === null) errorEvent = typeof ev.message === 'string' ? ev.message : JSON.stringify(ev)
        break
      default:
        break
    }
  }
  const turnReason = turnEnd?.reason ?? null
  return { sessionId, steps, toolCalls, toolErrors, usage, turnEnd, finalText, lastText, errorEvent, turnReason }
}

/**
 * 一次 spawn 结果 → 运行汇总。`run` 形状同 exec.mjs 的 RunResult：
 * { stdout, stderr, exitCode, signal, spawnError, timedOut, latencyMs }。
 */
export function summarizeRun(run) {
  const { events, badLines } = parseNdjson(run?.stdout)
  const s = summarizeEvents(events)
  return {
    ...s,
    eventCount: events.length,
    badLines,
    stderrTail: tail(run?.stderr, 1_200),
    exitCode: run?.exitCode ?? null,
    signal: run?.signal ?? null,
    spawnError: run?.spawnError ?? null,
    timedOut: run?.timedOut === true,
    latencyMs: finite(run?.latencyMs) ?? null,
  }
}

/** usage 四桶 → tokens 总数（input+output；cacheRead 另列，不计入「新增」token）。 */
export function usageTotal(usage) {
  if (usage === null) return null
  return usage.input + usage.output
}
