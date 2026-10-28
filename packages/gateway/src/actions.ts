/**
 * 动作词校验 —— 结构化写指令的冻结形态（docs/17-§7、docs/24-§二、docs/25-§4.1）
 *
 * 冻结格式（拟稿，改动先过批示）：
 *   - 行首 `@action <verb> <json 参数>`，占且仅占**首行**；verb 必须 ∈ 网关动作词表
 *     （contract 冻结六动词＝worker 面，与内部 MCP studio-tools 工具集同一张表；
 *     另加 ctl- 控制面平台写动词族——SEC-SIG-03，值域唯一主表 v2/09 ENU-119）
 *   - json 参数 = 首行剩余全部，必须是 JSON 对象（Record<string, unknown>；数组/null/标量拒）
 *   - 解析失败 fail-closed 返回 reason 码：**不猜、不修复、不降级**（"@ACTION" 大小写变体也不认）
 *   - 中文回退通道：isFreeformChinese（含 CJK 表意字符即真）只**标记**不解析——
 *     LLM 回退归上层（17-§7：制作人中文批示习惯保留）；parseAction 对非结构化中文返回
 *     not-an-action + needsLlmFallback:true，由 facade 路由
 *   - 「试图结构化但坏了」（行首是 @action 却动词/JSON 不合法）= 纯拒，不走中文回退——
 *     结构化意图优先，坏结构比自由文本更可疑
 *
 * ctl- 词族（SEC-SIG-03；plan/05 IMPL-07-10；v2/14 §二-2）：
 *   - 控制面平台写作（create/transition/setField/link/provision/guards）不再借道 `comment`：
 *     `ctl-create`/`ctl-transition`/`ctl-set-field`/`ctl-link`/`ctl-provision`/`ctl-guards`
 *     六动词入网关词表，审计面 transition 不得显示为 comment。
 *   - 申报动作与实文动作的一致性校验沿 `gw-action-mismatch` 机制（gateway.ts）：申报（wkey
 *     scope 锚点）与首行字面动词分叉即拒；args.op 自述与申报动作分叉同拒（不猜以哪边为准）。
 *   - 迁移期 `op` 借道（comment + args.op 自述真实操作）**允许但记降级标记**：
 *     resolveAuditAction 把借道写还原为 ctl- 审计动作并标 downgraded，交台账记降级（v2/15 §二、
 *     v2/14 §二-2；台账落点归 daemon 后续单，本包只出判定）。
 *   - contract 扩表走批示流（v2/14 §二）：本文件在 gateway 侧合成词表，不改 contract 冻结六动词；
 *     contract 扩表后本合成自动等价（ctx 注释，禁第二值域源）。
 */
import { z } from 'zod'
import { GATEWAY_ACTIONS } from '@studio-next/contract'
import type { GatewayAction } from '@studio-next/contract'

/**
 * 控制面平台写动词族（SEC-SIG-03；v2/09 ENU-119 唯一值集主表——字面量只在本文件出现一次）。
 * 顺序与 ENU-119 登记一致（create → transition → set-field → link → provision → guards）。
 */
export const GATEWAY_CTL_ACTIONS = [
  'ctl-create',
  'ctl-transition',
  'ctl-set-field',
  'ctl-link',
  'ctl-provision',
  'ctl-guards',
] as const

export type CtlAction = (typeof GATEWAY_CTL_ACTIONS)[number]

/**
 * 网关动作词表 = contract 冻结六动词（worker 面）＋ ctl- 六动词（控制面平台写）。
 * contract 表仍是 worker 面唯一值域源（GATEWAY_ACTIONS 不改，扩表走批示流）；本表只做并集，
 * 不重述六动词字面量——词表漂移由测试断言两表对齐。
 */
export const GATEWAY_ACTION_WORDS = [...GATEWAY_ACTIONS, ...GATEWAY_CTL_ACTIONS] as const

export type GatewayActionWord = (typeof GATEWAY_ACTION_WORDS)[number]

/** contract 六动词（worker 面）判定；运行期硬化（擦除后无类型，JS 调用方仍受拦） */
export function isGatewayAction(value: string): value is GatewayAction {
  return (GATEWAY_ACTIONS as readonly string[]).includes(value)
}

