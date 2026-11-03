/**
 * authority-gate —— 授权链五函数接入 daemon 授权面（core/authority.ts 的生产接线件）
 *
 * 依据（实现单引用）：
 *   - docs/17-§2 主循环七相位：派发期建单/迁移、收割期评论/KB、合并期迁移等对平台的一切写入
 *     都经 `engine/tools/gated-platform.ts` 收口；本闸插在该写路径第一步（授权判定→wkey 鉴权）。
 *   - docs/17-§6 收割四要件：判定必须留痕——每次放行/拒绝/影子未覆盖都产出一条带 evidenceId
 *     的结构化证据，拒绝不得以「无记录」收场（对账面可复算）。
 *   - docs/v2/05 §四 PORT-AUTH：拒代批、拒 token 当权源、**持 operating root key 不自动构成
 *     授权判定**——授权仍须按链核验。
 *   - docs/v2/14 §1.2 PORT-AUTH.verify/withdraw：REC-CMD-02 政策四态（permitted/reserved/
 *     prohibited/uncovered 不合并）；REC-AUTH-03 后代枚举＋停用证据＋无后代显式确认。
 *   - packages/contract/src/ports/auth.ts：PolicyVerdict/ExerciseClaim/WithdrawRequest 形状。
 *   - packages/core/src/authority.ts：五函数纯判定（本件不复制规则，只做接线与形状收窄）。
 *
 * 边界与纪律：
 *   - **零 IO**：授予链快照、时钟、证据落点全部注入；不读文件/网络/环境，不读真实时钟。
 *   - **不改契约面**：不新增动作词、不改 GATEWAY_ACTIONS/ports；ctl- 六动词取 gateway 词表
 *     现值域（SEC-SIG-03），生产入口切换（差距 #19）另行单，本件映射先行覆盖。
 *   - **不代行授权**：只判定「主张的授予链是否覆盖本次动作」；授予签发自外部老板/有权位置
 *     （root_delegation 生产者=差距 #4，不属本单，不伪造）。
 *   - **准入策略**（真机不回归硬约束）：授予记录生产者当前为 0，存量控制面写没有授权主张可带。
 *     故：有主张 → 强制核验（fail-closed：非 permitted 一律拒）；无主张 → 默认影子观测
 *     （mode=shadow、state=uncovered，放行但如实留痕），`requireClaim: true` 可一键硬切为拒绝。
 *     详见 deliverables/plan.md §四。
 */
import {
  canonicalizeJson,
  checkWithdrawalCompleteness,
  descendantGrants,
  isEffectivelyWithdrawn,
  rootDelegationFailure,
  sha256Hex,
  verifyGrantChain,
} from '@studio-next/core'
import type {
  AuthorityRefusal,
  ExerciseClaimInput,
  GrantLink,
  OnBehalfOf,
  PolicyState,
  WithdrawalCheck,
  WithdrawalRequestInput,
} from '@studio-next/core'
import type { GatewayActionWord } from '@studio-next/gateway'

// ─────────────────────────────────────────────────────────────────────────────
// 一、动作词 → 判定函数映射（冻结表；deliverables/plan.md §三 的机器可读形态）
// ─────────────────────────────────────────────────────────────────────────────

/** 本件消费的判定函数（五个里的三个构成 verify 侧；撤回侧见 `AUTHORITY_WITHDRAW_FUNCTION`） */
export type AuthorityVerifyFunction = 'verifyGrantChain' | 'rootDelegationFailure' | 'isEffectivelyWithdrawn'

/** 撤回面判定函数（REC-AUTH-03；含后代枚举） */
export const AUTHORITY_WITHDRAW_FUNCTION = 'checkWithdrawalCompleteness' as const

/** 后代枚举函数（withdraw 面单列，供证据回执复用） */
export const AUTHORITY_DESCENDANTS_FUNCTION = 'descendantGrants' as const

