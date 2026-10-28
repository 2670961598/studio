/**
 * failures —— 出站闸失败面：失败码、冻结词表缺口登记、可判定失败记录（IMPL-07-11）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §4.4：三个失败事件名（redaction-failed / notify-blocked / unknown-shape）
 *     在 v1 不在冻结词表（contract EVENT_NAMES）——**扫描成败不可判定**是 P0-10 的核心；
 *     目标②「判成败可表达＝失败事件名入冻结词表（词表改动走 contract 批示）」；
 *   - docs/audit-DSF/V13-01 修法③：三个失败出口先走 SCHEMA_EVOLVE 立名，**或并入既有
 *     ESCALATE 的 note**（零新事件名）——否则「留证」无落点；
 *   - docs/v2/17 NEG-SEC-07/N-g：失败事件**可判定**且覆盖全出口；
 *   - docs/plan/05 IMPL-07-11：失败事件名「入冻结词表或显式 gap（不静默）」；本单领土
 *     不含 packages/contract（contract patch 须走提案经 C），故落**显式 gap**＋可判定承载。
 *
 * 本模块的口径（为什么这样算「不静默」）：
 *   1. 缺口是**数据**不是注释——`OUTBOUND_EVENT_VOCAB_GAP` 列出三个文档名、提案去处、
 *      暂用承载事件（ESCALATE，冻结词表既有名），gate.coverage() 原样带出；
 *   2. 失败记录**确定性**——note 形如
 *      `outbound:<surface>:<point>:<code>;action=<blocked|redacted>;vocab=<registered|gap>;fallback=ESCALATE`，
 *      值零出现；监控/测试可用 `parseOutboundFailureNote` 逐字段判定（NEG-SEC-07 的可判定面）；
 *   3. 词表一旦增补（`isEventName(name)` 为真），同一记录自动翻成 `vocab=registered`——
 *      机制已就位，无需改闸（本单用注入的 isEventName 复现该翻转，见 outbound.test.ts）。
 */

/** 出站闸失败码全集（前三项＝docs/v2/15 §4.4 的文档名；末项＝日志面专属观察码） */
export const OUTBOUND_FAILURE_CODES = [
  /** 脱敏执行失败/脱敏后仍检出已知秘密值（fail-closed：该次出站被阻断） */
  'redaction-failed',
  /** 通知出口被阻断（扫描失败→不发送；按软失败面回报，不抛） */
  'notify-blocked',
  /** 出站载荷形态不可判（非字符串叶子/循环结构等——不能保证扫干净） */
  'unknown-shape',
  /** 日志行出现秘密 env 名带值打印（v2/15 §4.5 日志面：值形态＋env 名全打印检测） */
  'env-print-blocked',
] as const

/** 失败码（记录键空间） */
export type OutboundFailureCode = (typeof OUTBOUND_FAILURE_CODES)[number]

/** docs/v2/15 §4.4 点名的三个失败事件名（词表缺口候选；不是本地自造名的同义词） */
export const OUTBOUND_DOC_FAILURE_EVENT_NAMES = [
  'redaction-failed',
  'notify-blocked',
  'unknown-shape',
] as const

/**
 * 冻结词表缺口登记（显式 gap；**不静默**）。
 *
 * 实测：contract `isEventName('redaction-failed')` = false（EVENT_NAMES 30 名全大写、
 * 前缀族只认 `GW_/REPORT_/JUDGE_` 大写形）。落账承载先走**既有冻结事件 ESCALATE** 的
 * note（V13-01 修法③的零新事件名通道），note 内是上面的可判定失败行；词表增补后
 * 闸自动用新名（`outboundVocabularyStatus`）。
 */
export const OUTBOUND_EVENT_VOCAB_GAP = {
  status: 'open',
  /** 未入词表的失败事件名（文档形，小写连字符——contract 词表形为大写枚举/前缀族） */
  names: OUTBOUND_DOC_FAILURE_EVENT_NAMES,
  /** 谁批：contract 词表改动＝提案经 C（不是本单可自决；本单领土不含 packages/contract） */
  proposalRef: 'docs/plan/05 IMPL-07-11（contract patch 提案经 C）；docs/audit-DSF/V13-01 修法③',
  /** 增补前的落账承载（冻结词表既有事件名） */
  fallbackEvent: 'ESCALATE',
  /** 缺口语义（观察面文案；进装配日志） */
  means:
    '出站扫描失败事件名未入冻结词表：失败本身可判定（ESCALATE note 携确定性失败行），' +
    '但「事件名级」的告警路由要等 contract 词表增补——不得据此宣称失败事件已入词表',
} as const

/**
 * 观察面呈现缺口（v2/15 §4.4-③「扫描失败/跳过/覆盖缺口入 MON-12/15 行（证据与审计、
 * 监控自身）」）：本单交付**可判记录＋落账**（ESCALATE note）与覆盖快照；监控行呈现归
 * v2/08 §3 观察面（MIG-08 波）。显式 open——不得把「台账可判」冒充成「监控行已覆盖」。
 */
export const OUTBOUND_MON_OBSERVATION_GAP = {
  status: 'open',
  target: 'MON-12/MON-15（docs/v2/08 §3 观察面）',
  means:
    '扫描失败/阻断/覆盖缺口已可判定并可落账；监控行呈现未接线（归观察面单）——' +
    '不得据此宣称 MON-12/15 已覆盖（观察面缺口与机制缺口分开记）',
} as const

/** 单失败事件名的词表状态（registered=已在冻结词表；gap=显式缺口，落账走 fallbackEvent） */
export interface OutboundVocabularyStatus {
  readonly name: string
  readonly registered: boolean
  readonly gap: boolean
  readonly fallbackEvent: 'ESCALATE'
}

