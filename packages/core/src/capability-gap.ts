/**
 * capability-gap —— 能力缺口/退化/成本失控的**五出口决策**（NEG-RING-03；TR-RING-03 能力环）
 *
 * 依据：
 *   - v2/17 §4.1 NEG-RING-03 行（构造场景＝缺能力/退化/成本失控仍接单；预期拒绝＝
 *     缩/换/外援/拒绝/停止五出口必答，02 §五）；§3.3 TR-RING-03（能力环；
 *     REC-CAP-01..04＋REC-WORK-06/07；V1＋V3）；
 *   - v2/02 §五「能力链」·「能力缺失」段（唯一语义主表）：明示缺什么、影响什么、持续多久、
 *     有何替代；处置阶梯＝缩小范围（实施面 v2/04）→替换配置→补足能力→外部能力（按 v2/03
 *     授权，**不转移责任**）→拒绝或停止；**不得虚构能力、降低验收口径、静默退化**；成本
 *     不可接受是停止或替换的正当理由，不是伪造完成的理由；
 *   - v2/05 §五 能力环行（缺能力、退化、成本失控须缩/换/外援/拒绝/停止）；
 *   - v2/07 §一 CAP-03 替换/CAP-04 吊销（换能力＝生效事务而非文案）与 §六 HCL 族（替换
 *     级别；换能力触发开工重判）；v2/04 §二 受理五取值（拒绝须附理由/异议位置/再申请标准；
 *     **无能力须明示缺口与替代路径**）、§四 开工五门与重判（能力退化或更换＝重判，不是
 *     继续）；
 *   - v2/01 §四 R-7 反例（执行能力退化、不可用或成本失控→明示不能；降级/替换/拒绝或停止；
 *     不得降标冒充完成）。
 *
 * 五出口（本件的机器封闭集；语义回 v2/02 §五，不在本件重述）：
 *   reduce   缩小范围——缩到已认定能力与已承诺口径内（实施面 v2/04）；
 *   replace  替换配置/能力——v2/07 CAP-03；实质变更先重认（v2/02 §五）；
 *   external 外部能力——按 v2/03 授权取得，**不转移责任**（授权引用随处置携带）；
 *   refuse   拒绝——不受理/不接单（受理记录另须异议位置/再申请标准，v2/04 §二；本件只判
 *            出口三件，不代造受理记录）；
 *   stop     停止——在途终止/暂停（v2/04 §五：终止由有权位置决定型作出）。
 *
 * 纪律：
 *   - **恰选其一**：单次决策只认一个主处置出口。缺出口／出口多于一个／出口不在封闭集内
 *     （含以「继续原路径」「接受风险」代替出口）一律 Err——不得默认继续，也不得以并列出口
 *     冒充已选择；退化与成本失控同责（02 §五：静默退化＝违规；成本不可接受不是伪造完成的
 *     理由）。
 *   - **每个出口带三件**：理由／授权引用／影响，缺一即 Err（v2/04 §二「拒绝须附理由」；
 *     02 §五 外部能力按 v2/03 授权；影响面须明示）。授权引用只**携带不核验**——核验面在
 *     authority.ts（PORT-AUTH），本件不因「引用存在」判定有权，也不因「外部」转移责任。
 *   - **四答两分**：缺什么／影响什么为判据（缺即拒——空转的缺口声明不能进入出口选择）；
 *     持续多久／有何替代为携带项（可不答：如实进 `missingAnswers`，但**不得默认视为已答**，
 *     也不因此阻断处置——阻断等于逼声明者编造，违「不伪造」）。`alternativeRefs: []`＝明示
 *     无可替代（已答），`undefined`／全空白＝未答。
 *   - **零 IO／无时钟**：不读时钟/环境/文件/网络；时点由调用方在落记录时携带；同输入恒同决策。
 *   - **不复制记录形状**：输入是最小声明接口（不是 REC-CAP/REC-WORK 完整记录），输出是决策
 *     结论（不是记录）；引用组装与落盘归 store/daemon。本件不新增记录类、不新增端口。
 *   - **Err 形状**＝`PortResult`（v2/14 §0.2-2：Err 只表「确定未产生外部效果的拒绝」；四答
 *     齐备＝类别/可否重试/副作用可能/对账入口＋责任位置）——与 core 现有 prm 纯判定同形，
 *     不另造错误类。
 *
 * 张力登记（不在本件自判）：
 *   - v2/02 §五 处置阶梯含「补足能力」一档，而 v2/17 §4.1 NEG-RING-03 行与 v2/05 §五 只列
 *     缩/换/外援/拒绝/停止五出口。本件按五出口封闭实现（NEG-RING-03 的验收口径）；若把
 *     「补足能力/supplement」声明为出口，按封闭集外值拒（`gap-exit-not-closed`）——是否增列
 *     第六出口属文档口径，本件不代决、不自增。
 *   - 五出口值集在 v2/09 无 ENU 登记（文档面只有正文与验证行）；本件只把正文封闭为机器值，
 *     不造 ENU 号、不建第二登记处。
 */