/** ctl- 六动词判定（控制面平台写面） */
export function isCtlAction(value: string): value is CtlAction {
  return (GATEWAY_CTL_ACTIONS as readonly string[]).includes(value)
}

/** 网关词表判定（worker 面 ＋ ctl- 面） */
export function isGatewayActionWord(value: string): value is GatewayActionWord {
  return (GATEWAY_ACTION_WORDS as readonly string[]).includes(value)
}

export type ActionRejectReason = 'not-an-action' | 'bad-format' | 'unknown-verb' | 'bad-json' | 'bad-args'

export type ActionParseResult =
  | { ok: true; action: GatewayActionWord; args: Record<string, unknown> }
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
 * 成功 → {action, args}（action ∈ 网关词表：worker 六动词 ∪ ctl- 六动词）；
 * 失败 → reason（fail-closed，不猜不修复）；非结构化且含中文 → 附 needsLlmFallback:true（只标记）。
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
  if (!isGatewayActionWord(verb)) return { ok: false, reason: 'unknown-verb' }
  let raw: unknown
  try {
    raw = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: 'bad-json' }
  }
  const parsed = ArgsSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'bad-args' }
  return { ok: true, action: verb, args: parsed.data }
}

/**
 * 迁移期 `op` 自述 → ctl- 动作词（gated-platform 头注借道表；SEC-SIG-03）。
 * 只登记控制面平台写操作；comments.add / kb.upsert 等真实评论/文章操作不在表内（不得冒充）。
 * guards.install / guards.uninstall 同归 ctl-guards（词族按能力粒度冻结，不按 install 细分）。
 */
const CONTROL_OP_ACTIONS: Readonly<Record<string, CtlAction>> = {
  'issues.create': 'ctl-create',
  'issues.transition': 'ctl-transition',
  'issues.setField': 'ctl-set-field',
  'links.link': 'ctl-link',
  'fields.provision': 'ctl-provision',
  'guards.install': 'ctl-guards',
  'guards.uninstall': 'ctl-guards',
}

/**
 * 审计面动作解析结果（SEC-SIG-03「审计面 transition 不得显示为 comment」的判定体）：
 *   - action = 审计面应显示的动作（ctl- 直报即自身；comment + op 借道按 op 还原为 ctl-）
 *   - downgraded = 迁移期借道降级标记（v2/14 §二-2：允许但须记台账）
 *   - selfDeclaredOp = 自述 op 回显（台账对账用；非借道时为原样回显，无 op 时缺省）
 *   - mismatch = 自述 op 与申报动作分叉（gateway 按 gw-action-mismatch 拒，不落审计正行）
 */
export interface ActionAudit {
  readonly action: GatewayActionWord
  readonly downgraded: boolean
  readonly selfDeclaredOp?: string
  readonly mismatch: boolean
}

/**
 * resolveAuditAction —— 申报动作＋args.op 自述 → 审计面动作（SEC-SIG-03）。
 * 规则（fail-closed 方向：不猜、不并义）：
 *   1. 无 op 或 op 非已知控制面操作 → 审计动作＝申报动作（自由评论/worker 面不受影响）；
 *   2. comment + 控制面 op = 迁移期借道：允许，审计动作还原为对应 ctl-，downgraded=true；
 *   3. ctl- 申报 + 同族 op → 一致（审计动作＝申报动作，非借道）；
 *   4. 其余（ctl- 申报 vs 异族 op、worker 动词 vs 控制面 op）→ mismatch（gateway 拒）。
 */
export function resolveAuditAction(action: GatewayActionWord, args: Record<string, unknown>): ActionAudit {
  const op = args.op
  if (typeof op !== 'string') return { action, downgraded: false, mismatch: false }
  const ctl = CONTROL_OP_ACTIONS[op]
  if (ctl === undefined) return { action, downgraded: false, selfDeclaredOp: op, mismatch: false }
  if (action === 'comment') return { action: ctl, downgraded: true, selfDeclaredOp: op, mismatch: false }
  if (action === ctl) return { action, downgraded: false, selfDeclaredOp: op, mismatch: false }
  return { action, downgraded: false, selfDeclaredOp: op, mismatch: true }
}
