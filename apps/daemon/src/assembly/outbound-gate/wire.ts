/**
 * wire —— 出站闸装配件：五出口 wrapper ＋ 三不入强制点 wrapper ＋ 失败台账落点（IMPL-07-11）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/plan/05 IMPL-07-11：接线「prompt/API/平台写至少一个真实出口过闸；其余出口
 *     登记 gap 或统一 wrapper」；本文件即统一 wrapper 面（生产装配点在
 *     assembly/serve/runtime.ts，出口目录见 exits.ts，缺口显式）；
 *   - docs/v2/15 §4.4（SEC-SEC-04）：出站闸覆盖五出口；失败事件可判定；
 *   - docs/v2/15 §4.5（SEC-SEC-05）：三不入强制点（库/提示词/日志）；
 *   - docs/v2/17 NEG-SEC-07/N-g：失败事件可判定＋覆盖全出口（落账承载＝ESCALATE note，
 *     见 createLedgerFailureSink；词表缺口见 failures.ts OUTBOUND_EVENT_VOCAB_GAP）。
 *
 * 装配纪律：
 *   - **一份 knowns、一个闸**：五出口/三不入点全部经同一 gate 实例（本文件不另造秘密集）；
 *   - **透明 wrapper**：平台/通知 wrapper 结构同形（调用方签名不变），只多一道出站扫描；
 *   - **失败不静默**：平台/提示词/库阻断＝抛（fail-closed）；通知阻断＝软失败面回报；
 *     日志阻断＝整行替换；四者都落可判定失败记录（onFailure → ESCALATE note）。
 */
import type {
  FlowPlatform,
  IssueCreate,
  IssueRecord,
  Notification,
  SignedBody,
} from '@studio-next/contract'
import type { AppendResult, Ledger } from '@studio-next/store'
import type {
  NotifyBroadcastFace,
  NotifyBroadcastTargets,
  NotifySendReport,
} from '../../engine/notify/broadcast.ts'
import { makeUlid } from '../../engine/tools/id.ts'
import { collectHrSecrets } from '../hrsync/config.ts'
import { createOutboundGate } from './gate.ts'
import type { OutboundGate, OutboundGateOptions } from './gate.ts'
import type { OutboundFailureRecord } from './failures.ts'

/**
 * 已知秘密值收集（出站闸唯一入口）：与 hrsync 装配同源（同一 env 键集＋装配单元补充面），
 * 不复制键表——`TAIGA_*`/`MATRIX_*` 五键是当前已登记的秘密 env 面（v2/15 §4.1 SEC-T1）；
 * 值只在闸闭包内参与比对，不回显、不落持久层。
 */
export function collectOutboundKnowns(env: NodeJS.ProcessEnv, extra?: readonly string[]): string[] {
  return collectHrSecrets(env, extra)
}

/** 装配入参（knowns=collectOutboundKnowns 产物；log 必须是**未过闸**的原始日志出口） */
export interface WireOutboundGateArgs {
  readonly knowns: readonly string[]
  readonly log?: (line: string) => void
  readonly onFailure?: (failure: OutboundFailureRecord) => void
  readonly isEventName?: (candidate: string) => boolean
  readonly now?: () => number
}

/** 装配产物：一个闸＋五出口/三不入 wrapper（runtime.ts 按出口逐条接线） */
export interface OutboundWiring {
  readonly gate: OutboundGate
  /** 日志出口 wrapper（包装 raw log；每条行过闸，永不抛） */
  readonly guardLog: (rawLog: (line: string) => void) => (line: string) => void
  /** 平台写出口 wrapper（issues.create/setField、comments.add、kb.upsert 过闸） */
  readonly wrapPlatform: (platform: FlowPlatform) => FlowPlatform
  /** 通知出口 wrapper（Notification 过闸；阻断＝软失败面，不抛） */
  readonly wrapNotifyFace: (face: NotifyBroadcastFace) => NotifyBroadcastFace
  /** 三不入·库 wrapper（Ledger.appendEvent 写前过闸；其余方法透明转发） */
  readonly createStoreWriteGuard: (ledger: Ledger) => Ledger
  /** 证据导出面 wrapper（catalog gap：生产装配点未落位；先备好接线面） */
  readonly guardEvidenceExport: (text: string) => string
  /** API 响应面 wrapper（catalog gap：runServe API 装配位未接线；先备好接线面） */
  readonly guardApiResponse: (payload: unknown) => unknown
  /** 装配行（缺口/词表缺口显式；无秘密值） */
  readonly startupLine: string
}

