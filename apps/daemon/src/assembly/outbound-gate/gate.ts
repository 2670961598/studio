/**
 * gate —— 统一出站闸（五出口＋三不入点的单一执行体；IMPL-07-11）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/15 §4.4（SEC-SEC-04）：**承担者＝框架出站文本闸**（daemon 出站通道统一件，
 *     覆盖平台写/通知/证据导出/日志外发/对外 API 响应五出口）；失败可判定；无通道出口
 *     登记 gap 不静默；出站闸装配是 P0-10 的机器强制点（目标未证→本单落装配＋负向探针）；
 *   - docs/v2/15 §4.5（SEC-SEC-05）：三不入强制点（库/提示词/日志）；
 *   - docs/v2/17 NEG-SEC-07/N-g：失败事件可判定＋覆盖全出口；
 *   - docs/plan/05 IMPL-07-11（本单）；docs/audit-DSF/V13-01（现状承担者缺失）。
 *
 * 设计（为什么是「闸」而不是「若干处 redact 调用」）：
 *   1. **单一执行体**：五出口与三不入点共用同一 knowns 集、同一扫描核（scan.ts）、同一
 *      失败面（failures.ts）——不存在「某出口忘了带秘密集」的第二条路径；
 *   2. **fail-closed**：脱敏后仍检出已知值/凭据形态＝阻断该次出站（抛 OutboundBlockedError），
 *      绝不「脱敏了但没验」；日志面例外按「不炸主循环」降级为整行拦截（原值不落日志）；
 *   3. **判成败可表达**：每次失败产出一条确定性记录（note 无值、可逆解析），经
 *      `onFailure` 落台账（wire.ts createLedgerFailureSink → ESCALATE note）；
 *      词表缺口（OUTBOUND_EVENT_VOCAB_GAP）随 coverage/启动行显式带出；
 *   4. **覆盖可判**：coverage() 给出每出口 status/scans/blocked 与 gap 码——「几个出口
 *      没有扫描通道」是数字，不是纪律记忆。
 */
import { isEventName } from '@studio-next/contract'
import { OUTBOUND_EXIT_CATALOG, outboundExitDef, outboundExitGaps } from './exits.ts'
import type { OutboundExitDef, OutboundExitId } from './exits.ts'
import {
  OUTBOUND_EVENT_VOCAB_GAP,
  OUTBOUND_FAILURE_NOTE_PREFIX,
  isDeterminableOutboundFailure,
  outboundFailureNote,
  outboundVocabularyStatus,
} from './failures.ts'
import type {
  OutboundFailureAction,
  OutboundFailureCode,
  OutboundFailureRecord,
  OutboundFailureSurface,
  OutboundVocabularyStatus,
} from './failures.ts'
import {
  findEnvNamePrinting,
  redactEnvNamePrinting,
  scanOutboundPayload,
  scanOutboundText,
} from './scan.ts'
import type { ScanOptions } from './scan.ts'
import { THREE_NOT_IN_CATALOG, THREE_NOT_IN_IDS, threeNotInDef } from './three-not-in.ts'
import type { ThreeNotInDef, ThreeNotInId } from './three-not-in.ts'

/** 单点计数（scans=过闸次数；redactions=替换/抹值读数；blocked=被阻断次数） */
interface PointCounter {
  scans: number
  redactions: number
  blocked: number
}

/** 单出口覆盖行（catalog 定义＋运行期计数） */
export interface OutboundExitCoverage extends OutboundExitDef {
  readonly scans: number
  readonly redactions: number
  readonly blocked: number
}

/** 三不入点覆盖行（catalog 定义＋运行期计数） */
export interface ThreeNotInCoverage extends ThreeNotInDef {
  readonly scans: number
  readonly redactions: number
  readonly blocked: number
}

/**
 * 覆盖快照（观察面；NEG-SEC-07「覆盖全出口」的机器可读形）：
 * `gaps` 非空＝有出口无生产扫描通道（显式、不静默）；`failuresDropped>0`＝失败记录
 * 超过上限被丢弃（只丢内存副本，onFailure 落台账不受影响——上限防一次事故打爆内存）。
 */
export interface OutboundCoverage {
  readonly exits: readonly OutboundExitCoverage[]
  readonly threeNotIn: readonly ThreeNotInCoverage[]
  readonly gaps: readonly string[]
  readonly wired: number
  readonly gapCount: number
  readonly scanned: number
  readonly blocked: number
  readonly failures: number
  readonly failuresDropped: number
}

