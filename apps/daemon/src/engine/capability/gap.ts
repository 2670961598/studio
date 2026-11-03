/**
 * capability/gap —— 能力缺口/退化/成本失控的**五出口决策接线件**（NEG-RING-03；TR-RING-03）
 *
 * 规格依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/17 §5.1 NEG-RING-03 行（缺能力/退化/成本失控仍接单→缩/换/外援/拒绝/停止
 *     五出口必答）；§3.3 TR-RING-03（能力环；REC-CAP-01..04＋REC-WORK-06/07）；
 *   - docs/v2/02 §五「能力链」·「能力缺失」段（明示缺什么/影响什么/持续多久/有何替代；
 *     处置阶梯＝缩→换→补足→外援→拒绝/停止；**不得静默退化**）；§五 成本不可接受是
 *     停止或替换的正当理由；
 *   - docs/v2/05 §五 能力环行；docs/v2/07 §一 CAP-03 替换/CAP-04 吊销；
 *   - docs/17-§2 主循环七相位（state-diff 判定相位）——本件只做**判定编排与出口策略**，
 *     判定本体＝core `decideCapabilityGap`（零判定复制）。
 *
 * 接线语义（何时调用）：
 *   - 派发选不出存活 executor → kind=`missing`（能力缺口）；
 *   - executor `detect()` 不达标 → kind=`degraded`（能力退化，负向发现进 REC-CAP-RECEIPT）；
 *   - 预算闸 refusal（超帽） → kind=`cost_runaway`（成本失控）。
 *
 * fail-closed 纪律：决策输入（缺口声明/处置出口）缺失、出口不在五出口封闭集、出口三件
 * 不全、策略函数抛错——一律返回 `ok:false` 并由调用方**拒绝继续**（不派发/不静默降级）。
 * 本件零 IO／零时钟（时点由调用方携带）；不新增记录类/端口（契约面不改）。
 */
import {
  decideCapabilityGap,
  type CapabilityGapDecision,
  type CapabilityGapExit,
  type CapabilityGapKind,
} from '@studio-next/core'

/** 缺口信号（调用方在判定相位按现场事实装齐；不是记录形状） */
export interface CapabilityGapRequest {
  /** 单号（影响面回指） */
  readonly ticket: string
  /** 尝试序号（同一单多次派发可区分） */
  readonly attempt: number
  /** 缺口类别三值（02 §五：能力缺失/能力退化/成本不可接受） */
  readonly kind: CapabilityGapKind
  /** 缺什么（能力/执行体引用） */
  readonly capabilityRef: string
  /** 影响什么（受影响单据/承诺引用） */
  readonly impactRef: string
  /** 观测时点（ISO；由调用方时钟注入，本件不读墙钟） */
  readonly at: string
  /** 持续多久（可缺省＝未答，进 missingAnswers，不阻断处置） */
  readonly durationRef?: string
  /** 有何替代（可缺省＝未答；空数组＝明示无可替代） */
  readonly alternativeRefs?: readonly string[]
}

/** 处置出口声明（策略产出；`exit` 为声明值，运行期按五出口封闭集判定） */
export interface CapabilityGapDisposition {
  readonly exit: string
  readonly reason?: string
  readonly authorityRef?: string
  readonly impactRef?: string
}

/**
 * 出口策略（纯函数；缺省＝`defaultCapabilityGapPolicy`）。
 * 返回 `undefined`＝策略未给出口——决策层 fail-closed（gap-exit-missing），不得默认继续。
 */
export type CapabilityGapPolicy = (request: CapabilityGapRequest) => CapabilityGapDisposition | undefined

/**
 * 缺省出口策略（**保守档**：当前链路无缩范围/换配置/外援的自动执行面，故缺能力与退化
 * 一律拒绝（refuse），成本失控一律停止（stop）——是「说明不能」而非静默继续；策略注入位
 * 留给后续具备真实替换/外援执行面的刀，不在本件伪造动作）。
 */
export function defaultCapabilityGapPolicy(request: CapabilityGapRequest): CapabilityGapDisposition {
  switch (request.kind) {
    case 'missing':
      return {
        exit: 'refuse',
        reason: '注册表无存活 executor：能力未证，不得无能力接单（02 §五；17 §5.1 NEG-RING-03）',
        authorityRef: 'v2/02-§五',
        impactRef: request.impactRef,
      }
    case 'degraded':
      return {
        exit: 'refuse',
        reason: 'executor detect 不达标（能力退化）：不得静默降级/降标冒充（02 §五）',
        authorityRef: 'v2/07-§一',
        impactRef: request.impactRef,
      }
    case 'cost_runaway':
      return {
        exit: 'stop',
        reason: '预算超帽（成本不可接受）：成本不可接受是停止或替换的正当理由（02 §五）',
        authorityRef: 'v2/02-§五',
        impactRef: request.impactRef,
      }
  }
}

