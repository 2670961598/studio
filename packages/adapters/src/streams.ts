/**
 * 流归一化器 —— 四家 CLI 原始 stdout 文本 → contract 的 StreamEvent 序列
 *
 * 依据：
 *   - docs/17-§6 执行与收割四原语表（各家流格式与已知坑的唯一权威）
 *   - docs/25-§二 StreamEvent 联合类型（各家 stdout 差异在适配器内消化）
 *   - docs/18-§1.3 独立测试套件（golden fixtures 落在 test/fixtures，解析器对 fixture 全绿）
 *
 * v0.1 冻结行为（测试对此负责，实现细节可换）：
 *   - parseStream(text, family) 同步解析全文，返回事件数组（流式增量版留给适配器 stream()）
 *   - 容错规则（四家一致）：BOM / CRLF 容忍；空行与井号开头行（fixture 头注释）跳过；
 *     解析失败或形态未识别的行不丢弃——降级为 {type:'log'} 原文透传（不粉饰、留证据）
 *   - dsh（NDJSON）：step_start/step_end/turn_end/log 四类事件直接映射，
 *     usage 从 input_tokens/output_tokens/cached_tokens 归一为 TokenCounts
 *   - claude（stream-json）：result 事件是唯一终态——subtype==='success' 且 is_error!==true
 *     才 completed=true；result 文本与 assistant 文本归一为 log；system 归一为 log
 *   - codex（exec --json）：item.started/item.completed 归一为 step 对；
 *     agent_message 文本在 step_end 前以 log 透传；turn.completed.usage 挂 turn_end；
 *     turn.failed 无 usage（已知坑）——错误信息以 log 透传后给出 completed=false
 *   - kimi（已知坑：usage 在 session wire.jsonl，不在 stdout）：stdout 形态与 claude 同构
 *     但无 usage；第三个可选参数 wireJsonlText 提供伴生文件内容，其中全部 usage 记录
 *     逐轮求和后挂到 stdout 的 turn_end 上。缺 wire / wire 无 usage 记录——追加一条
 *     log 明示（不静默降级）
 *
 * 协议疑点（只记录，不改 contract——见 docs/25 顺序铁律）：
 *   - StreamEvent 无 session_id/duration/cost 字段：claude result 里的 total_cost_usd/
 *     duration_ms/num_turns 与流事件无关，应由适配器 resultStats() 经 Handle 消化，此处弃用
 *   - ExecutorFamily（四家枚举）暂定义在本文件：docs/25-§3.1 的 ExecutorRegistration.name
 *     是自由字符串，contract 尚无 family 概念；若端口补此类型应回迁至 contract
 */
import type { StreamEvent, TokenCounts } from '@studio-next/contract'

/** executor 家族（协议依据 docs/17-§6 四原语表；类型归 contract 缺位的本地定义，见文件头疑点） */
export type ExecutorFamily = 'dsh' | 'claude' | 'codex' | 'kimi'

/** kimi 家族第三个参数：session wire.jsonl 全文（17-§6 已知坑：usage 在 wire 不在 stdout） */
export function parseStream(
  text: string,
  family: ExecutorFamily,
  wireJsonlText?: string,
): StreamEvent[] {
  switch (family) {
    case 'dsh':
      return parseDsh(text)
    case 'claude':
      return parseClaude(text)
    case 'codex':
      return parseCodex(text)
    case 'kimi':
      return parseKimi(text, wireJsonlText)
  }
}

/**
 * 单行解析入口（流式增量消费用；v0.2 新增导出——parseStream 既有行为一概不动）
 *
 * 背景：parseStream 是全文同步解析（v0.1 冻结行为）；适配器 stream() 逐行增量消费时
 * 需要等价的单行入口。行为契约：一行 → 0..N 个事件（codex 的 item.completed 对
 * agent_message 产出 log+step_end 两个）；空行/井号注释行 → []；BOM/CRLF 走 lines()
 * 同款归一。一致性：dsh/claude/codex 家族「text 逐行过 parseLine 再展平」与
 * parseStream(text) 等价；kimi 家族单行入口只做 claude 同构 stdout 解析——wire 合并
 * 与缺 wire 明示 log 是全文级附加（伴生文件按 session 而非按行），由适配器另行处理。
 */