/** 出站闸装配（runServe 装配序调用一次；返回值逐出口接线） */
export function wireOutboundGate(args: WireOutboundGateArgs): OutboundWiring {
  const options: OutboundGateOptions = {
    knowns: args.knowns,
    ...(args.log !== undefined ? { log: args.log } : {}),
    ...(args.onFailure !== undefined ? { onFailure: args.onFailure } : {}),
    ...(args.isEventName !== undefined ? { isEventName: args.isEventName } : {}),
    ...(args.now !== undefined ? { now: args.now } : {}),
  }
  const gate = createOutboundGate(options)
  const startupLine = gate.startupLine()
  args.log?.(startupLine)
  return {
    gate,
    guardLog: (rawLog: (line: string) => void): ((line: string) => void) =>
      (line: string): void => {
        rawLog(gate.guardLog(line))
      },
    wrapPlatform: (platform: FlowPlatform): FlowPlatform => wrapPlatformWrite(platform, gate),
    wrapNotifyFace: (face: NotifyBroadcastFace): NotifyBroadcastFace => wrapNotifyOutbound(face, gate),
    createStoreWriteGuard: (ledger: Ledger): Ledger => createStoreWriteGuard(ledger, gate),
    guardEvidenceExport: (text: string): string => gate.guardEvidenceExport(text),
    guardApiResponse: (payload: unknown): unknown => gate.guardApiResponse(payload),
    startupLine,
  }
}

/**
 * serve 装配面便捷入口（runServe 装配序唯一调用点）：knowns 收集＋失败台账落点＋闸一次装好；
 * runtime.ts 只拿返回值逐出口接线（保持装配文件短小——20-§十五.三 尺寸阈）。
 * 失败落点＝`ESCALATE` note（冻结词表既有名；失败事件名缺口见 failures.ts，不静默）。
 */
export interface ServeOutboundArgs {
  readonly env: NodeJS.ProcessEnv
  readonly extraKnowns?: readonly string[]
  readonly ledger: Ledger
  readonly company: string
  readonly dept: string
  readonly issue: string
  readonly clock: () => number
  readonly rawLog: (line: string) => void
}

/** 装配函数（见上；返回值同 OutboundWiring） */
export function wireServeOutboundGate(args: ServeOutboundArgs): OutboundWiring {
  return wireOutboundGate({
    knowns: collectOutboundKnowns(args.env, args.extraKnowns),
    log: args.rawLog,
    onFailure: createLedgerFailureSink({
      ledger: args.ledger,
      company: args.company,
      actor: 'daemon/outbound-gate',
      dept: args.dept,
      issue: args.issue,
      clock: args.clock,
      log: args.rawLog,
    }),
  })
}

/**
 * 平台写出口 wrapper（exits.ts platform-write 行）：
 * 只包**携带出站文本**的写方法——issues.create（title/description）、issues.setField（值可能是
 * 文本）、comments.add（body/signature）、kb.upsert（md）。状态推进/链接/字段 provision 的
 * 参数是枚举/id/结构名，不是自由文本，原样透传（不制造无意义 redact 面）。
 * 闸阻断＝该次写抛 OutboundBlockedError（fail-closed：宁可写失败，不出未扫描文本）。
 */
export function wrapPlatformWrite(platform: FlowPlatform, gate: OutboundGate): FlowPlatform {
  return {
    ...platform,
    issues: {
      ...platform.issues,
      create: (input: IssueCreate): Promise<IssueRecord> =>
        platform.issues.create(gate.guardPayload('platform-write', input) as IssueCreate),
      setField: (id: string, field: string, value: unknown): Promise<void> =>
        platform.issues.setField(id, field, gate.guardPayload('platform-write', value)),
    },
    comments: {
      ...platform.comments,
      add: (id: string, body: SignedBody): Promise<void> =>
        platform.comments.add(id, gate.guardPayload('platform-write', body) as SignedBody),
    },
    kb: {
      ...platform.kb,
      upsert: (path: string, md: string): Promise<void> =>
        platform.kb.upsert(path, gate.guard('platform-write', md)),
    },
  }
}