/** 出站闸构造入参（knowns＝装配期收集的已知秘密值；判定/落账/时钟均可注入以测试） */
export interface OutboundGateOptions {
  /** 已知秘密值集（闭包内只参与比对；不回显、不落任何持久层） */
  readonly knowns: readonly string[]
  /** 冻结词表判定（缺省＝contract isEventName；测试注入以复现「词表增补后自动翻转」） */
  readonly isEventName?: (candidate: string) => boolean
  /** 失败落账出口（缺省不落；wire.ts 注入 createLedgerFailureSink → ESCALATE note） */
  readonly onFailure?: (failure: OutboundFailureRecord) => void
  /** 闸自身诊断日志（**必须是未过闸的原始 log**，否则闸日志自陷递归） */
  readonly log?: (line: string) => void
  readonly now?: () => number
  /** 内存失败记录上限（缺省 128；超出计数 failuresDropped，不静默丢语义） */
  readonly failureLimit?: number
}

/**
 * 出站闸（结构即义务清单：五出口 guard 方法 + 三不入强制点方法 + 可判覆盖）。
 * 语义边界：`guard` 系列方法**阻断时抛 OutboundBlockedError**（fail-closed）；`guardLog`
 * 永不抛（主循环日志面降级为整行拦截）；`coverage/startupLine` 只读。
 */
export interface OutboundGate {
  /** 已知秘密值个数（值本身不暴露给调用方） */
  readonly knownsCount: number
  /** 五出口定义（catalog 静态声明） */
  readonly exits: readonly OutboundExitDef[]
  /** 三不入点定义 */
  readonly threeNotIn: readonly ThreeNotInDef[]
  /** 显式缺口码（status='gap' 出口逐条；不静默） */
  readonly gaps: readonly string[]
  /** 出站文本过闸（脱敏＋残留校验；失败抛错并落失败记录） */
  guard(exit: OutboundExitId, text: string): string
  /** 出站结构化载荷过闸（深扫字符串叶子；失败抛错并落失败记录） */
  guardPayload(exit: OutboundExitId, payload: unknown): unknown
  /** 证据导出面 wrapper（生产装配点未落位＝catalog gap；wrapper 供接线与测试） */
  guardEvidenceExport(text: string): string
  /** API 响应面 wrapper（生产装配点未落位＝catalog gap；wrapper 供接线与测试） */
  guardApiResponse(payload: unknown): unknown
  /** 三不入·提示词：成品简报过严格档（只换已知值）+ 残留校验 */
  guardPromptText(text: string): string
  /** 装配器注入件（AssemblerContext.redactKnown 形状）：与 guardPromptText 同源 */
  promptRedactor(text: string): string
  /** 三不入·库：台账写入前深扫（返回脱敏后的新记录；失败抛错＝拒写） */
  guardStoreRecord<T>(record: T): T
  /** 三不入·日志：值形态＋env 名打印扫描；永不抛（拦截行整行替换） */
  guardLog(line: string): string
  /** 失败落账补充记录（如通知被阻断）；不重复计数（扫描侧已计过） */
  recordBlocked(exit: OutboundExitId, code: OutboundFailureCode): OutboundFailureRecord
  /** 覆盖快照 */
  coverage(): OutboundCoverage
  /** 本轮失败记录副本（时序保留；上限见 failureLimit） */
  failures(): readonly OutboundFailureRecord[]
  /** 启动/装配行（缺口与词表缺口显式；无秘密值） */
  startupLine(): string
}

/** 出站闸拦截错误（fail-closed 的判负面：调用方可捕获后按出口语义降级/上报） */
export class OutboundBlockedError extends Error {
  readonly failure: OutboundFailureRecord

  constructor(failure: OutboundFailureRecord) {
    super(`出站闸拦截（${failure.code}）：${failure.note}`)
    this.name = 'OutboundBlockedError'
    this.failure = failure
  }
}

/** 空计数 */
function emptyCounter(): PointCounter {
  return { scans: 0, redactions: 0, blocked: 0 }
}

/** 出口/点 id 的运行期校验（JS 调用面传错 id＝装配错误，不静默计数到无名桶） */
function assertExitId(exit: OutboundExitId): OutboundExitDef {
  return outboundExitDef(exit)
}

