/**
 * 流归一化器 golden 测试 —— 只对冻结行为负责（docs/18-§1.3：解析器对 fixture 全绿）
 *
 * 覆盖：四家 golden fixtures 逐一断言 + kimi wire 合并（求和挂 turn_end）+
 * kimi 缺 wire 明示 + 畸形行容错（截断 JSON / 纯文本 / BOM / CRLF / 空行与井号注释）。
 * 断言用 toStrictEqual：usage 的「不存在」与 undefined 严格区分（exactOptionalPropertyTypes 口径）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseStream } from '../src/streams.ts'
import type { StreamEvent } from '@studio-next/contract'

function fixture(...parts: string[]): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/${parts.join('/')}`, import.meta.url)),
    'utf8',
  )
}

describe('dsh（NDJSON：step_end 带 usage，turn_end.completed——17-§6）', () => {
  it('turn-completed：完整流的归一化序列', () => {
    expect(parseStream(fixture('dsh', 'turn-completed.ndjson'), 'dsh')).toStrictEqual<
      StreamEvent[]
    >([
      { type: 'step_start', step: 'analyze' },
      { type: 'step_end', step: 'analyze', usage: { input: 1200, output: 300, cached: 0 } },
      { type: 'log', text: 'scan workspace: 3 files changed' },
      { type: 'step_start', step: 'implement' },
      { type: 'step_end', step: 'implement', usage: { input: 2600, output: 1900, cached: 800 } },
      { type: 'turn_end', completed: true, usage: { input: 3800, output: 2200, cached: 800 } },
    ])
  })

  it('killed-mid-step：无 turn_end —— 被 kill 的流不含任何 completed 事件（成功判定不看退出码）', () => {
    const events = parseStream(fixture('dsh', 'killed-mid-step.ndjson'), 'dsh')
    expect(events).toStrictEqual<StreamEvent[]>([
      { type: 'step_start', step: 'analyze' },
      { type: 'step_end', step: 'analyze', usage: { input: 900, output: 120, cached: 0 } },
      { type: 'step_start', step: 'implement' },
    ])
    expect(events.some((e) => e.type === 'turn_end')).toBe(false)
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
      { type: 'turn_end', completed: true, usage: { input: 1468, output: 233, cached: 5120 } },
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
      { type: 'turn_end', completed: true, usage: { input: 4800, output: 1130, cached: 1200 } },
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
      '{"type":"step_start","step":"a"',
      'plain text not json',
      '{"type":"step_start","step":"a"}',
      '   ',
    ].join('\n')
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
      { type: 'log', text: '{"type":"step_start","step":"a"' },
      { type: 'log', text: 'plain text not json' },
      { type: 'step_start', step: 'a' },
    ])
  })

  it('BOM 与 CRLF 容忍', () => {
    const text = '\u{FEFF}{"type":"turn_end","completed":true}\r\n'
    expect(parseStream(text, 'dsh')).toStrictEqual<StreamEvent[]>([
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