export function parseLine(line: string, family: ExecutorFamily): StreamEvent[] {
  // 复用 lines() 的切割归一（BOM/CR/空行/注释跳过），单行场景等价于取切割后的第一行
  const first = [...lines(line)][0]
  if (first === undefined) return []
  switch (family) {
    case 'dsh':
      return parseDsh(first)
    case 'claude':
      return parseClaude(first)
    case 'codex':
      return parseCodex(first)
    case 'kimi':
      // 单行入口不做 wire 合并（全文级职责）——行为即 claude 同构 stdout 行
      return parseClaude(first)
  }
}

// ---------------------------------------------------------------------------
// 各家解析器
// ---------------------------------------------------------------------------

/** dsh：`dsh --profile headless --json` 的 NDJSON——step_end 带 usage、turn_end.completed（17-§6） */
function parseDsh(text: string): StreamEvent[] {
  const out: StreamEvent[] = []
  for (const line of lines(text)) {
    const v = parseJson(line)
    if (!isRecord(v)) {
      out.push(logEvent(line))
      continue
    }
    const type = asString(v['type'])
    if (type === 'step_start') {
      const step = asString(v['step'])
      if (step !== undefined) {
        out.push({ type: 'step_start', step })
        continue
      }
    } else if (type === 'step_end') {
      const step = asString(v['step'])
      if (step !== undefined) {
        out.push(stepEndEvent(step, toUsage(v['usage'])))
        continue
      }
    } else if (type === 'turn_end') {
      const completed = asBoolean(v['completed'])
      if (completed !== undefined) {
        out.push(turnEndEvent(completed, toUsage(v['usage'])))
        continue
      }
    } else if (type === 'log') {
      const logText = asString(v['text'])
      if (logText !== undefined) {
        out.push(logEvent(logText))
        continue
      }
    }
    out.push(logEvent(line))
  }
  return out
}

/** claude：`claude -p --output-format stream-json`——终态只认 result 事件（17-§6） */
function parseClaude(text: string): StreamEvent[] {
  const out: StreamEvent[] = []
  for (const line of lines(text)) {
    const v = parseJson(line)
    if (!isRecord(v)) {
      out.push(logEvent(line))
      continue
    }
    const type = asString(v['type'])
    if (type === 'system') {
      const subtype = asString(v['subtype']) ?? 'unknown'
      out.push(logEvent(`system:${subtype}`))
    } else if (type === 'assistant') {
      const assistantText = extractAssistantText(v['message'])
      if (assistantText !== '') out.push(logEvent(assistantText))
    } else if (type === 'result') {
      const resultText = asString(v['result'])
      if (resultText !== undefined && resultText !== '') out.push(logEvent(resultText))
      const completed = asString(v['subtype']) === 'success' && asBoolean(v['is_error']) !== true
      out.push(turnEndEvent(completed, toUsage(v['usage'])))
    } else {
      out.push(logEvent(line))
    }
  }
  return out
}

/** codex：`codex exec --json`——turn.completed.usage 给 tokens；turn.failed 无 usage（17-§6） */
function parseCodex(text: string): StreamEvent[] {
  const out: StreamEvent[] = []
  for (const line of lines(text)) {
    const v = parseJson(line)
    if (!isRecord(v)) {
      out.push(logEvent(line))
      continue
    }
    const type = asString(v['type'])
    if (type === 'item.started') {
      const item = asRecord(v['item'])
      const itemType = item === undefined ? undefined : asString(item['type'])
      if (itemType !== undefined) {
        out.push({ type: 'step_start', step: itemType })
        continue
      }
    } else if (type === 'item.completed') {
      const item = asRecord(v['item'])
      const itemType = item === undefined ? undefined : asString(item['type'])
      if (item !== undefined && itemType !== undefined) {
        // agent_message 的文本是交付物正文：先透传为 log，再收 step_end（顺序冻结进测试）
        if (itemType === 'agent_message') {
          const msgText = asString(item['text'])
          if (msgText !== undefined && msgText !== '') out.push(logEvent(msgText))
        }
        out.push(stepEndEvent(itemType, toUsage(item['usage'])))
        continue
      }
    } else if (type === 'turn.completed') {
      out.push(turnEndEvent(true, toUsage(v['usage'])))
      continue
    } else if (type === 'turn.failed') {
      const err = asRecord(v['error'])
      const errMsg = err === undefined ? undefined : asString(err['message'])
      if (errMsg !== undefined && errMsg !== '') out.push(logEvent(`turn failed: ${errMsg}`))
      // 已知坑：turn.failed 不带 usage——completed=false 且无 usage（测试用 toStrictEqual 冻结）
      out.push(turnEndEvent(false, undefined))
      continue
    }
    out.push(logEvent(line))
  }
  return out
}

