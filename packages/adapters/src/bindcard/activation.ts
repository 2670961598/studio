/**
 * bindcard/activation —— 激活代次＋围栏（绑定档案的激活链；IMPL-07-05）
 *
 * 依据：
 *   - v2/05 §三 通则 2/3：无互认围栏时只允许独占交接；权威切换走「权威需求—候选端点—
 *     激活决定」三段，部署只供候选，激活是公司有权位置的决定记录（不是部署配置）。
 *     **围栏与激活代次机制建成＝目标（未证）**——本件只交可测可复算的**规则内核**，
 *     不宣称已具备跨进程/跨库强制（落账与强制点归 daemon 各单）。
 *   - v2/09 TERM-35/TERM-36：围栏（fencing）≠隔离≠激活代次；**两轴不得共用字段、
 *     不得互推、不得互替**。本件据此把两轴拆成两个字段与两个独立校验：
 *     `generation`（治理序号）与 `fence.epoch`（技术围栏纪元）——两轴都须当前，
 *     任一落后即拒；**不得**用代次合法推围栏合法（或反之）。
 *   - v2/11 §二 REC-AUTH-07 权威激活：幂等键＝（事实域×目标端点×新代次）；
 *     回退＝新决定＋新代次；竞争代次/停写不明→保持冻结交终裁位置，不得单方宣布。
 *     本件对应：`domain='DOM-06'`（v2/05 §三 能力包/部署绑定）、端点＝卡 ID、
 *     代次＝generation；同（卡,代次,围栏,决定）重放＝幂等，同代次异内容＝冲突拒收。
 *   - v2/12 §2.4/§1.6 迁移与换代：换宿主＝新档案+能力重认；旧代次围栏后不得再驱动派发。
 *   - plan/05 IMPL-07-05（激活代次＋围栏）；plan/02 §五-8 接口耦合（不改 daemon）。
 *
 * 纪律：
 *   - 纯函数、零时钟：时间由调用方以字符串字段携带（本模块不读 Date.now，便于复算）；
 *     账本不可变（每次激活返回**新**账本，旧账本对象不被改写）。
 *   - 具名决定：decidedBy 必须是具名位置/人（v2/11 生产者字段）；「系统/框架/daemon/匿名」
 *     一类无主署名在构造期拒收——代次是治理序号，不是运行时计数器。
 *   - 存储与分发：本模块不写库、不发事件；REC-AUTH-07 落账与围栏强制点归 daemon
 *     （GAP-V2-04 未建前的代偿面只在**规则层**，不冒充机制保证）。
 */
import type { ClassifiedError, Result } from '@studio-next/contract'
import type { BindingCard } from './types.ts'
import { configErr, okResult } from './types.ts'
import { loadBindingCard } from './card.ts'

/** 激活事实域（v2/05 §三 DOM-06：能力包、部署绑定——独立工件，唯一写入者＝部署责任者） */
export const ACTIVATION_DOMAIN = 'DOM-06'

/** 无主署名（v2/11 具名生产者纪律：这类值不得作为决定人） */
export const ANONYMOUS_DECIDERS: readonly string[] = Object.freeze([
  '系统',
  '框架',
  '框架系统',
  'daemon',
  'system',
  'anonymous',
  '匿名',
  '',
])

/** 激活请求（决定记录输入；generation 与 fenceEpoch 两轴分别给） */
export interface BindingActivationRequest {
  /** 目标端点＝绑定卡 ID（本包只承载执行宿主卡） */
  readonly cardId: string
  /** 宿主版本（须等于卡钉住版本；换宿主＝新档案） */
  readonly hostVersion: string
  /** 治理序号（v2/09 TERM-36；回退＝新决定＋新代次，不得复用） */
  readonly generation: number
  /** 技术围栏纪元（v2/09 TERM-35；与代次不同轴、不得互推） */
  readonly fenceEpoch: number
  /** 具名决定位置（v2/03 治理位置表；不得写「系统」） */
  readonly decidedBy: string
  /** 决定依据（不得空） */
  readonly reason: string
  /** 决定时刻（ISO 字符串；由调用方给，本模块不读时钟——可为 undefined＝未记录） */
  readonly decidedAt?: string
}

/** 激活记录（REC-AUTH-07 的规则层投影；记录形状归 v2/11，本件不另立记录族） */
export interface BindingActivation {
  /** 激活标识＝幂等键的可读形：domain|端点|代次 */
  readonly activationId: string
  readonly domain: 'DOM-06'
  readonly cardId: string
  readonly cardVersion: string
  readonly hostVersion: string
  readonly generation: number
  /** 围栏轴（独立字段；token 不含代次——两轴不得共用字段） */
  readonly fence: { readonly epoch: number; readonly token: string }
  /** 代次轴 token（不含围栏纪元） */
  readonly generationToken: string
  readonly decision: { readonly decidedBy: string; readonly reason: string; readonly decidedAt?: string }
  /** 被本次取代的前一代 activationId（首代 null） */
  readonly supersedes: string | null
  readonly state: 'active' | 'superseded'
}

