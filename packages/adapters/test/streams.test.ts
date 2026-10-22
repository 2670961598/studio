/**
 * 流归一化器 golden 测试 —— 只对冻结行为负责（docs/18-§1.3：解析器对 fixture 全绿）
 *
 * 覆盖：四家 golden fixtures 逐一断言（dsh=0.2.0-rc.2 真机五探针+A4 实录，docs/31-§7）+
 * kimi wire 合并（求和挂 turn_end）+ kimi 缺 wire 明示 + 畸形行容错（截断 JSON / 纯文本 /
 * BOM / CRLF / 空行与井号注释 / dsh 证伪旧形态降级）。
 * 断言用 toStrictEqual：usage 的「不存在」与 undefined 严格区分（exactOptionalPropertyTypes 口径）。
 * v1.5（2026-10-19 批）：dsh turn_end.errorCode 结构位（P04=AUTH / A4=MISSING_CREDENTIAL，
 * message 原文留 error——前缀方案废除）+ extractDshSessionId 嗅探（session-id 收存面）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractDshSessionId, parseStream } from '../src/streams.ts'
import type { StreamEvent } from '@studio-next/contract'

function fixture(...parts: string[]): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${parts.join('/')}`, import.meta.url)),
    'utf8',
  )
}

describe('dsh（0.2.0-rc.2 真机八类 NDJSON——docs/31-§3.1/§7；golden=五探针+A4 实录）', () => {
  it('P01 真成功流：八类事件逐行归一（session/turn_start 原文透传、camelCase usage、turn_end 无 usage 键）', () => {
    expect(parseStream(fixture('dsh', 'P01-真成功流.ndjson'), 'dsh')).toStrictEqual<
      StreamEvent[]
    >([
      {
        type: 'log',
        text: '{"type":"session","sessionId":"session-2d65719e-2aa4-416a-af42-4a612026e671","cwd":"/private/tmp"}',
      },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
      { type: 'log', text: 'Reply exactly PROBE-OK.' },
      { type: 'log', text: 'PROBE-OK' },
      { type: 'step_end', step: '1', usage: { input: 4510, output: 26, cache_read: 256 } },
      { type: 'turn_end', completed: true },
      { type: 'log', text: 'PROBE-OK' },
    ])
  })

  it('P04 错误凭据：errorCode=AUTH 结构位 + error=message 原文（v1.5 前缀方案废除）；usage 全 0（无缓存桶键）；final 空不产事件', () => {
    expect(parseStream(fixture('dsh', 'P04-错误凭据.ndjson'), 'dsh')).toStrictEqual<
      StreamEvent[]
    >([
      {
        type: 'log',
        text: '{"type":"session","sessionId":"session-c70a23a6-7b4f-4af8-89bf-4450515ea0b3","cwd":"/private/tmp"}',
      },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
      { type: 'step_end', step: '1', usage: { input: 0, output: 0 } },
      {
        type: 'turn_end',
        completed: false,
        error:
          '401 {"error":{"message":"The API Key appears to be invalid or may have expired. Please verify your credentials and try again.","type":"invalid_authentication_error"}}',
        errorCode: 'AUTH',
      },
    ])
  })

  it('A4 无凭证：MISSING_CREDENTIAL 失败分类面（与 AUTH 并列，errorCode 结构位）；step_end 无 usage 键（不完整则整条省略）', () => {
    expect(parseStream(fixture('dsh', 'A4-无凭证.ndjson'), 'dsh')).toStrictEqual<
      StreamEvent[]
    >([
      {
        type: 'log',
        text: '{"type":"session","sessionId":"session-0ec30278-155a-46f7-bdcf-2ba8f08c2081","cwd":"/private/tmp/dsh-probe2"}',
      },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
      { type: 'step_end', step: '1' },
      {
        type: 'turn_end',
        completed: false,
        error:
          'llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment',
        errorCode: 'MISSING_CREDENTIAL',
      },
    ])
  })

  it('P05 续跑面：turn:2 序号经 turn_start 原文透传留证；cacheReadTokens:4608（前缀缓存命中）→ cache_read（132-§6.1 单A 新键）', () => {
    const events = parseStream(fixture('dsh', 'P05-续跑.ndjson'), 'dsh')
    expect(events).toStrictEqual<StreamEvent[]>([
      {
        type: 'log',
        text: '{"type":"session","sessionId":"session-2d65719e-2aa4-416a-af42-4a612026e671","cwd":"/private/tmp"}',
      },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":2}' },
      { type: 'step_start', step: '1' },
      { type: 'log', text: 'The user asked me to reply exactly: PROBE-OK. Answer exact string only.' },
      { type: 'log', text: 'PROBE-OK' },
      { type: 'step_end', step: '1', usage: { input: 220, output: 37, cache_read: 4608 } },
      { type: 'turn_end', completed: true },
      { type: 'log', text: 'PROBE-OK' },
    ])
    // 续跑直证：turn 序号 2 存在于透传原文（同一 sessionId 第二回合）
    const turnStart = events[1]
    if (turnStart === undefined || turnStart.type !== 'log') {
      throw new Error('P05 第二事件应为 turn_start 原文透传 log')
    }
    expect(turnStart.text).toContain('"turn":2')
  })

  it('P07 AGENTS 通道：正文/终答文本如实归一（标记串=通道端到端实证的输出面）', () => {
    expect(parseStream(fixture('dsh', 'P07-AGENTS通道.ndjson'), 'dsh')).toStrictEqual<
      StreamEvent[]
    >([
      {
        type: 'log',
        text: '{"type":"session","sessionId":"session-56e434e6-0b73-4b0f-9357-1ae3062e78f2","cwd":"/private/tmp/dsh-agents-probe"}',
      },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
      { type: 'log', text: '4 AGENTS-CHANNEL-VERIFIED' },
      { type: 'log', text: '4 AGENTS-CHANNEL-VERIFIED' },
      { type: 'step_end', step: '1', usage: { input: 258, output: 32, cache_read: 4608 } },
      { type: 'turn_end', completed: true },
      { type: 'log', text: '4 AGENTS-CHANNEL-VERIFIED' },
    ])
  })

  // —— 132-§6.1 单A 四桶直译（studio-dev-168，判负线⑤）——
  // fixtures/ 是 0.2.0-rc.2 真机探针实录（deepseek 轨，无 cacheWriteTokens 线），此处用
  // docs/31-§3.2 五字段**形状**直构流（非探针实录，不入 fixtures 证据面）：
  // cacheReadTokens→cache_read、cacheWriteTokens→cache_creation、totalTokens/reasoningTokens
  // 契约无位弃置；写侧一律新键——归一结果不得含 `cached`（旧键只在读侧认）。
  it('单A 四桶直译：cacheWriteTokens→cache_creation 不丢（判负线⑤）+ cacheReadTokens→cache_read + 无位字段弃置 + 写侧不产 cached', () => {
    const ndjson = [
      '{"type":"session","sessionId":"session-four-bucket","cwd":"/private/tmp"}',
      '{"type":"status","phase":"turn_start","turn":1}',
      '{"type":"status","phase":"step_start","turn":1,"step":1}',
      '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":1200,"outputTokens":80,"totalTokens":1280,"cacheReadTokens":512,"cacheWriteTokens":256,"reasoningTokens":64}}',
      '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}',
      '{"type":"final","text":"FOUR-BUCKET-OK"}',
    ].join('\n')
    const events = parseStream(ndjson, 'dsh')
    expect(events).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: '{"type":"session","sessionId":"session-four-bucket","cwd":"/private/tmp"}' },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
      {
        type: 'step_end',
        step: '1',
        usage: { input: 1200, output: 80, cache_read: 512, cache_creation: 256 },
      },
      { type: 'turn_end', completed: true },
      { type: 'log', text: 'FOUR-BUCKET-OK' },
    ])
  })

  it('单A 无缓存桶流：step_end usage 仅 input/output → 不落缓存桶键（不编造 0 桶）', () => {
    const ndjson = [
      '{"type":"status","phase":"turn_start","turn":1}',
      '{"type":"status","phase":"step_start","turn":1,"step":1}',
      '{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}',
      '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}',
    ].join('\n')
    const events = parseStream(ndjson, 'dsh')
    expect(events).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
      { type: 'step_end', step: '1', usage: { input: 10, output: 5 } },
      { type: 'turn_end', completed: true },
    ])
  })

  it('P08 kill 面：空 final 无 turn_end——归一序列不含任何 turn_end 事件（终态判据唯一化的根据）', () => {
    const events = parseStream(fixture('dsh', 'P08-kill面.ndjson'), 'dsh')
    expect(events).toStrictEqual<StreamEvent[]>([
      {
        type: 'log',
        text: '{"type":"session","sessionId":"session-4e78cf0c-c9d9-4172-8364-c5ef43e8d147","cwd":"/private/tmp"}',
      },
      { type: 'log', text: '{"type":"status","phase":"turn_start","turn":1}' },
      { type: 'step_start', step: '1' },
    ])
    expect(events.some((e) => e.type === 'turn_end')).toBe(false)
  })
})

describe('extractDshSessionId（v1.5 session-id 收存面——docs/31-§5-6/§3.1：流首 session 事件带 dsh 侧 session-<uuid>）', () => {
  it('session 事件行 → sessionId 原样返回（P01 golden 首行）', () => {
    const line = '{"type":"session","sessionId":"session-2d65719e-2aa4-416a-af42-4a612026e671","cwd":"/private/tmp"}'
    expect(extractDshSessionId(line)).toBe('session-2d65719e-2aa4-416a-af42-4a612026e671')
  })

  it('非 session 行（status/text/final/error/纯文本/畸形 JSON）→ undefined', () => {
    expect(extractDshSessionId('{"type":"status","phase":"turn_start","turn":1}')).toBeUndefined()
    expect(extractDshSessionId('{"type":"final","text":"PROBE-OK"}')).toBeUndefined()
    expect(extractDshSessionId('{"type":"error","message":"boom"}')).toBeUndefined()
    expect(extractDshSessionId('plain text line')).toBeUndefined()
    expect(extractDshSessionId('{"type":"session","sessionId":')).toBeUndefined() // 截断 JSON
  })

  it('形态不合（sessionId 非字符串/空串）→ undefined（宁缺毋假）', () => {
    expect(extractDshSessionId('{"type":"session","sessionId":42}')).toBeUndefined()
    expect(extractDshSessionId('{"type":"session","sessionId":""}')).toBeUndefined()
    expect(extractDshSessionId('{"type":"session","cwd":"/tmp"}')).toBeUndefined()
  })
})

describe('claude（stream-json：终态只认 result 事件——17-§6）', () => {
  it('result-success：result 文本透传为 log，usage 归一（含 cache_read_input_tokens→cached）', () => {
    expect(parseStream(fixture('claude', 'result-success.jsonl'), 'claude')).toStrictEqual<
      StreamEvent[]
    >([
      { type: 'log', text: 'system:init' },
      { type: 'log', text: '读取任务书，定位验收命令…' },
      { type: 'log', text: '完成：streams.ts 交付且测试全绿' },
      { type: 'turn_end', completed: true, usage: { input: 1468, output: 233, cache_read: 5120 } },
    ])
  })

  it('result-error：is_error=true → completed=false；空 result 不产生 log', () => {
    expect(parseStream(fixture('claude', 'result-error.jsonl'), 'claude')).toStrictEqual<
      StreamEvent[]
    >([
      { type: 'log', text: 'system:init' },
      { type: 'log', text: '开始第一轮重试…' },
      { type: 'turn_end', completed: false, usage: { input: 9014, output: 8022 } },
    ])
  })
})

describe('codex（exec --json：turn.completed.usage；失败无 usage——17-§6）', () => {
  it('turn-completed：item 对归一为 step 对，agent_message 文本先 log 后 step_end', () => {
    expect(parseStream(fixture('codex', 'turn-completed.jsonl'), 'codex')).toStrictEqual<
      StreamEvent[]
    >([
      { type: 'step_start', step: 'command_execution' },
      { type: 'step_end', step: 'command_execution' },
      { type: 'step_start', step: 'agent_message' },
      { type: 'log', text: 'TODO 扫描完成，1 处待办' },
      { type: 'step_end', step: 'agent_message' },
      { type: 'turn_end', completed: true, usage: { input: 2100, output: 640 } },
    ])
  })

  it('turn-failed：错误信息 log 透传 + turn_end.error 挂载；completed=false 且无 usage 字段（不是 undefined 值）', () => {
    // 2026-10 随 codex 适配器首刀更新：turn_end 增加 error 字段（协议 v1.1 裁决——
    // turn.failed→turn_end{completed:false,error} 映射补入 streams.ts，CLI 泳道裁定落地）；
    // 既有断言「无 usage」不变，仅终态事件多挂 error
    expect(parseStream(fixture('codex', 'turn-failed.jsonl'), 'codex')).toStrictEqual<
      StreamEvent[]
    >([
      { type: 'step_start', step: 'agent_message' },
      { type: 'log', text: 'turn failed: upstream model timeout' },
      { type: 'turn_end', completed: false, error: 'upstream model timeout' },
    ])
  })
})

describe('kimi（stdout 无 usage，usage 在 wire.jsonl——17-§6 已知坑）', () => {
  const stdout = () => fixture('kimi', 'stdout-basic.jsonl')
  const wire = () => fixture('kimi', 'stdout-basic.wire.jsonl')

  it('wire 合并：两条逐轮 usage 求和挂到 turn_end', () => {
    expect(parseStream(stdout(), 'kimi', wire())).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: 'system:init' },
      { type: 'log', text: '开始实现流归一化…' },
      { type: 'log', text: '交付归一化实现与测试用例' },
      { type: 'turn_end', completed: true, usage: { input: 4800, output: 1130, cache_read: 1200 } },
    ])
  })

  it('缺 wire：turn_end 无 usage，并追加一条明示 log（不静默降级）', () => {
    expect(parseStream(stdout(), 'kimi')).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: 'system:init' },
      { type: 'log', text: '开始实现流归一化…' },
      { type: 'log', text: '交付归一化实现与测试用例' },
      { type: 'turn_end', completed: true },
      { type: 'log', text: '[kimi] wire.jsonl not provided; usage unavailable（17-§6 已知坑）' },
    ])
  })
})

describe('畸形行容错（四家一致的冻结行为）', () => {
  it('截断 JSON / 纯文本行降级为 log 原文透传；注释与空行跳过', () => {
    const text = [
      '# fixture 头注释：应被跳过',
      '',
      '{"type":"status","phase":"step_start","step"',
      'plain text not json',
      '{"type":"status","phase":"step_start","step":1}',
      '   ',
    ].join('\n')
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: '{"type":"status","phase":"step_start","step"' },
      { type: 'log', text: 'plain text not json' },
      { type: 'step_start', step: '1' },
    ])
  })

  it('BOM 与 CRLF 容忍', () => {
    const text =
      '\u{FEFF}{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}\r\n'
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      { type: 'turn_end', completed: true },
    ])
  })

  it('dsh 证伪旧形态（顶层 step_*/turn_end.completed/snake_case usage）一律降级 log 原文透传（不丢证据）', () => {
    // docs/31-§4 证伪表：旧 parseDsh 假设的四种形态在真机 0.2.0-rc.2 均不存在——
    // 现解析器不再识别它们，如实原文透传（证据留痕，不静默吞）
    const text = [
      '{"type":"step_start","step":"analyze"}',
      '{"type":"step_end","step":"analyze","usage":{"input_tokens":1200,"output_tokens":300}}',
      '{"type":"turn_end","completed":true}',
      '{"type":"log","text":"旧拟稿形态"}',
    ].join('\n')
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: '{"type":"step_start","step":"analyze"}' },
      {
        type: 'log',
        text: '{"type":"step_end","step":"analyze","usage":{"input_tokens":1200,"output_tokens":300}}',
      },
      { type: 'log', text: '{"type":"turn_end","completed":true}' },
      { type: 'log', text: '{"type":"log","text":"旧拟稿形态"}' },
    ])
  })

  it('dsh 真机形态的降级分支：step 非数字 / turn_end 无 reason / 正文缺 text / 空 final', () => {
    const text = [
      '{"type":"status","phase":"step_start","turn":1,"step":"1"}',
      '{"type":"status","phase":"turn_end","turn":1}',
      '{"type":"text"}',
      '{"type":"final","text":""}',
    ].join('\n')
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: '{"type":"status","phase":"step_start","turn":1,"step":"1"}' },
      { type: 'log', text: '{"type":"status","phase":"turn_end","turn":1}' },
      { type: 'log', text: '{"type":"text"}' },
    ])
  })

  it('dsh 顶层 error 事件（预运行失败）：turn_end{completed:false,error} 等价映射（docs/31-§3.1）', () => {
    const text =
      '{"type":"error","message":"session \\"nonexistent-probe-id\\" does not exist; omit --session-id to start a new Session"}'
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      {
        type: 'turn_end',
        completed: false,
        error:
          'session "nonexistent-probe-id" does not exist; omit --session-id to start a new Session',
      },
    ])
  })

  it('dsh turn_end.reason.kind 五枚举：completed 外四种一律 completed:false（blocked/aborted/max-tokens 无 error 串）', () => {
    const text = [
      '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"blocked"}}',
      '{"type":"status","phase":"turn_end","turn":2,"reason":{"kind":"aborted"}}',
      '{"type":"status","phase":"turn_end","turn":3,"reason":{"kind":"max-tokens"}}',
      '{"type":"status","phase":"turn_end","turn":4,"reason":{"kind":"completed"}}',
    ].join('\n')
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      { type: 'turn_end', completed: false },
      { type: 'turn_end', completed: false },
      { type: 'turn_end', completed: false },
      { type: 'turn_end', completed: true },
    ])
  })

  it('未知事件类型降级为 log 原文透传（不丢证据）', () => {
    const text = '{"type":"notice","level":"warn","msg":"disk almost full"}'
    expect(parseStream(text, 'claude')).toStrictEqual<StreamEvent[]>([
      { type: 'log', text },
    ])
  })

  it('空文本返回空数组', () => {
    expect(parseStream('', 'dsh')).toStrictEqual<StreamEvent[]>([])
  })
})