import type { PortResult } from '@studio-next/contract'

// ─────────────────────────────────────────────────────────────────────────────
// 一、封闭值集（缺口类别三值／五出口／继续形非出口／四答携带项）
// ─────────────────────────────────────────────────────────────────────────────

/** 缺口类别三值（02 §五：能力缺失／能力退化／成本不可接受；未分类一律拒——fail-closed） */
export const CAPABILITY_GAP_KINDS = ['missing', 'degraded', 'cost_runaway'] as const

/** 缺口类别（值集见 `CAPABILITY_GAP_KINDS`） */
export type CapabilityGapKind = (typeof CAPABILITY_GAP_KINDS)[number]

/**
 * 五出口封闭集（顺序＝v2/02 §五 处置阶梯序：缩→换→外援→拒绝/停止；**不是**优先级排序，
 * 也不是 kind→exit 矩阵——任何类别都可选任一出口，本件不造矩阵）。
 */
export const CAPABILITY_GAP_EXITS = ['reduce', 'replace', 'external', 'refuse', 'stop'] as const

/** 处置出口（值集见 `CAPABILITY_GAP_EXITS`） */
export type CapabilityGapExit = (typeof CAPABILITY_GAP_EXITS)[number]

/**
 * 「代替出口」的继续形语形（继续原路径／接受风险／维持现状）——**不是出口**。
 * 本表只用于错误说明与负例锚：任何非五出口值一律 Err，不因不在本表而放行。
 */
export const CAPABILITY_GAP_CONTINUATION_FORMS = [
  'continue',
  'continue_original_path',
  'continue_as_before',
  'accept_risk',
  'accept_risk_and_continue',
  'accepted_risk',
  'maintain',
  'maintain_status_quo',
  'no_change',
  'ignore',
  '继续原路径',
  '接受风险',
  '维持现状',
] as const

/** 缺口声明四答中可「未答」的两项（02 §五：持续多久、有何替代；缺什么/影响什么为判据） */
export const CAPABILITY_GAP_ANSWERS = ['duration', 'alternative'] as const

/** 四答中的携带项（未答时进决策的 `missingAnswers`，不得默认视为已答） */
export type CapabilityGapAnswer = (typeof CAPABILITY_GAP_ANSWERS)[number]

const KIND_SET: ReadonlySet<string> = new Set(CAPABILITY_GAP_KINDS)
const EXIT_SET: ReadonlySet<string> = new Set(CAPABILITY_GAP_EXITS)
const CONTINUATION_SET: ReadonlySet<string> = new Set(CAPABILITY_GAP_CONTINUATION_FORMS)

// ─────────────────────────────────────────────────────────────────────────────
// 二、输入面（最小声明接口；不是记录形状）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 缺口声明（02 §五 四答＋身份）。`kind`/引用类字段按声明值收（`string`），运行期按封闭集判：
 * 未分类/空白一律 Err——输入是**主张**不是已校验事实。
 */
export interface CapabilityGapDeclaration {
  /** 缺口声明引用（决策须可回指；匿名处置不接受） */
  readonly gapRef: string
  /** 缺口类别声明值（运行期按 `CAPABILITY_GAP_KINDS` 判定） */
  readonly kind: string
  /** 缺什么（能力/资格引用，02 §五 四答之一） */
  readonly capabilityRef: string
  /** 影响什么（受影响工作/承诺/验收口径引用，四答之一） */
  readonly impactRef: string
  /** 持续多久（可缺省＝未答，进 `missingAnswers`；可写「未知/待复审」类引用） */
  readonly durationRef?: string | undefined
  /** 有何替代（可缺省＝未答；空数组＝**明示无可替代**，属已答） */
  readonly alternativeRefs?: readonly string[] | undefined
}

/** 处置出口声明（一次决策一个；`exit` 为声明值，运行期按五出口封闭集判定） */
export interface CapabilityGapExitClaim {
  /** 出口声明值（运行期按 `CAPABILITY_GAP_EXITS` 判定；继续形/未知值一律拒） */
  readonly exit: string
  /** 理由（02 §五 能力缺失；必填非空） */
  readonly reason?: string | undefined
  /** 授权引用（外部能力按 v2/03 授权且不转移责任；本件只携带不核验） */
  readonly authorityRef?: string | undefined
  /** 该出口的影响（影响什么、影响谁；必填非空） */
  readonly impactRef?: string | undefined
}