/**
 * 词表状态判定（`isEventName` 注入：缺省＝contract 的冻结词表判定，测试可注入以复现
 * 「词表增补后自动翻转」——本单不私自复制词表，判定权恒在 contract）。
 */
export function outboundVocabularyStatus(
  name: string,
  isEventName: (candidate: string) => boolean,
): OutboundVocabularyStatus {
  const registered = isEventName(name)
  return { name, registered, gap: !registered, fallbackEvent: 'ESCALATE' }
}

/** 失败面：出站五出口，或三不入强制点 */
export type OutboundFailureSurface = 'exit' | 'three-not-in'

/** 失败处置：blocked＝fail-closed 阻断该次出站/写入；redacted＝脱敏后放行（留观察记录） */
export type OutboundFailureAction = 'blocked' | 'redacted'

/**
 * 可判定失败记录（值零出现；一经产生不可变）。
 * 落账形态：`ESCALATE` 事件 note = `outbound-gate: <note>`（见 wire.ts createLedgerFailureSink）。
 */
export interface OutboundFailureRecord {
  readonly surface: OutboundFailureSurface
  /** 出口 id（OutboundExitId）或三不入点 id（ThreeNotInId） */
  readonly point: string
  readonly code: OutboundFailureCode
  readonly action: OutboundFailureAction
  /** epoch ms（可判定性之一：同一失败在同一次运行内可按时间序排序） */
  readonly at: number
  /** 词表状态（registered/gap 二值可判；gap 恒附 fallbackEvent） */
  readonly vocabulary: OutboundVocabularyStatus
  /** 确定性判定行（无值；parseOutboundFailureNote 可逆解析） */
  readonly note: string
}

/** 判定行前缀（监控/测试按此前缀检索，不猜） */
export const OUTBOUND_FAILURE_NOTE_PREFIX = 'outbound' as const

/**
 * 构造确定性失败行（**只含结构字段，绝不含被扫文本**）：
 * `outbound:<surface>:<point>:<code>;action=<a>;vocab=<registered|gap>;fallback=ESCALATE`
 */
export function outboundFailureNote(fields: {
  readonly surface: OutboundFailureSurface
  readonly point: string
  readonly code: OutboundFailureCode
  readonly action: OutboundFailureAction
  readonly vocabulary: OutboundVocabularyStatus
}): string {
  const vocab = fields.vocabulary.registered ? 'registered' : 'gap'
  return `${OUTBOUND_FAILURE_NOTE_PREFIX}:${fields.surface}:${fields.point}:${fields.code};action=${fields.action};vocab=${vocab};fallback=${fields.vocabulary.fallbackEvent}`
}

/** 解析后的失败行（可判定面的机器可读形） */
export interface ParsedOutboundFailureNote {
  readonly surface: OutboundFailureSurface
  readonly point: string
  readonly code: OutboundFailureCode
  readonly action: OutboundFailureAction
  readonly vocabulary: 'registered' | 'gap'
  readonly fallbackEvent: string
}

/**
 * 失败行解析（NEG-SEC-07「可判定」的机械面）：形不合即 undefined——不把任意 note
 * 猜成失败记录（fail-closed 的判定面同样不许「差不多就算」）。
 */
export function parseOutboundFailureNote(note: string): ParsedOutboundFailureNote | undefined {
  const m = /^outbound:(exit|three-not-in):([a-z][a-z-]*):([a-z][a-z-]*);action=(blocked|redacted);vocab=(registered|gap);fallback=([A-Z][A-Z0-9_]*)$/.exec(
    note,
  )
  if (m === null) return undefined
  const surface = m[1]
  const point = m[2]
  const code = m[3]
  const action = m[4]
  const vocabulary = m[5]
  const fallbackEvent = m[6]
  if (surface === undefined || point === undefined || code === undefined) return undefined
  if (action === undefined || vocabulary === undefined || fallbackEvent === undefined) return undefined
  if (!(OUTBOUND_FAILURE_CODES as readonly string[]).includes(code)) return undefined
  return {
    surface: surface as OutboundFailureSurface,
    point,
    code: code as OutboundFailureCode,
    action: action as OutboundFailureAction,
    vocabulary: vocabulary as 'registered' | 'gap',
    fallbackEvent,
  }
}

/**
 * 失败记录判定（结构守卫；测试/观察面用）：note 可解析且与结构字段一致才算可判定——
 * 「有 note 字符串」不等于「可判定」（无值、可逆、字段齐三件）。
 */
export function isDeterminableOutboundFailure(value: unknown): value is OutboundFailureRecord {
  if (typeof value !== 'object' || value === null) return false
  const rec = value as Partial<OutboundFailureRecord>
  if (rec.surface !== 'exit' && rec.surface !== 'three-not-in') return false
  if (typeof rec.point !== 'string' || rec.point.length === 0) return false
  if (typeof rec.code !== 'string' || !(OUTBOUND_FAILURE_CODES as readonly string[]).includes(rec.code)) return false
  if (rec.action !== 'blocked' && rec.action !== 'redacted') return false
  if (typeof rec.at !== 'number' || !Number.isFinite(rec.at)) return false
  const vocab = rec.vocabulary
  if (vocab === undefined || typeof vocab !== 'object') return false
  if (typeof vocab.name !== 'string' || typeof vocab.registered !== 'boolean') return false
  if (typeof rec.note !== 'string') return false
  const parsed = parseOutboundFailureNote(rec.note)
  if (parsed === undefined) return false
  return (
    parsed.surface === rec.surface &&
    parsed.point === rec.point &&
    parsed.code === rec.code &&
    parsed.action === rec.action &&
    parsed.vocabulary === (vocab.registered ? 'registered' : 'gap')
  )
}