function assertThreeNotInId(point: ThreeNotInId): ThreeNotInDef {
  return threeNotInDef(point)
}

/** 统一出站闸构造（装配点见 wire.ts；本函数纯内存，零 IO） */
export function createOutboundGate(options: OutboundGateOptions): OutboundGate {
  const knowns = [...options.knowns]
  const isFrozenEvent = options.isEventName ?? isEventName
  const now = options.now ?? ((): number => Date.now())
  const log = options.log ?? ((): void => {})
  const failureLimit = options.failureLimit ?? 128
  const counters = new Map<string, PointCounter>()
  const failures: OutboundFailureRecord[] = []
  let failuresDropped = 0

  const counterOf = (key: string): PointCounter => {
    const found = counters.get(key)
    if (found !== undefined) return found
    const fresh = emptyCounter()
    counters.set(key, fresh)
    return fresh
  }

  const counterFor = (surface: OutboundFailureSurface, point: string): PointCounter =>
    counterOf(`${surface}:${point}`)

  const record = (
    surface: OutboundFailureSurface,
    point: string,
    code: OutboundFailureCode,
    action: OutboundFailureAction,
  ): OutboundFailureRecord => {
    const vocabulary: OutboundVocabularyStatus = outboundVocabularyStatus(code, isFrozenEvent)
    const failure: OutboundFailureRecord = {
      surface,
      point,
      code,
      action,
      at: now(),
      vocabulary,
      note: outboundFailureNote({ surface, point, code, action, vocabulary }),
    }
    // 可判定性自检：可判定不是事后声明，是记录产生时的结构约束（NEG-SEC-07）。
    // 经 unknown 转发判定：失败记录结构已被 TS 认定为 OutboundFailureRecord，直接判会窄成 never。
    const determinable: unknown = failure
    if (!isDeterminableOutboundFailure(determinable)) {
      throw new Error(`outbound-gate：失败记录不可判定（结构自检失败）——${failure.note}`)
    }
    if (failures.length < failureLimit) failures.push(failure)
    else failuresDropped += 1
    try {
      options.onFailure?.(failure)
    } catch (err) {
      // 观测面软失败：落账异常不炸调用面（失败本身已在记录里；缺台账=另行排查）
      log(`[outbound-gate] 失败落账异常（软失败）：${err instanceof Error ? err.message : String(err)}`)
    }
    log(`[outbound-gate] ${action === 'blocked' ? '阻断' : '处置'}：${failure.note}`)
    return failure
  }

  const guardTextAt = (
    surface: OutboundFailureSurface,
    point: string,
    text: string,
    scanOptions: ScanOptions,
  ): string => {
    const counter = counterFor(surface, point)
    counter.scans += 1
    const outcome = scanOutboundText(text, knowns, scanOptions)
    if (!outcome.ok) {
      counter.blocked += 1
      throw new OutboundBlockedError(record(surface, point, outcome.code, 'blocked'))
    }
    counter.redactions += outcome.redactions
    return outcome.text
  }

  const guardPayloadAt = (
    surface: OutboundFailureSurface,
    point: string,
    payload: unknown,
    scanOptions: ScanOptions,
  ): unknown => {
    const counter = counterFor(surface, point)
    counter.scans += 1
    const outcome = scanOutboundPayload(payload, knowns, scanOptions)
    if (!outcome.ok) {
      counter.blocked += 1
      throw new OutboundBlockedError(record(surface, point, outcome.code, 'blocked'))
    }
    counter.redactions += outcome.redactions
    return outcome.value
  }

  const guard = (exit: OutboundExitId, text: string): string => {
    assertExitId(exit)
    return guardTextAt('exit', exit, text, { shapeFallback: true })
  }

  const guardPayload = (exit: OutboundExitId, payload: unknown): unknown => {
    assertExitId(exit)
    return guardPayloadAt('exit', exit, payload, { shapeFallback: true })
  }

  const guardPromptText = (text: string): string => {
    assertThreeNotInId('prompt')
    // 内部供给面（提示词/任务书）：只换已知值、不做形状兜底——教学/示例文本必须原样可见
    // （docs/80-§11.2.1 分工；形状兜底会连 `password=…` 一类示例一起毁掉）
    return guardTextAt('three-not-in', 'prompt', text, { shapeFallback: false })
  }

  const guardStoreRecord = <T>(recordValue: T): T => {
    assertThreeNotInId('store')
    // payload_hash=完整性引用（sha256 形恰似长随机串）——结构列不脱敏，自由文本列（note）照扫
    return guardPayloadAt('three-not-in', 'store', recordValue, {
      shapeFallback: true,
      skipKeys: ['payload_hash'],
    }) as T
  }

  const guardLog = (line: string): string => {
    const counter = counterFor('three-not-in', 'log')
    counter.scans += 1
    try {
      let text = line
      // 判据一（v2/15 §4.5 日志面）：env 名带值打印——检出即抹值，留键名做诊断
      const printed = findEnvNamePrinting(text)
      if (printed.length > 0) {
        text = redactEnvNamePrinting(text).text
        record('three-not-in', 'log', 'env-print-blocked', 'redacted')
        counter.redactions += printed.length
      }
      // 判据二：值形态（已知值＋形状兜底）
      const outcome = scanOutboundText(text, knowns, { shapeFallback: true })
      if (!outcome.ok) {
        counter.blocked += 1
        record('three-not-in', 'log', outcome.code, 'blocked')
        return `[outbound-gate] 日志行被拦截（${outcome.code}；原值不落日志）`
      }
      counter.redactions += outcome.redactions
      return outcome.text
    } catch {
      counter.blocked += 1
      // 记录不可判定/扫描核异常都按失败入账（值仍不落日志；整行替换是最后防线）
      record('three-not-in', 'log', 'redaction-failed', 'blocked')
      return '[outbound-gate] 日志行被拦截（扫描异常；原值不落日志；记录见失败台账）'
    }
  }

  const recordBlocked = (exit: OutboundExitId, code: OutboundFailureCode): OutboundFailureRecord => {
    assertExitId(exit)
    return record('exit', exit, code, 'blocked')
  }

  const coverage = (): OutboundCoverage => {
    const exits: OutboundExitCoverage[] = OUTBOUND_EXIT_CATALOG.map((def) => {
      const counter = counterOf(`exit:${def.id}`)
      return {
        ...def,
        scans: counter.scans,
        redactions: counter.redactions,
        blocked: counter.blocked,
      }
    })
    const threeNotIn: ThreeNotInCoverage[] = THREE_NOT_IN_CATALOG.map((def) => {
      const counter = counterOf(`three-not-in:${def.id}`)
      return {
        ...def,
        scans: counter.scans,
        redactions: counter.redactions,
        blocked: counter.blocked,
      }
    })
    const scanned = exits.reduce((n, e) => n + e.scans, 0) + threeNotIn.reduce((n, e) => n + e.scans, 0)
    const blocked = exits.reduce((n, e) => n + e.blocked, 0) + threeNotIn.reduce((n, e) => n + e.blocked, 0)
    return {
      exits,
      threeNotIn,
      gaps: outboundExitGaps(),
      wired: exits.filter((e) => e.status === 'wired').length,
      gapCount: exits.filter((e) => e.status === 'gap').length,
      scanned,
      blocked,
      failures: failures.length,
      failuresDropped,
    }
  }

  const startupLine = (): string => {
    const cov = coverage()
    return (
      `[outbound-gate] 五出口：wired=${String(cov.wired)} / gap=${String(cov.gapCount)}` +
      `（${cov.gaps.length > 0 ? cov.gaps.join('、') : '无'}）；三不入强制点=${THREE_NOT_IN_IDS.join('/')}；` +
      `失败词表缺口=${OUTBOUND_EVENT_VOCAB_GAP.names.join('、')}` +
      `（contract patch 经 C；落账承载=${OUTBOUND_EVENT_VOCAB_GAP.fallbackEvent} note，判定行前缀=${OUTBOUND_FAILURE_NOTE_PREFIX}）`
    )
  }

  return {
    knownsCount: knowns.length,
    exits: OUTBOUND_EXIT_CATALOG,
    threeNotIn: THREE_NOT_IN_CATALOG,
    gaps: outboundExitGaps(),
    guard,
    guardPayload,
    guardEvidenceExport: (text: string): string => guard('evidence-export', text),
    guardApiResponse: (payload: unknown): unknown => guardPayload('api-response', payload),
    guardPromptText,
    promptRedactor: (text: string): string => guardPromptText(text),
    guardStoreRecord,
    guardLog,
    recordBlocked,
    coverage,
    failures: () => [...failures],
    startupLine,
  }
}