export interface AuthorityRoute {
  readonly action: GatewayActionWord
  /** 主判定函数（每动作词恰一个；前置撤回复核另计，见 authorize） */
  readonly decision: AuthorityVerifyFunction
  /** 行使身份（ENU-139；子 agent 不得取 internal_boss） */
  readonly onBehalfOf: OnBehalfOf
  /** 授权范围词（授予 scope 须包含它） */
  readonly scope: string
}

/**
 * 冻结映射（两域各六动词，`Record<GatewayActionWord, …>` 让词表扩张在编译期即红——表需重审）。
 * 读类动词（heartbeat/kb-search/budget-query）只做撤回有效性复核：不新裁范围、只拦「已撤回仍用」。
 */
export const AUTHORITY_ACTION_ROUTES: Readonly<Record<GatewayActionWord, AuthorityRoute>> = {
  // —— worker 面六动词（GATEWAY_ACTIONS，MCP 工具集同一张表）——
  comment: { action: 'comment', decision: 'verifyGrantChain', onBehalfOf: 'self', scope: 'platform.comment' },
  heartbeat: { action: 'heartbeat', decision: 'isEffectivelyWithdrawn', onBehalfOf: 'self', scope: 'platform.heartbeat' },
  article: { action: 'article', decision: 'verifyGrantChain', onBehalfOf: 'self', scope: 'kb.article' },
  'kb-search': { action: 'kb-search', decision: 'isEffectivelyWithdrawn', onBehalfOf: 'self', scope: 'kb.search' },
  'evidence-write': { action: 'evidence-write', decision: 'verifyGrantChain', onBehalfOf: 'self', scope: 'evidence.write' },
  'budget-query': { action: 'budget-query', decision: 'isEffectivelyWithdrawn', onBehalfOf: 'self', scope: 'budget.query' },
  // —— ctl- 面六动词（GATEWAY_CTL_ACTIONS，SEC-SIG-03 / ENU-119）——
  'ctl-create': { action: 'ctl-create', decision: 'verifyGrantChain', onBehalfOf: 'internal_boss', scope: 'platform.create' },
  'ctl-transition': { action: 'ctl-transition', decision: 'verifyGrantChain', onBehalfOf: 'internal_boss', scope: 'platform.transition' },
  'ctl-set-field': { action: 'ctl-set-field', decision: 'verifyGrantChain', onBehalfOf: 'internal_boss', scope: 'platform.set-field' },
  'ctl-link': { action: 'ctl-link', decision: 'verifyGrantChain', onBehalfOf: 'internal_boss', scope: 'platform.link' },
  'ctl-provision': { action: 'ctl-provision', decision: 'rootDelegationFailure', onBehalfOf: 'internal_boss', scope: 'platform.provision' },
  'ctl-guards': { action: 'ctl-guards', decision: 'rootDelegationFailure', onBehalfOf: 'internal_boss', scope: 'platform.guards' },
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、主张、判定与证据形状
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 写调用携带的授权主张（最小面；完整 REC-AUTH-02 记录组装归 store/daemon）。
 * 主张不是事实：本闸只按链核验，回执归端口侧落账。
 */
export interface AuthorityClaim {
  readonly grantId: string
  readonly exercisedBy: string
  /** 以 internal_boss 行使时必须为空（REC-AUTH-02 `withheld_scope` 为空） */
  readonly withheldScope?: readonly string[]
}

/** 拒绝码（gw- 前缀族，与既有 gw-verify-… / gw-action-… 同族；子码语义见 plan §三） */
export type AuthorityRejectReason =
  | 'gw-authority-claim-invalid'
  | 'gw-authority-required'
  | 'gw-authority-uncovered'
  | 'gw-authority-prohibited'
  | 'gw-authority-reserved'
  | 'gw-authority-withdrawn'
  | 'gw-authority-withdraw-incomplete'
  | 'gw-authority-evidence-failed'

/** 判定模式：enforce=有主张强制核验；shadow=无主张影子观测（不阻断存量写） */
export type AuthorityMode = 'enforce' | 'shadow'

/** 证据记录（结构化、无密钥；evidenceId 由内容规范化摘要派生，可复算） */
export interface AuthorityEvidence {
  readonly evidenceId: string
  readonly atMs: number
  readonly ticket: string
  readonly action: string
  readonly mode: AuthorityMode
  readonly state: PolicyState
  readonly chain: readonly string[]
  readonly refusals: readonly AuthorityRefusal[]
  readonly grantId?: string
  readonly exercisedBy?: string
  readonly detail?: string
}

/** 证据落点（生产=daemon 日志/后续台账；测试=捕获数组）。抛出=拒绝（无留痕不放行） */
export type AuthorityEvidenceSink = (evidence: AuthorityEvidence) => void

export interface AuthorityAuthorizeInput {
  readonly action: GatewayActionWord
  /** 写调用实参；授权主张从 `args.authority` 读取（严格形状，坏形状=拒） */
  readonly args: Record<string, unknown>
  readonly ticket: string
}

export interface AuthorityDecision {
  readonly allowed: boolean
  readonly state: PolicyState
  readonly mode: AuthorityMode
  readonly chain: readonly string[]
  readonly refusals: readonly AuthorityRefusal[]
  readonly evidenceId: string
  readonly reason?: AuthorityRejectReason
  readonly detail?: string
}

export interface AuthorityWithdrawDecision {
  readonly allowed: boolean
  readonly state: PolicyState
  readonly check: WithdrawalCheck | null
  readonly descendants: readonly string[]
  readonly alreadyWithdrawn: boolean
  readonly evidenceId: string
  readonly reason?: AuthorityRejectReason
}

export interface AuthorityGate {
  authorize(input: AuthorityAuthorizeInput): AuthorityDecision
  withdraw(request: WithdrawalRequestInput): AuthorityWithdrawDecision
  descendants(rootGrantId: string): readonly string[]
}

export interface AuthorityGateOptions {
  /** 授予链快照供给（零 IO 边界：装载归调用方；本件不缓存、不写回） */
  readonly grants: () => readonly GrantLink[]
  /** epoch ms 时钟（注入以求确定性） */
  readonly now: () => number
  readonly record: AuthorityEvidenceSink
  /** true=无主张也拒（授予记录生产者落地后硬切）；缺省 false=无主张影子观测 */
  readonly requireClaim?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// 三、形状收窄与证据构造
// ─────────────────────────────────────────────────────────────────────────────

type ClaimParse =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly claim: AuthorityClaim }
  | { readonly kind: 'invalid'; readonly why: string }

const CLAIM_KEYS = new Set(['grantId', 'exercisedBy', 'withheldScope'])

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 严格解析 `args.authority`：未知键/空串/坏类型一律 invalid（fail-closed，不猜不修复） */
function parseClaim(args: Record<string, unknown>): ClaimParse {
  const raw = args['authority']
  if (raw === undefined || raw === null) return { kind: 'none' }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'invalid', why: 'authority 须为对象' }
  const bag = raw as Record<string, unknown>
  for (const key of Object.keys(bag)) {
    if (!CLAIM_KEYS.has(key)) return { kind: 'invalid', why: `authority 未知键 ${key}` }
  }
  const grantId = textOf(bag['grantId'])
  if (grantId === '') return { kind: 'invalid', why: 'authority.grantId 缺失' }
  const exercisedBy = textOf(bag['exercisedBy'])
  if (exercisedBy === '') return { kind: 'invalid', why: 'authority.exercisedBy 缺失' }
  const withheldRaw = bag['withheldScope']
  if (withheldRaw === undefined) return { kind: 'ok', claim: { grantId, exercisedBy } }
  if (!Array.isArray(withheldRaw)) return { kind: 'invalid', why: 'authority.withheldScope 须为数组' }
  const withheldScope: string[] = []
  for (const item of withheldRaw) {
    const scope = textOf(item)
    if (scope === '') return { kind: 'invalid', why: 'authority.withheldScope 含空白项' }
    withheldScope.push(scope)
  }
  return { kind: 'ok', claim: { grantId, exercisedBy, withheldScope } }
}

