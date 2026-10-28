/**
 * fixtures —— store V2 记录面测试的共用夹具（仅 test/v2 内部使用）
 *
 * 纪律：不引旧测试的 setup/全局夹具（vitest.v2.config.ts 头注），本文件只放确定性纯函数与
 * 记录形状构造器；不触盘、不读环境。ULID 为确定性合成（同参数恒同 id），测试可重现。
 */
import type { EventRecord } from '@studio-next/contract'

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeBase32(value: bigint, len: number): string {
  let out = ''
  for (let i = len - 1; i >= 0; i--) {
    const idx = Number((value / 32n ** BigInt(i)) % 32n)
    out += B32[idx] ?? '0'
  }
  return out
}

/** 确定性合成 ULID：时间位=ts（10 字符），随机位=seq（16 字符） */
export function ulid(ts: number, seq: number): string {
  return encodeBase32(BigInt(ts), 10) + encodeBase32(BigInt(seq), 16)
}

/** 收口/事件基准时刻（测试只锚数值，不锚本机时区） */
export const T0 = Date.UTC(2026, 9, 23, 2, 0, 0)

/** 合法事件记录（缺省 LLM；over 可改 id/ts/event/cost_usd 等） */
export function eventRecord(over: Partial<EventRecord> = {}): EventRecord {
  return {
    id: ulid(T0, 1),
    ts: T0,
    company: 'games',
    issue: 'STUDIO-401',
    event: 'LLM',
    actor: 'AGENT-1:agent-1',
    attempt: 1,
    level: 2,
    dept: 'departments/工程部',
    tokens: { input: 10, output: 5 },
    ...over,
  }
}

/** cost_daily 定型行输入（appendCostDaily 形状；over 可改格/金额/adjusts_id） */
export function costRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ulid(T0, 100),
    company: 'games',
    person_id: 'ENG-1',
    model: 'deepseek/deepseek-flash',
    cost_date: '2026-10-23',
    tokens: { tokens_in: 1000, tokens_out: 500, cache_read: 0, cache_creation: 0 },
    price_snapshot_id: 'models-yaml:deepseek/deepseek-flash',
    cost_usd: 0.25,
    closed_at: T0,
    closed_by: 'cost-close:2026-10-23',
    ...over,
  }
}

/** 金额归一到 1e-9（报告分列展示用；不做跨账相等判定） */
export function roundUsd(value: number): number {
  return Math.round(value * 1e9) / 1e9
}