/** 激活账本（不可变；一次激活返回新账本） */
export interface ActivationLedger {
  readonly activations: readonly BindingActivation[]
}

/** 空账本（首代激活的起点） */
export const EMPTY_ACTIVATION_LEDGER: ActivationLedger = Object.freeze({
  activations: Object.freeze([]) as readonly BindingActivation[],
})

/** 代次 token（不含围栏纪元——两轴不共用字段） */
export function generationTokenOf(cardId: string, hostVersion: string, generation: number): string {
  return `${cardId}@${hostVersion}#gen-${String(generation)}`
}

/** 围栏 token（不含代次——两轴不共用字段） */
export function fenceTokenOf(cardId: string, hostVersion: string, fenceEpoch: number): string {
  return `${cardId}@${hostVersion}#fence-${String(fenceEpoch)}`
}

/** 激活标识（幂等键可读形：事实域×目标端点×新代次） */
export function activationIdOf(cardId: string, generation: number): string {
  return `${ACTIVATION_DOMAIN}|${cardId}|g${String(generation)}`
}

/** 某卡的当前激活（state=active；无则 undefined） */
export function activeActivation(ledger: ActivationLedger, cardId: string): BindingActivation | undefined {
  let found: BindingActivation | undefined
  for (const a of ledger.activations) {
    if (a.cardId !== cardId || a.state !== 'active') continue
    found = a
  }
  return found
}

/** 某卡的激活链（按账本序；含已取代代） */
export function activationChain(ledger: ActivationLedger, cardId: string): readonly BindingActivation[] {
  return Object.freeze(ledger.activations.filter((a) => a.cardId === cardId))
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1
}

/**
 * 激活（一次决定＝一代）：
 *   - 卡未知/卡不合法/宿主版本不符 → loadBindingCard 的拒收原样透出；
 *   - 代次/围栏纪元非正整数 → bindcard/generation-invalid / bindcard/fence-invalid；
 *   - 决定人无主 → bindcard/decision-anonymous（具名纪律）；理由空 → bindcard/decision-incomplete；
 *   - 同（卡,代次,围栏纪元,决定人,理由）重放 → **幂等**（返回原账本与原记录，不新增）；
 *   - 代次落后 → bindcard/generation-stale；同代次异内容 → bindcard/generation-conflict；
 *   - 代次前进但围栏纪元不前进 → bindcard/fence-stale（两轴不得互推）。
 */
export function activateBinding(
  ledger: ActivationLedger,
  req: BindingActivationRequest,
): Result<{ readonly ledger: ActivationLedger; readonly activation: BindingActivation }, ClassifiedError> {
  const loaded = loadBindingCard(req.cardId, req.hostVersion)
  if (loaded.kind === 'err') return loaded
  const card = loaded.value
  if (!isPositiveInt(req.generation)) {
    return configErr(
      'bindcard/generation-invalid',
      `激活代次须为正整数（收到 ${JSON.stringify(req.generation)}）——代次是治理序号，不是任意计数器`,
    )
  }
  if (!isPositiveInt(req.fenceEpoch)) {
    return configErr(
      'bindcard/fence-invalid',
      `围栏纪元须为正整数（收到 ${JSON.stringify(req.fenceEpoch)}）——围栏与代次不同轴，各自单调`,
    )
  }
  const decidedBy = req.decidedBy.trim()
  if (ANONYMOUS_DECIDERS.includes(decidedBy.toLowerCase()) || ANONYMOUS_DECIDERS.includes(decidedBy)) {
    return configErr(
      'bindcard/decision-anonymous',
      `激活决定人无主（${JSON.stringify(req.decidedBy)}）：须为具名治理位置/决定记录（v2/03 治理位置表；v2/11 具名生产者）——「系统/框架/daemon」不是决定人`,
    )
  }
  if (req.reason.trim() === '') {
    return configErr('bindcard/decision-incomplete', '激活决定缺依据（reason 空）：无理由的代次切换不可审计')
  }

  const current = activeActivation(ledger, req.cardId)
  if (current !== undefined) {
    const sameReplay =
      current.generation === req.generation &&
      current.fence.epoch === req.fenceEpoch &&
      current.decision.decidedBy === decidedBy &&
      current.decision.reason === req.reason
    if (sameReplay) return okResult({ ledger, activation: current })
    if (req.generation < current.generation) {
      return configErr(
        'bindcard/generation-stale',
        `${req.cardId} 当前代次 ${String(current.generation)}，收到 ${String(req.generation)}——回退＝新决定＋新代次（不得复用旧代次，v2/05 §三通则 3）`,
      )
    }
    if (req.generation === current.generation) {
      return configErr(
        'bindcard/generation-conflict',
        `${req.cardId} 代次 ${String(req.generation)} 已有不同决定（竞争代次）——保持冻结并交终裁位置，不得单方宣布（v2/11 REC-AUTH-07）`,
      )
    }
    if (req.fenceEpoch <= current.fence.epoch) {
      return configErr(
        'bindcard/fence-stale',
        `${req.cardId} 围栏纪元当前 ${String(current.fence.epoch)}，收到 ${String(req.fenceEpoch)}——代次前进不自动抬围栏（两轴不得互推，v2/09 TERM-35）`,
      )
    }
  }

  const activation: BindingActivation = Object.freeze({
    activationId: activationIdOf(req.cardId, req.generation),
    domain: ACTIVATION_DOMAIN,
    cardId: card.cardId,
    cardVersion: card.cardVersion,
    hostVersion: card.host.version,
    generation: req.generation,
    fence: Object.freeze({
      epoch: req.fenceEpoch,
      token: fenceTokenOf(card.cardId, card.host.version, req.fenceEpoch),
    }),
    generationToken: generationTokenOf(card.cardId, card.host.version, req.generation),
    decision: Object.freeze({
      decidedBy,
      reason: req.reason,
      ...(req.decidedAt !== undefined ? { decidedAt: req.decidedAt } : {}),
    }),
    supersedes: current === undefined ? null : current.activationId,
    state: 'active',
  })
  const next: BindingActivation[] = ledger.activations.map((a) =>
    a.activationId === activation.supersedes
      ? Object.freeze({ ...a, state: 'superseded' as const })
      : a,
  )
  next.push(activation)
  return okResult({ ledger: Object.freeze({ activations: Object.freeze(next) }), activation })
}