/** 决策输入：缺口/退化/成本失控声明＋处置出口（缺省＝未给，**不是**默认继续） */
export interface CapabilityGapInput {
  /** 缺口声明；缺省即 Err（无声明无出口可判） */
  readonly declaration?: CapabilityGapDeclaration | undefined
  /** 处置出口声明；缺省或空＝缺出口 Err；多于一个＝多出口 Err */
  readonly dispositions?: readonly CapabilityGapExitClaim[] | undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、输出面（决策结论；不是记录）
// ─────────────────────────────────────────────────────────────────────────────

/** 已验证的缺口声明（引用原样携带，`kind` 已归一到三值） */
export interface CapabilityGapFacts {
  readonly gapRef: string
  readonly kind: CapabilityGapKind
  readonly capabilityRef: string
  readonly impactRef: string
  readonly durationRef?: string
  readonly alternativeRefs: readonly string[]
}

/** 已验证的处置出口（出口在封闭集内；理由/授权引用/影响三件齐备） */
export interface CapabilityGapChosenExit {
  readonly exit: CapabilityGapExit
  readonly reason: string
  readonly authorityRef: string
  readonly impactRef: string
}

/** 决策结论（不是记录；落盘形状归 v2/11／store，本件只给已过判定的三面） */
export interface CapabilityGapDecision {
  readonly declaration: CapabilityGapFacts
  readonly disposition: CapabilityGapChosenExit
  /** 未答的携带项（02 §五：持续多久／有何替代）；空数组＝四答齐备 */
  readonly missingAnswers: readonly CapabilityGapAnswer[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、纯工具（不读时钟/环境/文件/网络）
// ─────────────────────────────────────────────────────────────────────────────

/** 声明值归一：去首尾空白、小写、连字符/空白折成下划线（只用于比对，不回写原文） */
function normalizeClaim(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/[-\s]+/gu, '_')
}

/** 读引用：非空字符串才算给了引用（原样返回，不裁剪——本件不改写声明） */
function readRef(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

function isGapKind(value: string): value is CapabilityGapKind {
  return KIND_SET.has(value)
}

function isGapExit(value: string): value is CapabilityGapExit {
  return EXIT_SET.has(value)
}

function kindLabel(kind: CapabilityGapKind): string {
  switch (kind) {
    case 'missing':
      return '能力缺失'
    case 'degraded':
      return '能力退化'
    case 'cost_runaway':
      return '成本失控'
  }
}

/**
 * 拒绝结论（`PortResult` 的 Err；v2/14 §0.2-2：Err 只表确定未产生外部效果的拒绝）。
 * 四答：纯判定无副作用、不可重试、无需对账；责任位置＝受理位置（v2/04 §二：受理义务；
 * 无能力须明示缺口与替代路径）。`subcause` 是本件内的判据串（不是 v2/10 诊断码——本件不造
 * 第二码表）。
 */
function rejected(
  subcause: string,
  detail: string,
  category: 'rejected_precondition' | 'rejected_forbidden' = 'rejected_precondition',
): PortResult<never> {
  return {
    kind: 'err',
    error: {
      category,
      subcause,
      detail,
      retryable: false,
      sideEffectPossible: false,
      reconcile: { required: false, reason: '纯函数判定：未写任何事实源，无需对账' },
      responsiblePosition: '受理位置（v2/04 §二）',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 五、决策（NEG-RING-03 的唯一判定面）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 缺能力/退化/成本失控的五出口决策（纯函数）。
 *
 * 判定顺序（fail-closed；任一不成立即 Err，不降级放行）：
 *   ① 声明在／有引用／类别已分类；
 *   ② 四答前两项（缺什么、影响什么）非空；
 *   ③ 处置出口**恰一个**（缺省/空＝缺出口；多于一个＝未作选择）；
 *   ④ 出口在五出口封闭集内（继续形一律 `rejected_forbidden`）；
 *   ⑤ 理由／授权引用／影响三件齐备；
 *   ⑥ 成功：回声明（含未答携带项）＋已验证出口。
 *
 * 退化与成本失控不因「已知/正在发生」而获默认继续：本函数没有「无出口」的成功分支，
 * 也没有任何缺省出口；`missingAnswers` 只表达「四答里后两项未答」，**不表达继续**。
 */
export function decideCapabilityGap(input: CapabilityGapInput): PortResult<CapabilityGapDecision> {
  // ① 声明与身份
  const declaration = input.declaration
  if (declaration === undefined) {
    return rejected(
      'gap-declaration-missing',
      '缺口声明缺失——五出口是对缺口/退化/成本失控的处置（02 §五），无声明即无出口可判',
    )
  }
  const gapRef = readRef(declaration.gapRef)
  if (gapRef === undefined) {
    return rejected('gap-declaration-ref-missing', '缺口声明缺引用（gapRef）——处置须可回指缺口声明，匿名处置不受理')
  }
  const kindClaim = normalizeClaim(declaration.kind)
  if (!isGapKind(kindClaim)) {
    return rejected(
      'gap-kind-unknown',
      `缺口类别「${String(declaration.kind)}」未分类——只接 ${CAPABILITY_GAP_KINDS.join('|')}；未分类不得默认继续（fail-closed）`,
    )
  }
  const kind = kindClaim
  const label = kindLabel(kind)

  // ② 四答前两项（判据面）
  const capabilityRef = readRef(declaration.capabilityRef)
  if (capabilityRef === undefined) {
    return rejected(
      'gap-capability-missing',
      `${label}：未明示缺什么（capabilityRef）——02 §五 四答之一；缺口声明不得空转`,
    )
  }
  const gapImpactRef = readRef(declaration.impactRef)
  if (gapImpactRef === undefined) {
    return rejected(
      'gap-impact-missing',
      `${label}：未明示影响什么（impactRef）——02 §五 四答之一；影响面不明不得选出口`,
    )
  }

  // ③ 恰一个出口（缺省/空＝缺；多于一个＝未作选择）
  const declared = input.dispositions ?? []
  if (declared.length === 0) {
    return rejected(
      'gap-exit-missing',
      `${label}：处置出口缺失——缺能力/退化/成本失控不得默认继续，必须恰选五出口之一（02 §五；05 §五；17 §4.1 NEG-RING-03）`,
    )
  }
  if (declared.length > 1) {
    const rawExits = declared.map((claim) => String(claim.exit)).join('、')
    return rejected(
      'gap-exit-multiple',
      `${label}：处置出口多于一个（${declared.length} 个：${rawExits}）——单次决策只认一个主处置出口，并列即未作选择`,
    )
  }
  const claim = declared[0]!
  const exitClaim = normalizeClaim(claim.exit)

  // ④ 出口封闭集（「继续原路径/接受风险」不是出口）
  if (!isGapExit(exitClaim)) {
    const raw = String(claim.exit)
    if (CONTINUATION_SET.has(exitClaim)) {
      return rejected(
        'gap-exit-not-closed',
        `${label}：处置「${raw}」不是出口——不得以「继续原路径/接受风险」代替出口；未处置即不得继续（02 §五：不得虚构能力、降低验收口径、静默退化）`,
        'rejected_forbidden',
      )
    }
    return rejected(
      'gap-exit-not-closed',
      `${label}：处置「${raw}」不在五出口封闭集内（${CAPABILITY_GAP_EXITS.join('|')}）——02 §五 处置阶梯：缩/换/外援/拒绝/停止`,
    )
  }
  const exit = exitClaim

  // ⑤ 出口三件（理由／授权引用／影响）
  const reason = readRef(claim.reason)
  if (reason === undefined) {
    return rejected(
      'gap-exit-reason-missing',
      `出口「${exit}」缺理由——处置须带理由（02 §五 能力缺失；v2/04 §二 拒绝须附理由）`,
    )
  }
  const authorityRef = readRef(claim.authorityRef)
  if (authorityRef === undefined) {
    return rejected(
      'gap-exit-authority-missing',
      `出口「${exit}」缺授权引用——处置须带授权引用（外部能力按 v2/03 授权且不转移责任；02 §五）`,
    )
  }
  const exitImpactRef = readRef(claim.impactRef)
  if (exitImpactRef === undefined) {
    return rejected(
      'gap-exit-impact-missing',
      `出口「${exit}」缺影响说明——处置须带影响（02 §五：影响什么不得空转）`,
    )
  }

  // ⑥ 四答后两项：可不答，但不得默认视为已答
  const durationRef = readRef(declaration.durationRef)
  const providedAlternatives = declaration.alternativeRefs
  const alternativeRefs = (providedAlternatives ?? []).filter((ref) => readRef(ref) !== undefined)
  const alternativesAnswered =
    providedAlternatives !== undefined && (providedAlternatives.length === 0 || alternativeRefs.length > 0)
  const missingAnswers: CapabilityGapAnswer[] = []
  if (durationRef === undefined) missingAnswers.push('duration')
  if (!alternativesAnswered) missingAnswers.push('alternative')

  const facts: CapabilityGapFacts = {
    gapRef,
    kind,
    capabilityRef,
    impactRef: gapImpactRef,
    ...(durationRef === undefined ? {} : { durationRef }),
    alternativeRefs,
  }
  return {
    kind: 'ok',
    value: {
      declaration: facts,
      disposition: { exit, reason, authorityRef, impactRef: exitImpactRef },
      missingAnswers,
    },
  }
}
