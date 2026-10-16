/**
 * 动作词校验 —— 结构化写指令的冻结形态（docs/17-§7、docs/24-§二、docs/25-§4.1）
 *
 * 冻结格式（拟稿，改动先过批示）：
 *   - 行首 `@action <verb> <json 参数>`，占且仅占**首行**；verb 必须 ∈ GATEWAY_ACTIONS 白名单
 *     （与内部 MCP studio-tools 工具集同一张表——状态推进永不在表内）
 *   - json 参数 = 首行剩余全部，必须是 JSON 对象（Record<string, unknown>；数组/null/标量拒）
 *   - 解析失败 fail-closed 返回 reason 码：**不猜、不修复、不降级**（"@ACTION" 大小写变体也不认）
 *   - 中文回退通道：isFreeformChinese（含 CJK 表意字符即真）只**标记**不解析——
 *     LLM 回退归上层（17-§7：制作人中文批示习惯保留）；parseAction 对非结构化中文返回
 *     not-an-action + needsLlmFallback:true，由 facade 路由
 *   - 「试图结构化但坏了」（行首是 @action 却动词/JSON 不合法）= 纯拒，不走中文回退——
 *     结构化意图优先，坏结构比自由文本更可疑
 */
import { z } from 'zod'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction } from '@studio-next/contract'

export type ActionRejectReason = 'not-an-action' | 'bad-format' | 'unknown-verb' | 'bad-json' | 'bad-args'

export type ActionParseResult =
  | { ok: true; action: GatewayAction; args: Record<string, unknown> }
  | { ok: false; reason: ActionRejectReason; needsLlmFallback?: true }

/** 行首 `@action` + 至少一段参数动词与 JSON 段（首行为准，多行正文只看第一行） */
const ACTION_LINE_RE = /^@action[ \t]+(\S+)[ \t]+(.+)$/

/** json 参数必须是对象（键字符串；值任意 JSON） */
const ArgsSchema = z.record(z.string(), z.unknown())

/** CJK 表意字符（含扩展 A/兼容表意；拟稿：不含标号/注音/全角符号——"含汉字即中文"） */
const CJK_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/

/** isFreeformChinese —— 中文自由批示判定（含 CJK 表意字符即真；只判定，解析归上层 LLM 回退） */
export function isFreeformChinese(text: string): boolean {
  return CJK_RE.test(text)
}

/**
 * parseAction —— 解析一行结构化写指令。
 * 成功 → {action, args}；失败 → reason（fail-closed，不猜不修复）；
 * 非结构化且含中文 → 附 needsLlmFallback:true（只标记）。
 */
export function parseAction(text: string): ActionParseResult {
  const firstLine = text.split('\n', 1)[0] as string
  // 前缀判定先行：行首不是 @action = 非指令（中文才给回退标记）；
  // 是 @action 但形状残缺 = bad-format 纯拒（结构化意图优先，不走中文回退）
  if (!firstLine.startsWith('@action')) {
    return isFreeformChinese(text)
      ? { ok: false, reason: 'not-an-action', needsLlmFallback: true }
      : { ok: false, reason: 'not-an-action' }
  }
  const m = ACTION_LINE_RE.exec(firstLine)
  if (m === null) return { ok: false, reason: 'bad-format' }
  const verb = m[1] as string
  const jsonText = (m[2] as string).trim()
  if (!(GATEWAY_ACTIONS as readonly string[]).includes(verb)) return { ok: false, reason: 'unknown-verb' }
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
  const parsed = ArgsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'bad-args' }
  return { ok: true, action: verb as GatewayAction, args: parsed.data }
}