/** evidenceId＝规范化内容的 SHA-256 前 16 位（同判定同 id；可复算、不含密钥） */
function evidenceIdOf(seed: unknown): string {
  const canonical = canonicalizeJson(seed)
  const text = canonical.ok ? canonical.value : JSON.stringify(seed)
  return `AUTH-${sha256Hex(text).slice(0, 16)}`
}

function refusalOf(kind: AuthorityRefusal['kind'], grantId: string, detail: string): AuthorityRefusal {
  return { kind, grantId, detail }
}

function refusalChain(refusals: readonly AuthorityRefusal[]): string {
  return refusals.map((item) => item.kind).join(',')
}

/**
 * 统一出口：先构造并落证据，再返回判定。证据落点抛错＝拒绝（fail-closed；
 * 无留痕不放行——17-§6 收割四要件对「拒绝必须有据」的落地）。
 */
function decide(
  record: AuthorityEvidenceSink,
  base: {
    readonly atMs: number
    readonly ticket: string
    readonly action: string
    readonly mode: AuthorityMode
    readonly state: PolicyState
    readonly chain: readonly string[]
    readonly refusals: readonly AuthorityRefusal[]
    readonly grantId?: string
    readonly exercisedBy?: string
    readonly detail?: string
  },
  verdict: { readonly allowed: boolean; readonly reason?: AuthorityRejectReason },
): AuthorityDecision {
  const evidenceId = evidenceIdOf({
    ticket: base.ticket,
    action: base.action,
    atMs: base.atMs,
    state: base.state,
    chain: base.chain,
    refusals: base.refusals,
    ...(base.grantId !== undefined ? { grantId: base.grantId } : {}),
  })
  const evidence: AuthorityEvidence = {
    evidenceId,
    atMs: base.atMs,
    ticket: base.ticket,
    action: base.action,
    mode: base.mode,
    state: base.state,
    chain: base.chain,
    refusals: base.refusals,
    ...(base.grantId !== undefined ? { grantId: base.grantId } : {}),
    ...(base.exercisedBy !== undefined ? { exercisedBy: base.exercisedBy } : {}),
    ...(base.detail !== undefined ? { detail: base.detail } : {}),
  }
  try {
    record(evidence)
  } catch {
    return {
      allowed: false,
      state: 'uncovered',
      mode: base.mode,
      chain: base.chain,
      refusals: base.refusals,
      evidenceId,
      reason: 'gw-authority-evidence-failed',
      detail: '证据落点异常：无留痕不放行（fail-closed）',
    }
  }
  return {
    allowed: verdict.allowed,
    state: base.state,
    mode: base.mode,
    chain: base.chain,
    refusals: base.refusals,
    evidenceId,
    ...(verdict.reason !== undefined ? { reason: verdict.reason } : {}),
    ...(base.detail !== undefined ? { detail: base.detail } : {}),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 四、闸体
// ─────────────────────────────────────────────────────────────────────────────

/** 建授权链闸（一次装配一实例；零内部状态，全依赖注入） */
export function createAuthorityGate(options: AuthorityGateOptions): AuthorityGate {
  const requireClaim = options.requireClaim === true

  function deny(
    input: AuthorityAuthorizeInput,
    mode: AuthorityMode,
    state: PolicyState,
    reason: AuthorityRejectReason,
    detail: string,
    chain: readonly string[] = [],
    refusals: readonly AuthorityRefusal[] = [],
    claim?: AuthorityClaim,
  ): AuthorityDecision {
    return decide(
      options.record,
      {
        atMs: options.now(),
        ticket: input.ticket,
        action: input.action,
        mode,
        state,
        chain,
        refusals,
        ...(claim !== undefined ? { grantId: claim.grantId, exercisedBy: claim.exercisedBy } : {}),
        detail,
      },
      { allowed: false, reason },
    )
  }

  return {
    authorize(input: AuthorityAuthorizeInput): AuthorityDecision {
      const mode: AuthorityMode = requireClaim ? 'enforce' : 'shadow'
      const atMs = options.now()
      const parsed = parseClaim(input.args)
      // ① 主张形状坏＝直接拒（声明了授权却坏了，不降级为影子）
      if (parsed.kind === 'invalid') {
        return deny(input, 'enforce', 'prohibited', 'gw-authority-claim-invalid', parsed.why)
      }
      // ② 无主张：影子放行（留痕）或硬切拒绝
      if (parsed.kind === 'none') {
        if (mode === 'enforce') {
          return deny(input, 'enforce', 'uncovered', 'gw-authority-required', '无授权主张（requireClaim=true fail-closed）')
        }
        return decide(
          options.record,
          {
            atMs,
            ticket: input.ticket,
            action: input.action,
            mode: 'shadow',
            state: 'uncovered',
            chain: [],
            refusals: [],
            detail: '无授权主张：影子观测（授予记录生产者未建，不阻断存量写）',
          },
          { allowed: true },
        )
      }
      const claim = parsed.claim
      const grants = options.grants()
      const route = (AUTHORITY_ACTION_ROUTES as Readonly<Record<string, AuthorityRoute | undefined>>)[input.action]
      if (route === undefined) {
        return deny(input, 'enforce', 'prohibited', 'gw-authority-claim-invalid', `动作词无授权路由（${input.action}）`, [], [], claim)
      }
      // ③ 统一前置撤回有效性：自身或任一代祖先已撤回＝链不可再用
      if (isEffectivelyWithdrawn(grants, claim.grantId)) {
        return deny(
          input,
          'enforce',
          'prohibited',
          'gw-authority-withdrawn',
          `授予 ${claim.grantId} 自身或祖先已撤回`,
          [claim.grantId],
          [refusalOf('grant-withdrawn', claim.grantId, 'effective withdrawal')],
          claim,
        )
      }
      // ④ 按映射表分派
      if (route.decision === 'verifyGrantChain') {
        const exercise: ExerciseClaimInput = {
          grantId: claim.grantId,
          exercisedBy: claim.exercisedBy,
          action: route.scope,
          scope: [route.scope],
          onBehalfOf: route.onBehalfOf,
          atMs,
          ...(claim.withheldScope !== undefined ? { withheldScope: claim.withheldScope } : {}),
        }
        const verdict = verifyGrantChain({ grants, claim: exercise })
        if (verdict.state === 'permitted') {
          return decide(
            options.record,
            {
              atMs,
              ticket: input.ticket,
              action: input.action,
              mode: 'enforce',
              state: 'permitted',
              chain: verdict.chain,
              refusals: verdict.refusals,
              grantId: claim.grantId,
              exercisedBy: claim.exercisedBy,
              detail: `授权链通过（${route.decision}）`,
            },
            { allowed: true },
          )
        }
        const reason: AuthorityRejectReason =
          verdict.state === 'reserved'
            ? 'gw-authority-reserved'
            : verdict.state === 'uncovered'
              ? 'gw-authority-uncovered'
              : 'gw-authority-prohibited'
        return deny(
          input,
          'enforce',
          verdict.state,
          reason,
          `授权链判定 ${verdict.state}：${refusalChain(verdict.refusals)}`,
          verdict.chain,
          verdict.refusals,
          claim,
        )
      }
      if (route.decision === 'rootDelegationFailure') {
        const root = grants.find((grant) => grant.grantId === claim.grantId)
        if (root === undefined) {
          return deny(input, 'enforce', 'uncovered', 'gw-authority-uncovered', `根授予 ${claim.grantId} 不存在`, [claim.grantId], [refusalOf('grant-not-found', claim.grantId, 'no such grant')], claim)
        }
        if (root.grantee !== claim.exercisedBy) {
          return deny(
            input,
            'enforce',
            'prohibited',
            'gw-authority-prohibited',
            'internal_boss 只能由根被授予者本人行使（REC-AUTH-02）',
            [root.grantId],
            [refusalOf('on-behalf-of-forbidden', root.grantId, `grantee=${root.grantee}`)],
            claim,
          )
        }
        if ((root.reservedScopes ?? []).includes(route.scope)) {
          return deny(input, 'enforce', 'reserved', 'gw-authority-reserved', `范围 ${route.scope} 属保留区（ENU-31：须指定位置决定）`, [root.grantId], [], claim)
        }
        const failure = rootDelegationFailure(root)
        if (failure !== null) {
          return deny(input, 'enforce', 'prohibited', 'gw-authority-prohibited', `根授予证明不成立：${failure.kind}`, [root.grantId], [failure], claim)
        }
        return decide(
          options.record,
          {
            atMs,
            ticket: input.ticket,
            action: input.action,
            mode: 'enforce',
            state: 'permitted',
            chain: [root.grantId],
            refusals: [],
            grantId: claim.grantId,
            exercisedBy: claim.exercisedBy,
            detail: `根授予证明通过（${route.decision}）`,
          },
          { allowed: true },
        )
      }
      // isEffectivelyWithdrawn：前置已核，未撤回即放行（读类动作不新裁范围）
      return decide(
        options.record,
        {
          atMs,
          ticket: input.ticket,
          action: input.action,
          mode: 'enforce',
          state: 'permitted',
          chain: [claim.grantId],
          refusals: [],
          grantId: claim.grantId,
          exercisedBy: claim.exercisedBy,
          detail: `撤回有效性通过（${route.decision}）`,
        },
        { allowed: true },
      )
    },

    withdraw(request: WithdrawalRequestInput): AuthorityWithdrawDecision {
      const atMs = options.now()
      const grants = options.grants()
      const root = grants.find((grant) => grant.grantId === request.rootGrantId)
      const descendants = descendantGrants(grants, request.rootGrantId)
      const alreadyWithdrawn = isEffectivelyWithdrawn(grants, request.rootGrantId)
      if (root === undefined) {
        const evidenceId = evidenceIdOf({ action: 'withdraw', atMs, rootGrantId: request.rootGrantId, state: 'uncovered' })
        try {
          options.record({
            evidenceId,
            atMs,
            ticket: '',
            action: 'withdraw',
            mode: 'enforce',
            state: 'uncovered',
            chain: [],
            refusals: [refusalOf('grant-not-found', request.rootGrantId, 'no such grant')],
            grantId: request.rootGrantId,
            detail: '撤回目标根授予不存在',
          })
        } catch {
          return { allowed: false, state: 'uncovered', check: null, descendants, alreadyWithdrawn, evidenceId, reason: 'gw-authority-evidence-failed' }
        }
        return { allowed: false, state: 'uncovered', check: null, descendants, alreadyWithdrawn, evidenceId, reason: 'gw-authority-uncovered' }
      }
      const check = checkWithdrawalCompleteness({ grants, request })
      const evidenceId = evidenceIdOf({
        action: 'withdraw',
        atMs,
        rootGrantId: request.rootGrantId,
        complete: check.complete,
        findings: check.findings,
      })
      try {
        options.record({
          evidenceId,
          atMs,
          ticket: '',
          action: 'withdraw',
          mode: 'enforce',
          state: check.complete ? 'permitted' : 'prohibited',
          chain: [request.rootGrantId],
          refusals: [],
          grantId: request.rootGrantId,
          detail: check.complete ? '撤回完整性通过（checkWithdrawalCompleteness）' : `撤回未结清：${check.findings.join(';')}`,
        })
      } catch {
        return { allowed: false, state: 'prohibited', check, descendants, alreadyWithdrawn, evidenceId, reason: 'gw-authority-evidence-failed' }
      }
      return {
        allowed: check.complete,
        state: check.complete ? 'permitted' : 'prohibited',
        check,
        descendants,
        alreadyWithdrawn,
        evidenceId,
        ...(check.complete ? {} : { reason: 'gw-authority-withdraw-incomplete' as const }),
      }
    },

    descendants(rootGrantId: string): readonly string[] {
      return descendantGrants(options.grants(), rootGrantId)
    },
  }
}