/** 派发/装载时携带的激活证明（两轴各自给；本件不构造证明，只校验） */
export interface ActivationProof {
  readonly cardId: string
  readonly hostVersion: string
  readonly generation: number
  readonly fenceEpoch: number
}

/**
 * 围栏校验（派发/装载前的**唯一**放行点；两轴独立校验、缺一不可）：
 *   - 无当前激活 → bindcard/not-activated（未激活不得驱动派发）；
 *   - 宿主版本不符 → bindcard/host-mismatch（旧卡不加载）；
 *   - generation 落后/超前 → bindcard/generation-stale / -ahead；
 *   - fenceEpoch 落后/超前 → bindcard/fence-stale / -ahead。
 * 注意：本函数不判授权（绑定不是授权）；通过≠有权出工，权与禁配另判 v2/03/04。
 */
export function guardActivation(
  ledger: ActivationLedger,
  proof: ActivationProof,
): Result<BindingActivation, ClassifiedError> {
  const current = activeActivation(ledger, proof.cardId)
  if (current === undefined) {
    return configErr(
      'bindcard/not-activated',
      `${proof.cardId} 无当前激活：未激活的绑定卡不得驱动派发（激活＝公司有权位置的决定记录，不是部署配置）`,
    )
  }
  if (proof.hostVersion !== current.hostVersion) {
    return configErr(
      'bindcard/host-mismatch',
      `${proof.cardId} 当前激活钉住宿主 ${JSON.stringify(current.hostVersion)}，证明携带 ${JSON.stringify(proof.hostVersion)}——版本不符＝弃用（换宿主＝新档案）`,
    )
  }
  if (!isPositiveInt(proof.generation)) {
    return configErr('bindcard/generation-invalid', `证明代次须为正整数（收到 ${JSON.stringify(proof.generation)}）`)
  }
  if (!isPositiveInt(proof.fenceEpoch)) {
    return configErr('bindcard/fence-invalid', `证明围栏纪元须为正整数（收到 ${JSON.stringify(proof.fenceEpoch)}）`)
  }
  if (proof.generation !== current.generation) {
    return proof.generation < current.generation
      ? configErr(
          'bindcard/generation-stale',
          `${proof.cardId} 代次 ${String(proof.generation)} 已过期（当前 ${String(current.generation)}）——旧代次围栏后不得再驱动派发`,
        )
      : configErr(
          'bindcard/generation-ahead',
          `${proof.cardId} 代次 ${String(proof.generation)} 超前于当前 ${String(current.generation)}——未来代次不受理（不得越序自封）`,
        )
  }
  if (proof.fenceEpoch !== current.fence.epoch) {
    return proof.fenceEpoch < current.fence.epoch
      ? configErr(
          'bindcard/fence-stale',
          `${proof.cardId} 围栏纪元 ${String(proof.fenceEpoch)} 已过期（当前 ${String(current.fence.epoch)}）——围栏与代次两轴独立，代次当前不代表围栏当前`,
        )
      : configErr(
          'bindcard/fence-ahead',
          `${proof.cardId} 围栏纪元 ${String(proof.fenceEpoch)} 超前于当前 ${String(current.fence.epoch)}——围栏纪元不得自封`,
        )
  }
  return okResult(current)
}

/** 装载「已激活的卡」：围栏校验通过后返回卡本体＋当前激活（本包对外的装载入口） */
export function loadActiveBindingCard(
  ledger: ActivationLedger,
  proof: ActivationProof,
): Result<{ readonly card: BindingCard; readonly activation: BindingActivation }, ClassifiedError> {
  const guarded = guardActivation(ledger, proof)
  if (guarded.kind === 'err') return guarded
  const loaded = loadBindingCard(guarded.value.cardId, guarded.value.hostVersion)
  if (loaded.kind === 'err') return loaded
  return okResult({ card: loaded.value, activation: guarded.value })
}
