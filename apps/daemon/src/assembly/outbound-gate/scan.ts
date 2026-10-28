/**
 * scan —— 出站扫描纯核：文本/结构化载荷脱敏、残留校验、日志行 env 名打印检测（IMPL-07-11）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §4.4（SEC-SEC-04）：出站文本统一过闸；失败可判定；无通道出口登记缺口；
 *   - docs/v2/15 §4.5（SEC-SEC-05）三不入：
 *       · 库＝台账写入前 redaction；提示词＝成品简报跑出站闸同款扫描（内部供给面只换已知值）；
 *       · 日志＝**日志层模式扫描（值形态＋ env 名全打印检测）**——本文件的 env 名检测即该条；
 *   - docs/80-§11.2.1 分工（内部供给 vs 出站面）：内部供给（提示词/任务书）走
 *     `redactKnownSecrets`（只换已知值、示例文本原样可见）；出站面走 `redactOutbound`
 *     （已知值＋形状兜底）——本文件用同一 `shapeFallback` 开关承载两档，不复制算法；
 *   - packages/core/src/secrets.ts（红act 纯函数唯一实现；本文件只做**校验与编排**，
 *     算法不在 daemon 侧重写——单一事实源）。
 *
 * fail-closed 纪律（本文件是「判成败」的地方，不是「尽力而为」的地方）：
 *   脱敏后**仍检出**已知秘密值＝失败（`redaction-failed`）；脱敏后仍检出**凭据形态**＝
 *   未知形态（`unknown-shape`）；非字符串叶子/循环引用等无法保证扫干净的载荷＝
 *   `unknown-shape`。失败即阻断该次出站，绝不放行未验证文本（值不进失败详情）。
 */
import { findSecretShaped, redactKnownSecrets, redactOutbound } from '@studio-next/core'

/** 已知秘密值最短替换长度（与 core `redactKnownSecrets` 的 MIN_KNOWN_LENGTH 同值：
 *  短值不替换——误伤面大于收益；此处同阈值只用于「残留检出」口径一致）。 */
const MIN_KNOWN_LENGTH = 6

/** 文本扫描结果（redactions=被替换的已知值个数；shapes=输入里的凭据形态命中数） */
export type TextScanOutcome =
  | { readonly ok: true; readonly text: string; readonly redactions: number; readonly shapes: number }
  | { readonly ok: false; readonly code: 'redaction-failed' | 'unknown-shape'; readonly detail: string }

/** 载荷扫描结果（value=脱敏后的深拷贝；原对象不改——调用方决定用不用返回值） */
export type PayloadScanOutcome =
  | { readonly ok: true; readonly value: unknown; readonly redactions: number; readonly shapes: number }
  | { readonly ok: false; readonly code: 'redaction-failed' | 'unknown-shape'; readonly detail: string }

/** 扫描档位：shapeFallback=true＝出站面（已知值＋形状兜底）；false＝内部供给面（只换已知值） */
export interface ScanOptions {
  readonly shapeFallback?: boolean
  /**
   * 结构标识键（不扫值，原样透传）：台账记录里 `payload_hash` 是**完整性引用**（sha256 形
   * 恰是「长随机串」形状）——对它做形状脱敏会毁掉证据链，且它不是自由文本承载位。
   * 只用于「不含秘密值字段位」的结构列；自由文本列（note 等）恒在扫描面内。
   */
  readonly skipKeys?: readonly string[]
}

/** 已知值残留计数（只有 ≥MIN_KNOWN_LENGTH 的值会被 core 替换，同阈值判定残留） */
export function countRemainingKnowns(text: string, knowns: readonly string[]): number {
  let n = 0
  for (const secret of new Set(knowns)) {
    if (secret.length < MIN_KNOWN_LENGTH) continue
    if (text.includes(secret)) n += 1
  }
  return n
}

/**
 * 文本出站扫描（单一路径；gate 全出口共用）。
 * 先脱敏（已知值→形状兜底），再**校验**：已知值残留＝redaction-failed；形状残留＝unknown-shape。
 * 失败详情只报数量/类别，绝不回显被扫文本或秘密值。
 */
export function scanOutboundText(
  text: string,
  knowns: readonly string[],
  options: ScanOptions = {},
): TextScanOutcome {
  const shapeFallback = options.shapeFallback !== false
  if (typeof text !== 'string') {
    return { ok: false, code: 'unknown-shape', detail: `出站文本须为字符串（实得 ${typeof text}）——不可判形态不放行` }
  }
  const shapes = shapeFallback ? findSecretShaped(text).length : 0
  const knownHits = countRemainingKnowns(text, knowns)
  let redacted: string
  try {
    redacted = shapeFallback ? redactOutbound(text, knowns) : redactKnownSecrets(text, knowns)
  } catch {
    return { ok: false, code: 'redaction-failed', detail: '脱敏执行抛错（算法异常不放行）' }
  }
  const residualKnowns = countRemainingKnowns(redacted, knowns)
  if (residualKnowns > 0) {
    return { ok: false, code: 'redaction-failed', detail: `脱敏后仍检出 ${String(residualKnowns)} 个已知秘密值` }
  }
  if (shapeFallback) {
    const residualShapes = findSecretShaped(redacted).length
    if (residualShapes > 0) {
      return { ok: false, code: 'unknown-shape', detail: `脱敏后仍检出 ${String(residualShapes)} 处凭据形态` }
    }
  }
  // 形状兜底恒覆盖已知值替换：redactions＝已知值命中数＋形状命中数（观察面只增不减）
  const redactions = knownHits + (shapeFallback ? shapes : 0)
  return { ok: true, text: redacted, redactions, shapes }
}