/** 决策通过：出口+留痕串（调用方落事件/日志/台账锚） */
export interface CapabilityGapRulingOk {
  readonly ok: true
  readonly exit: CapabilityGapExit
  readonly decision: CapabilityGapDecision
  /** 出口动作留痕（append-only 事件 note 用；无换行、可 grep） */
  readonly trace: string
  /** 派发失败 detail 用（短串，含出口） */
  readonly detail: string
}

/** 决策拒绝（fail-closed）：调用方不得继续，必须如实上报 */
export interface CapabilityGapRulingErr {
  readonly ok: false
  readonly subcause: string
  readonly detail: string
  readonly trace: string
}

export type CapabilityGapRuling = CapabilityGapRulingOk | CapabilityGapRulingErr

/** 缺口引用（决策可回指；确定性由调用方提供的字段拼成，不含随机/时钟读取） */
function gapRefOf(request: CapabilityGapRequest): string {
  return `cap-gap:${request.ticket}:${request.attempt}:${request.kind}:${request.at}`
}

/**
 * 五出口决策接线（纯函数）：装声明+出口 → core `decideCapabilityGap` → 通过/拒绝。
 *
 * 拒绝面（全部 `ok:false`，调用方 fail-closed）：
 *   ① 策略抛错 → `gap-policy-error`；
 *   ② 策略未给出口 → core `gap-exit-missing`；
 *   ③ 出口非法/继续形 → core `gap-exit-not-closed`；
 *   ④ 出口三件缺失 → core `gap-exit-reason-missing` / `gap-exit-authority-missing` /
 *      `gap-exit-impact-missing`；
 *   ⑤ 缺口声明不完整 → core `gap-declaration-*` / `gap-kind-unknown` / `gap-capability-missing` /
 *      `gap-impact-missing`。
 */
export function judgeCapabilityGap(
  request: CapabilityGapRequest,
  policy: CapabilityGapPolicy = defaultCapabilityGapPolicy,
): CapabilityGapRuling {
  let disposition: CapabilityGapDisposition | undefined
  try {
    disposition = policy(request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const subcause = 'gap-policy-error'
    return {
      ok: false,
      subcause,
      detail: `能力缺口出口策略抛错（${subcause}）：${message}——fail-closed 不继续`,
      trace: `cap-gap:${request.ticket};kind=${request.kind};fail-closed=${subcause}`,
    }
  }

  const result = decideCapabilityGap({
    declaration: {
      gapRef: gapRefOf(request),
      kind: request.kind,
      capabilityRef: request.capabilityRef,
      impactRef: request.impactRef,
      ...(request.durationRef !== undefined ? { durationRef: request.durationRef } : {}),
      ...(request.alternativeRefs !== undefined ? { alternativeRefs: request.alternativeRefs } : {}),
    },
    // 缺省/未给＝无出口：core 判 gap-exit-missing（不默认继续）
    ...(disposition !== undefined ? { dispositions: [disposition] } : {}),
  })

  if (result.kind === 'err') {
    const subcause = result.error.subcause
    const detail = result.error.detail ?? '(无 detail)'
    return {
      ok: false,
      subcause,
      detail: `能力缺口决策拒绝（${subcause}）：${detail}——fail-closed 不继续`,
      trace: `cap-gap:${request.ticket};attempt=${request.attempt};kind=${request.kind};fail-closed=${subcause};detail=${detail.replace(/\s+/gu, ' ')}`,
    }
  }

  const { declaration, disposition: chosen, missingAnswers } = result.value
  const base = `cap-gap:${request.ticket};attempt=${request.attempt};gapRef=${declaration.gapRef};kind=${declaration.kind};exit=${chosen.exit};authority=${chosen.authorityRef};impact=${chosen.impactRef};reason=${chosen.reason.replace(/[;\n]+/gu, ' ')}`
  const trace = missingAnswers.length === 0 ? base : `${base};missing=${missingAnswers.join(',')}`
  return {
    ok: true,
    exit: chosen.exit,
    decision: result.value,
    trace,
    detail: `capability-gap:${declaration.kind};exit=${chosen.exit}`,
  }
}