/**
 * kimi：`kimi -p --output-format stream-json`——stdout 形态与 claude 同构但无 usage，
 * usage 在 session wire.jsonl（17-§6 已知坑）。wire 中全部 usage 记录逐轮求和挂到
 * 最后一个 turn_end；stdout 没有 turn_end 可挂时明示一条 log。
 */
function parseKimi(text: string, wireJsonlText: string | undefined): StreamEvent[] {
  const out = parseClaude(text)
  if (wireJsonlText === undefined) {
    out.push(logEvent('[kimi] wire.jsonl not provided; usage unavailable（17-§6 已知坑）'))
    return out
  }
  const summed = sumWireUsage(wireJsonlText)
  if (summed === undefined) {
    out.push(logEvent('[kimi] no usage record in wire.jsonl; usage unavailable'))
    return out
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const ev = out[i]
    if (ev !== undefined && ev.type === 'turn_end') {
      out[i] = { ...ev, usage: summed }
      return out
    }
  }
  out.push(logEvent('[kimi] wire usage found but stdout has no turn_end to attach'))
  return out
}

// ---------------------------------------------------------------------------
// 内部工具（纯手写，零运行时依赖）
// ---------------------------------------------------------------------------

/** 逐行切割：去 BOM、去行尾 CR、跳过空行与井号注释行（fixture 头注释约定） */
function* lines(text: string): Generator<string> {
  const normalized = text.startsWith('\u{FEFF}') ? text.slice(1) : text
  for (const raw of normalized.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (line.trim() === '') continue
    if (line.trimStart().startsWith('#')) continue
    yield line
  }
}

/** 解析单行 JSON；失败返回 undefined（调用方降级为 log 原文透传） */
function parseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown
  } catch {
    return undefined
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asBoolean(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

/**
 * usage 归一：各家字段名统一到 TokenCounts。
 * 取值顺序（先命中先用）：input=input_tokens|input；output=output_tokens|output；
 * cached=cached_tokens|cache_read_input_tokens|cached。input/output 缺任一则整条弃用。
 */
function toUsage(v: unknown): TokenCounts | undefined {
  const r = asRecord(v)
  if (r === undefined) return undefined
  const input = asFiniteNumber(
    r['input_tokens'] !== undefined ? r['input_tokens'] : r['input'],
  )
  const output = asFiniteNumber(
    r['output_tokens'] !== undefined ? r['output_tokens'] : r['output'],
  )
  if (input === undefined || output === undefined) return undefined
  const cached = asFiniteNumber(
    r['cached_tokens'] !== undefined
      ? r['cached_tokens']
      : r['cache_read_input_tokens'] !== undefined
        ? r['cache_read_input_tokens']
        : r['cached'],
  )
  return { input, output, ...(cached !== undefined ? { cached } : {}) }
}

/** wire.jsonl 逐轮 usage 求和（kimi 伴生文件里多条记录=多轮，合计才是 turn 总账） */
function sumWireUsage(wireJsonlText: string): TokenCounts | undefined {
  let input = 0
  let output = 0
  let cached = 0
  let seen = false
  for (const line of lines(wireJsonlText)) {
    const v = parseJson(line)
    if (!isRecord(v) || v['type'] !== 'usage') continue
    const u = toUsage(v)
    if (u === undefined) continue
    seen = true
    input += u.input
    output += u.output
    cached += u.cached ?? 0
  }
  return seen ? { input, output, cached } : undefined
}

/** 从 claude/kimi 的 assistant message 里拼接 text 块（tool_use 等非文本块忽略） */
function extractAssistantText(message: unknown): string {
  const m = asRecord(message)
  if (m === undefined) return ''
  const content = m['content']
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = asRecord(block)
    if (b === undefined || b['type'] !== 'text') continue
    const t = asString(b['text'])
    if (t !== undefined && t !== '') parts.push(t)
  }
  return parts.join('\n')
}

function asFiniteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

// exactOptionalPropertyTypes 纪律：可选属性不得显式赋 undefined——用条件展开构造
function stepEndEvent(step: string, usage: TokenCounts | undefined): StreamEvent {
  return { type: 'step_end', step, ...(usage !== undefined ? { usage } : {}) }
}

function turnEndEvent(completed: boolean, usage: TokenCounts | undefined): StreamEvent {
  return { type: 'turn_end', completed, ...(usage !== undefined ? { usage } : {}) }
}

function logEvent(text: string): StreamEvent {
  return { type: 'log', text }
}