/** 结构化载荷的最大深度（防病态嵌套把扫描面拖成 DoS；超深＝unknown-shape 阻断） */
const MAX_DEPTH = 16

/**
 * 结构化载荷出站扫描（深遍历；只重写字符串叶子，结构与键名不动）。
 * 不适格载荷（函数/symbol/bigint 叶子、循环引用、超深嵌套）＝unknown-shape 阻断——
 * 不能保证扫干净的形状一律不放行（v2/15 §4.4 fail-closed）。
 */
export function scanOutboundPayload(
  payload: unknown,
  knowns: readonly string[],
  options: ScanOptions = {},
): PayloadScanOutcome {
  const totals = { redactions: 0, shapes: 0 }
  const walked = walkPayload(payload, knowns, options, { stack: new Set<object>(), depth: 0 }, totals)
  if (!walked.ok) return walked
  return { ok: true, value: walked.value, redactions: totals.redactions, shapes: totals.shapes }
}

type WalkState = { readonly stack: Set<object>; readonly depth: number }
type Totals = { redactions: number; shapes: number }

function walkPayload(
  value: unknown,
  knowns: readonly string[],
  options: ScanOptions,
  state: WalkState,
  totals: Totals,
): { ok: true; value: unknown } | { ok: false; code: 'redaction-failed' | 'unknown-shape'; detail: string } {
  if (typeof value === 'string') {
    const scanned = scanOutboundText(value, knowns, options)
    if (!scanned.ok) return scanned
    totals.redactions += scanned.redactions
    totals.shapes += scanned.shapes
    return { ok: true, value: scanned.text }
  }
  if (value === null || value === undefined) return { ok: true, value }
  if (typeof value === 'number' || typeof value === 'boolean') return { ok: true, value }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return { ok: false, code: 'unknown-shape', detail: `载荷含不可扫描叶子（${typeof value}）` }
  }
  if (typeof value === 'object') {
    if (state.depth >= MAX_DEPTH) return { ok: false, code: 'unknown-shape', detail: `载荷嵌套超深（>${String(MAX_DEPTH)} 层）` }
    if (state.stack.has(value)) return { ok: false, code: 'unknown-shape', detail: '载荷含循环引用' }
    state.stack.add(value)
    const next: WalkState = { stack: state.stack, depth: state.depth + 1 }
    if (Array.isArray(value)) {
      const arr: unknown[] = []
      for (const item of value) {
        const scanned = walkPayload(item, knowns, options, next, totals)
        if (!scanned.ok) {
          state.stack.delete(value)
          return scanned
        }
        arr.push(scanned.value)
      }
      state.stack.delete(value)
      return { ok: true, value: arr }
    }
    if (value instanceof Date) {
      state.stack.delete(value)
      return { ok: true, value } // 日期无文本载荷（序列化形由调用方负责）
    }
    const rec: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      if (options.skipKeys !== undefined && options.skipKeys.includes(key)) {
        rec[key] = item // 结构标识列（如 payload_hash）：完整性引用原样保留
        continue
      }
      const scanned = walkPayload(item, knowns, options, next, totals)
      if (!scanned.ok) {
        state.stack.delete(value)
        return scanned
      }
      rec[key] = scanned.value
    }
    state.stack.delete(value)
    return { ok: true, value: rec }
  }
  return { ok: false, code: 'unknown-shape', detail: `载荷含不可判类型（${typeof value}）` }
}

/** 秘密 env 名（与 hrsync/config.collectHrSecrets 的键集同源：五键＋网关/worker 凭据名） */
export const SECRET_ENV_NAMES = [
  'TAIGA_PASSWORD',
  'TAIGA_TOKEN',
  'TAIGA_REFRESH',
  'MATRIX_SHARED_SECRET',
  'MATRIX_HR_SHARED_SECRET',
  'STUDIO_GATEWAY_SECRET',
  'GATEWAY_SECRET',
  'STUDIO_TOOLS_WKEY',
  'API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'DEEPSEEK_API_KEY',
] as const

/**
 * 日志行 env 名打印检测（v2/15 §4.5 日志面第二判据）：
 * 命中形＝`<大写 env 名>[=:]<值>`（秘密名单独出现不算——「键名可报、值不可打印」）。
 * 泛化后缀（PASSWORD/PASSWD/SECRET/TOKEN/API_KEY/ACCESS_KEY/WKEY）覆盖未登记的将来键；
 * 显式名单（SECRET_ENV_NAMES）用于文档化已知键集。
 */
const ENV_PRINT_RE =
  /\b([A-Z][A-Z0-9_]{2,}(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY|WKEY))[ \t]*[=:][ \t]*(?:"[^"\n]{1,}"|'[^'\n]{1,}'|[^\s,;)]{1,})/g

/** env 名打印检测：返回被打印值的 env 名（去重、保持出现序） */
export function findEnvNamePrinting(line: string): string[] {
  const names: string[] = []
  for (const m of line.matchAll(new RegExp(ENV_PRINT_RE.source, ENV_PRINT_RE.flags))) {
    const name = m[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

/**
 * env 名打印抹值（保留键名做诊断、值一律替换为 `<redacted:env>`——日志面「值不可打印」）。
 * 与 findEnvNamePrinting 同正则：检出与处置不分家（检出却不处置＝假防线）。
 */
export function redactEnvNamePrinting(line: string): { readonly text: string; readonly names: readonly string[] } {
  const names: string[] = []
  const text = line.replace(new RegExp(ENV_PRINT_RE.source, ENV_PRINT_RE.flags), (_match, name: string) => {
    if (!names.includes(name)) names.push(name)
    return `${name}=<redacted:env>`
  })
  return { text, names }
}
