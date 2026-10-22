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
 *   - dsh（NDJSON，0.2.0-rc.2 真机形态——docs/31-§3.1/§7 实录）：顶层 type 八类
 *     session/status/thinking/text/tool_call/tool_result/final/error；step/turn 是 status
 *     事件的 phase 值；终态唯一判据 turn_end.reason.kind==='completed'；usage 仅在 step_end
 *     且 camelCase 四桶（inputTokens/outputTokens/cacheReadTokens→cached）。原「四类顶层
 *     事件 + snake_case usage + turn_end.completed 布尔」形态系证伪假设（docs/31-§4），
 *     已按真机重写（P0）
 *   - claude（stream-json）：result 事件是唯一终态——subtype==='success' 且 is_error!==true
 *     才 completed=true；result 文本与 assistant 文本归一为 log；system 归一为 log
 *   - codex（exec --json）：item.started/item.completed 归一为 step 对；
 *     agent_message 文本在 step_end 前以 log 透传；turn.completed.usage 挂 turn_end；
 *     turn.failed 无 usage（已知坑）——错误信息以 log 透传后给出 completed=false，
 *     且 error.message 一并挂 turn_end.error（协议 v1.1 裁决落地，codex 适配器首刀携带）
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

/**
 * dsh：`dsh --profile headless --json` 的 NDJSON——0.2.0-rc.2 真机八类事件（docs/31-§3.1
 * 形态学 + §7 五探针实录）。顶层 type：session / status / thinking / text / tool_call /
 * tool_result / final / error；step/turn 不是顶层类型，是 status 事件的 phase 值。
 *   - status+step_start/step_end → step 对（step 是 number，归一为字符串契约位）；
 *     usage 仅在 step_end、camelCase 四桶；「该 step 所有 attempt 都报了 usage 才出现」
 *     （A4 面实录）——缺席时 step_end 不带 usage 键
 *   - status+turn_end → 终态唯一判据 reason.kind==='completed'（枚举 completed/error/
 *     blocked/aborted/max-tokens，后四种一律 completed:false）；reason.error.code 进
 *     turn_end.errorCode 结构位（AUTH / MISSING_CREDENTIAL——v1.5 裁决，message 原文留在
 *     error，前缀方案废除，docs/31-§7 增量）；turn_end 恒无 usage（真机无此账）
 *   - status+turn_start 及未知 phase → 原文 log 透传（契约无 turn 位，turn 序号留证）
 *   - thinking/text/final → 正文 text 字段归一为 log；空文本不产事件（kill 面
 *     final:"" 的实录形态——终态判定绝不看 final 非空）
 *   - session/tool_call/tool_result → 原文 log 透传（契约无位；sessionId/cwd 与工具
 *     证据不丢，收存 sessionId 的 P1 项见 docs/31-§5-6）
 *   - error（预运行失败：usage error/未知 session-id 等）→ turn_end{completed:false,
 *     error} 等价映射（docs/31-§3.1 归一建议）
 */
function parseDsh(text: string): StreamEvent[] {
  const out: StreamEvent[] = []
  for (const line of lines(text)) {
    const v = parseJson(line)
    if (!isRecord(v)) {
      out.push(logEvent(line))
      continue
    }
    const type = asString(v['type'])
    if (type === 'status') {
      out.push(...parseDshStatus(v, line))
    } else if (type === 'thinking' || type === 'text' || type === 'final') {
      const t = asString(v['text'])
      if (t === undefined) {
        out.push(logEvent(line)) // 形态不合（无 text 字段）：原文透传
      } else if (t !== '') {
        out.push(logEvent(t)) // 空正文不产事件（final:"" 实录形态）
      }
    } else if (type === 'error') {
      const msg = asString(v['message'])
      if (msg !== undefined && msg !== '') {
        out.push({ type: 'turn_end', completed: false, error: msg })
      } else {
        out.push(logEvent(line))
      }
    } else {
      // session / tool_call / tool_result / 未知类型：契约无位——原文透传（不丢证据）
      out.push(logEvent(line))
    }
  }
  return out
}

/** dsh status 事件的 phase 分派（step/turn 状态都在这里——docs/31-§3.1；形态不合降级原文透传） */
function parseDshStatus(v: Record<string, unknown>, line: string): StreamEvent[] {
  const phase = asString(v['phase'])
  if (phase === 'step_start') {
    const step = asFiniteNumber(v['step']) // 真机是 number（docs/31-§4：string 假设证伪）
    if (step !== undefined) return [{ type: 'step_start', step: String(step) }]
  } else if (phase === 'step_end') {
    const step = asFiniteNumber(v['step'])
    if (step !== undefined) return [stepEndEvent(String(step), toUsageDsh(v['usage']))]
  } else if (phase === 'turn_end') {
    const reason = asRecord(v['reason'])
    const kind = reason === undefined ? undefined : asString(reason['kind'])
    if (reason !== undefined && kind !== undefined) {
      const err = asRecord(reason['error'])
      const message = err === undefined ? undefined : asString(err['message'])
      const code = err === undefined ? undefined : asString(err['code'])
      // errorCode 结构位（v1.5，2026-10-19 制作人批）：code 进 turn_end.errorCode，message
      // 原文保留在 error——旧 `${code}: ${message}` 前缀拼接方案废除（dsh 两个码 AUTH /
      // MISSING_CREDENTIAL 先行，docs/31-§7 P-04/A4；其余 executor 发现一个做一个）
      return [
        {
          type: 'turn_end',
          completed: kind === 'completed',
          ...(message !== undefined ? { error: message } : {}),
          ...(code !== undefined ? { errorCode: code } : {}),
        },
      ]
    }
  }
  // turn_start 及未识别/形态不合的 status：契约无位——原文透传（turn 序号留证：续跑面 turn:2）
  return [logEvent(line)]
}