/**
 * 通知出口 wrapper（exits.ts notify 行；docs/v2/15 §4.4）：
 * Notification.title/body/links 出站前过闸。扫描失败＝**不发送**（fail-closed），按
 * 「发送≠接受」软失败面返回 failed（引擎/中继契约要求 send 永不抛，刀B-6）；同时落
 * `notify-blocked` 可判定记录（NEG-SEC-07）。
 */
export function wrapNotifyOutbound(face: NotifyBroadcastFace, gate: OutboundGate): NotifyBroadcastFace {
  return {
    send: async (message: Notification, targets: NotifyBroadcastTargets): Promise<NotifySendReport> => {
      let safe: Notification
      try {
        safe = gate.guardPayload('notify', message) as Notification
      } catch {
        gate.recordBlocked('notify', 'notify-blocked')
        return { sent: [], failed: [{ target: 'outbound-gate', reason: 'notify-blocked' }] }
      }
      return face.send(safe, targets)
    },
  }
}

/**
 * 三不入·库 wrapper（docs/v2/15 §4.5 库面）：`Ledger.appendEvent` 是 events 唯一写口，
 * 写前对记录深扫（已知值＋形状）；脱敏后仍检出＝抛（拒写，fail-closed）。
 * 其余台账方法透明转发（本单只承担 events 写口的扫描义务；其它写面以同一闸可扩展）。
 */
export function createStoreWriteGuard(ledger: Ledger, gate: OutboundGate): Ledger {
  return new Proxy(ledger, {
    get(target: Ledger, prop: string | symbol): unknown {
      if (prop === 'appendEvent') {
        return (record: unknown): AppendResult => target.appendEvent(gate.guardStoreRecord(record))
      }
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? (value as (...callArgs: unknown[]) => unknown).bind(target) : value
    },
  })
}

/** 失败落账入参（raw ledger＝**未包** createStoreWriteGuard 的原件：失败 note 无值，防递归） */
export interface LedgerFailureSinkArgs {
  readonly ledger: Ledger
  readonly company: string
  readonly actor: string
  readonly dept: string
  /** 哨兵单号（events.issue 必填；缺省 `-`＝ENGINE_CONFIG_DEFAULTS.heartbeatIssue 同源） */
  readonly issue: string
  readonly level?: number
  readonly attempt?: number
  readonly clock: () => number
  readonly log?: (line: string) => void
}

/**
 * 失败台账落点（NEG-SEC-07 的「留证」；docs/audit-DSF/V13-01 修法③的零新事件名通道）：
 * 每次出站失败写一条**冻结词表既有事件** `ESCALATE`，note=`outbound-gate: <确定性失败行>`
 * （值零出现、可逆解析）。词表增补后（contract 加失败事件名）落账承载可切换，闸侧
 * `failure.vocabulary` 已给出 registered/gap 判定。
 * 观测面软失败：落账异常只写闸日志，不改变出站结论（出站结论已在闸内定死）。
 */
export function createLedgerFailureSink(args: LedgerFailureSinkArgs): (failure: OutboundFailureRecord) => void {
  return (failure: OutboundFailureRecord): void => {
    try {
      args.ledger.appendEvent({
        id: makeUlid(args.clock()),
        ts: args.clock(),
        company: args.company,
        issue: args.issue,
        event: failure.vocabulary.fallbackEvent,
        actor: args.actor,
        attempt: args.attempt ?? 1,
        level: args.level ?? 1,
        dept: args.dept,
        tokens: { input: 0 },
        note: `outbound-gate: ${failure.note}`,
      })
    } catch (err) {
      args.log?.(`[outbound-gate] 失败落账异常（软失败，不改变出站结论）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