/**
 * dsh 专属 usage 归一（camelCase——docs/31-§3.2 实测；与三家的 snake_case 面互不相干，
 * toUsage 不动）：input=inputTokens、output=outputTokens、cache_read=cacheReadTokens、
 * cache_creation=cacheWriteTokens（132-§6.1 单A·studio-dev-168 四桶直译——不再单桶坍缩，
 * cache 写桶此前采集即丢=缺陷 C2/判负线⑤）；totalTokens/reasoningTokens 契约 TokenCounts
 * 无位——弃（docs/31-§5-3）。input/output 缺任一则整条弃用（宁缺毋假，与「不完整则
 * 整条省略」同构）。写侧一律新键（cached 兼容键只在读侧认，kernel.TokenCounts 接口注）。
 */
function toUsageDsh(v: unknown): TokenCounts | undefined {
  const r = asRecord(v)
  if (r === undefined) return undefined
  const input = asFiniteNumber(r['inputTokens'])
  const output = asFiniteNumber(r['outputTokens'])
  if (input === undefined || output === undefined) return undefined
  const cacheRead = asFiniteNumber(r['cacheReadTokens'])
  const cacheCreation = asFiniteNumber(r['cacheWriteTokens'])
  return {
    input,
    output,
    ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}),
    ...(cacheCreation !== undefined ? { cache_creation: cacheCreation } : {}),
  }
}

/**
 * dsh 流首 session 事件的 sessionId 嗅探（P1 收存面，docs/31-§5-6/§3.1：`{type:'session',
 * sessionId, cwd}` 是流首事件——dsh 侧 session-<uuid>）。行不是 session 事件 / 形态不合 /
 * id 为空 → undefined（调用方只在未捕获时调用，捕获一次即止）。dsh 适配器 stream() 用它把
 * dsh 侧会话 id 写进 Handle.executorSessionId（契约 v1.5，2026-10-19 批）——续跑
 * （resumeWithSession --session-id 透传）与对账两便。v0.2 新增导出（既有行为一概不动）。
 */
export function extractDshSessionId(line: string): string | undefined {
  const v = parseJson(line)
  if (!isRecord(v) || v['type'] !== 'session') return undefined
  const sessionId = asString(v['sessionId'])
  return sessionId === undefined || sessionId === '' ? undefined : sessionId
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
      // 已知坑：turn.failed 不带 usage——completed:false 且无 usage（测试用 toStrictEqual 冻结）。
      // v1.1 裁决落地（codex 适配器首刀携带）：error.message 一并挂 turn_end.error，
      // 错误信息不只在 log 透传——契约 turn_end.error 字段已有（docs/25-§二），此处补映射
      out.push({
        type: 'turn_end',
        completed: false,
        ...(errMsg !== undefined && errMsg !== '' ? { error: errMsg } : {}),
      })
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
 * usage 归一：各家字段名统一到 TokenCounts（snake_case 面——claude/kimi/codex）。
 * 取值顺序（先命中先用）：input=input_tokens|input；output=output_tokens|output；
 * cache_read=cached_tokens|cache_read_input_tokens|cached（三家源均为**读缓存命中**语义
 * ——写桶三家现网事件无源，探针升级前 cache_creation 恒缺）。input/output 缺任一则
 * 整条弃用。产出键=新键 cache_read（132-§6.1 单A「写侧一律新键」，治 G7 桶键统一：
 * 源字段拼写 `cached_tokens`/`cached` 是 wire 面，不等于契约面产旧键）。
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
  const cacheRead = asFiniteNumber(
    r['cached_tokens'] !== undefined
      ? r['cached_tokens']
      : r['cache_read_input_tokens'] !== undefined
        ? r['cache_read_input_tokens']
        : r['cached'],
  )
  return { input, output, ...(cacheRead !== undefined ? { cache_read: cacheRead } : {}) }
}

/**
 * wire.jsonl 逐轮 usage 求和（kimi 伴生文件里多条记录=多轮，合计才是 turn 总账）。
 * v0.3 新增导出（kimi 适配器 stream() 会话结束后读 wire 合流复用）——求和口径不动，
 * 仅产出键随 132-§6.1 单A 升新键 cache_read（写侧一律新键，治 G7）。注意 docs/25-§3.1
 * 裁决#4：「逐轮求和=turn 总账」是假设，真实 wire 验证待办仍在（探针前不改本口径）。
 */
export function sumWireUsage(wireJsonlText: string): TokenCounts | undefined {
  let input = 0
  let output = 0
  let cacheRead = 0
  let seen = false
  let seenRead = false
  for (const line of lines(wireJsonlText)) {
    const v = parseJson(line)
    if (!isRecord(v) || v['type'] !== 'usage') continue
    const u = toUsage(v)
    if (u === undefined) continue
    seen = true
    input += u.input
    output += u.output
    if (u.cache_read !== undefined) {
      seenRead = true
      cacheRead += u.cache_read
    }
  }
  if (!seen) return undefined
  return { input, output, ...(seenRead ? { cache_read: cacheRead } : {}) }
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
