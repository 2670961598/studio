/**
 * authority —— 授权链纯判定（父范围包含、root_delegation 范围/期限、行 root 身份、撤回后代）
 *
 * 依据（MIG-03 / IMPL-03-07；G-PORT-AUTH/G-PORT-DEF 判定面）：
 *   - v2/14 §1.2 PORT-AUTH 判定面（verify：REC-CMD-02 政策四态；withdraw：REC-AUTH-03
 *     `descendants[]`＋`deactivation_evidence`＋无后代显式确认；「持 operating root key
 *     不自动构成授权判定」——root key 只证明「以内部老板身份签发」，授权仍须按链核验）；
 *   - v2/11 §REC-AUTH-01（授予/转授边：授权者/被授权者/父授予/grant_class/purpose/scope/
 *     conditions/term/delegable；**根授予的 grantor 恒为外部老板**；不变量：子授权不得
 *     超出父授权目的/范围/条件/期限——I-6「授权不放大且撤回必结清」；无法判定包含关系
 *     不得视为已授权）、REC-AUTH-02（行使：`on_behalf_of`＝ENU-139，子 agent 不得取
 *     `internal_boss`；root_use 为真时必引 root_delegation）、REC-AUTH-03（撤回：后代枚举、
 *     停用证据、无后代显式确认、轮换须 successor_grant；后代未全停不得记完成）；
 *   - v2/09 ENU-31（政策四态，判定顺序 prohibited→reserved→permitted→uncovered＝deny）、
 *     ENU-137（grant_class）、ENU-138（证明模式：root_delegation 恒 `ritual_and_key`）、
 *     ENU-139（on_behalf_of）、ENU-130（停用证据三选一）；
 *   - v2/03 §3.1（根链：root_delegation 的授予依据槽位指向公司设立记录）。
 *
 * 边界与纪律：
 *   - **不复制记录形状**：输入是最小接口（`GrantLink`/`ExerciseClaimInput`/…），不是
 *     REC-AUTH-01 的完整记录；完整字段组装与落库归 store/daemon。时间用 epoch 毫秒
 *     （`InstantMs`）承载——本件不解析时区/日期，timestamp→InstantMs 的换算是调用方边界。
 *   - **零 IO**：不读时钟（时点由 `atMs` 传入）、不读环境/文件/网络；同输入恒同判定。
 *   - **不 fail-open**：链断/环/父缺失/证明缺项/越范围/过期/已撤回一律 prohibited 或
 *     uncovered（二者不同态）；无法判定包含关系不得视为已授权。
 */

import type { PolicyState } from './spec.ts'

/** 时刻（epoch 毫秒；由调用方从 timestamp 折算，本件不解析时区） */
export type InstantMs = number

/** 授予类别（值集唯一主表 v2/09 ENU-137：`delegation`｜`root_delegation`） */
export type GrantClass = 'delegation' | 'root_delegation'

/** 行使身份（值集唯一主表 v2/09 ENU-139：`self`｜`internal_boss`——子 agent 不得取后者） */
export type OnBehalfOf = 'self' | 'internal_boss'

/** 授予者类别：外部老板／公司位置／执行体（root_delegation 只认外部老板） */
export type GrantorKind = 'external_boss' | 'internal_position' | 'agent'

/** 根授予证明（ENU-138：root_delegation 恒 `ritual_and_key`；`record_only` 不得用于根授予） */
export interface RootDelegationProof {
  readonly proofMode: 'ritual_and_key' | 'record_only'
  /** operating root key 的指纹/公钥标识（不是密钥值） */
  readonly keyFingerprint: string
  readonly externalSignatureRef?: string
  readonly offlineApprovalRef?: string
}

/** 期限区间（左闭右开；无 `untilMs`＝不设到期，仍受撤回约束） */
export interface GrantTerm {
  readonly fromMs: InstantMs
  readonly untilMs?: InstantMs
}

/** 授予链的一段（REC-AUTH-01 的判定最小面） */
export interface GrantLink {
  readonly grantId: string
  readonly grantClass: GrantClass
  readonly grantor: string
  readonly grantorKind: GrantorKind
  readonly grantee: string
  /** 普通转授＝父授予 id；root_delegation 不得有父链（授予依据是公司设立记录，不入本链） */
  readonly parentGrantId?: string
  readonly purpose: string
  readonly scope: readonly string[]
  /** 保留区（ENU-31 `reserved`：落在保留区的行使须指定位置决定，不得自行放行） */
  readonly reservedScopes?: readonly string[]
  readonly conditions: readonly string[]
  readonly term: GrantTerm
  readonly delegable: boolean
  readonly proof?: RootDelegationProof
  readonly withdrawnAtMs?: InstantMs
}

/** 行使主张（REC-AUTH-02 的判定最小面；主张不是事实，回执归端口侧落账） */
export interface ExerciseClaimInput {
  readonly grantId: string
  readonly exercisedBy: string
  readonly action: string
  readonly scope: readonly string[]
  readonly onBehalfOf: OnBehalfOf
  /** 以 internal_boss 行 root 时必须为空（REC-AUTH-02：`withheld_scope` 为空） */
  readonly withheldScope?: readonly string[]
  readonly atMs: InstantMs
}

/** 拒绝原因（判定原因串；不是 v2/10 诊断码——本件不造第二码表） */
export type AuthorityRefusalKind =
  | 'grant-not-found'
  | 'parent-missing'
  | 'chain-cycle'
  | 'grant-withdrawn'
  | 'parent-withdrawn'
  | 'term-outside'
  | 'instant-outside-term'
  | 'scope-widening'
  | 'purpose-widening'
  | 'condition-widening'
  | 'not-delegable'
  | 'chain-discontinuous'
  | 'root-grantor-not-external'
  | 'root-proof-invalid'
  | 'root-parent-present'
  | 'action-not-in-scope'
  | 'on-behalf-of-forbidden'
  | 'withheld-scope-not-empty'

/** 拒绝项（逐条指明位置与语义，不合并成一句） */
export interface AuthorityRefusal {
  readonly kind: AuthorityRefusalKind
  readonly grantId: string
  readonly detail: string
}

/** 授权链判定（政策四态 ENU-31；uncovered 与 prohibited 不同态） */
export interface AuthorityVerdict {
  readonly state: PolicyState
  readonly chain: readonly string[]
  readonly refusals: readonly AuthorityRefusal[]
}

function refusal(kind: AuthorityRefusalKind, grantId: string, detail: string): AuthorityRefusal {
  return { kind, grantId, detail }
}

function setContainsAll(parent: readonly string[], child: readonly string[]): boolean {
  const allowed = new Set(parent)
  return child.every((item) => allowed.has(item))
}

function termWithin(parent: GrantTerm, child: GrantTerm): boolean {
  const startOk = child.fromMs >= parent.fromMs
  const endOk = parent.untilMs === undefined || (child.untilMs !== undefined && child.untilMs <= parent.untilMs)
  return startOk && endOk
}

function instantInTerm(term: GrantTerm, atMs: InstantMs): boolean {
  return atMs >= term.fromMs && (term.untilMs === undefined || atMs < term.untilMs)
}

/** 取根授予的证明判定（ENU-138；缺任一证明要素＝根授予不成立） */
export function rootDelegationFailure(grant: GrantLink): AuthorityRefusal | null {
  if (grant.grantClass !== 'root_delegation') {
    return refusal('root-grantor-not-external', grant.grantId, 'chain does not terminate at root_delegation')
  }
  if (grant.grantorKind !== 'external_boss') {
    // v2/11 REC-AUTH-01：根授予只能由外部老板签发（不得为任何 agent 或最高宰相本人）
    return refusal('root-grantor-not-external', grant.grantId, `grantorKind=${grant.grantorKind}`)
  }
  if (grant.parentGrantId !== undefined) {
    // 根授予的授予依据是公司设立记录，不进普通父链
    return refusal('root-parent-present', grant.grantId, String(grant.parentGrantId))
  }
  const proof = grant.proof
  if (proof === undefined) return refusal('root-proof-invalid', grant.grantId, 'proof missing')
  if (proof.proofMode !== 'ritual_and_key') return refusal('root-proof-invalid', grant.grantId, `proofMode=${proof.proofMode}`)
  if (proof.keyFingerprint.trim() === '') return refusal('root-proof-invalid', grant.grantId, 'keyFingerprint empty')
  const hasAttestation = (proof.externalSignatureRef ?? '') !== '' || (proof.offlineApprovalRef ?? '') !== ''
  if (!hasAttestation) return refusal('root-proof-invalid', grant.grantId, 'external signature and offline approval both missing')
  return null
}

/**
 * 授权链判定（PORT-AUTH verify 的纯核）：
 *   ① 主张的授予须存在且未被撤回（未找到＝**uncovered**，不是 prohibited）；
 *   ② 沿 parentGrantId 建链：断链/环/父缺失＝prohibited；
 *   ③ 链根必须是合法 root_delegation（外部老板＋ritual_and_key＋指纹＋签名或离线批准件）；
 *   ④ 逐段包含：明细不外扩（scope/purpose/conditions/term）＋父可再授＋主体连续；
 *   ⑤ 时点：主张时点须落在**全链**期限内；
 *   ⑥ 主张范围：`action` 须在主张 scope 内、主张 scope ⊆ 授予 scope；
 *   ⑦ `on_behalf_of=internal_boss`：仅可在 claim 所指 root_delegation 上、由该根的被授予者
 *      本人行使且 withheldScope 为空——子 agent 取此值＝prohibited；
 *   ⑧ 保留区命中＝**reserved**（须指定位置决定），不自行放行。
 */
export function verifyGrantChain(input: {
  readonly grants: readonly GrantLink[]
  readonly claim: ExerciseClaimInput
}): AuthorityVerdict {
  const byId = new Map(input.grants.map((grant) => [grant.grantId, grant]))
  const claim = input.claim
  const chain: string[] = []
  const refusals: AuthorityRefusal[] = []
  const claimed = byId.get(claim.grantId)
  if (claimed === undefined) {
    return { state: 'uncovered', chain, refusals: [refusal('grant-not-found', claim.grantId, 'no such grant')] }
  }
  // 建链（自主张授予向上；环与断链都是硬拒）
  let cursor: GrantLink | undefined = claimed
  const visited = new Set<string>()
  while (cursor !== undefined) {
    if (visited.has(cursor.grantId)) {
      refusals.push(refusal('chain-cycle', cursor.grantId, chain.join('→')))
      break
    }
    visited.add(cursor.grantId)
    chain.unshift(cursor.grantId)
    if (cursor.parentGrantId === undefined) break
    const parent = byId.get(cursor.parentGrantId)
    if (parent === undefined) {
      refusals.push(refusal('parent-missing', cursor.grantId, cursor.parentGrantId))
      break
    }
    cursor = parent
  }
  const root = cursor
  if (root === undefined || chain[0] !== root?.grantId) {
    // 建链未达根（断链已记）——链不完整即不可用
    if (refusals.length === 0) refusals.push(refusal('parent-missing', claimed.grantId, 'chain incomplete'))
  }
  if (root !== undefined) {
    const rootFailure = rootDelegationFailure(root)
    if (rootFailure !== null) refusals.push(rootFailure)
  }
  // 逐段包含（子不得外扩父；I-6）
  for (let index = 1; index < chain.length; index += 1) {
    const parent = byId.get(chain[index - 1] as string)
    const child = byId.get(chain[index] as string)
    if (parent === undefined || child === undefined) continue
    if (child.grantor !== parent.grantee) {
      refusals.push(refusal('chain-discontinuous', child.grantId, `${child.grantor} ≠ ${parent.grantee}`))
    }
    if (!parent.delegable) refusals.push(refusal('not-delegable', parent.grantId, child.grantId))
    if (!setContainsAll(parent.scope, child.scope)) {
      refusals.push(refusal('scope-widening', child.grantId, child.scope.join(',')))
    }
    if (child.purpose !== parent.purpose) {
      refusals.push(refusal('purpose-widening', child.grantId, `${child.purpose} ≠ ${parent.purpose}`))
    }
    // 子可追加条件，但必须完整携带父的条件（条件不得被稀释）
    if (!setContainsAll(child.conditions, parent.conditions)) {
      refusals.push(refusal('condition-widening', child.grantId, 'parent conditions not carried'))
    }
    if (!termWithin(parent.term, child.term)) {
      refusals.push(refusal('term-outside', child.grantId, `${child.term.fromMs}..${child.term.untilMs ?? '∞'}`))
    }
  }
  // 撤回：自身或任一代祖先已撤回，整条链不可再用
  for (const grantId of chain) {
    const grant = byId.get(grantId)
    if (grant?.withdrawnAtMs !== undefined) {
      refusals.push(refusal(grantId === claimed.grantId ? 'grant-withdrawn' : 'parent-withdrawn', grantId, String(grant.withdrawnAtMs)))
    }
  }
  // 时点：全链期限内（逐段冗余校验，防父期限数据不一致时静默放行）
  for (const grantId of chain) {
    const grant = byId.get(grantId)
    if (grant !== undefined && !instantInTerm(grant.term, claim.atMs)) {
      refusals.push(refusal('instant-outside-term', grantId, String(claim.atMs)))
    }
  }
  // 主张范围
  if (claim.scope.length === 0 || !claim.scope.includes(claim.action)) {
    refusals.push(refusal('action-not-in-scope', claimed.grantId, claim.action))
  }
  if (!setContainsAll(claimed.scope, claim.scope)) {
    refusals.push(refusal('scope-widening', claimed.grantId, claim.scope.join(',')))
  }
  // 行使身份（ENU-139）
  if (claim.onBehalfOf === 'internal_boss') {
    const rootGrant = root
    const isRootHolder = rootGrant !== undefined && rootGrant.grantClass === 'root_delegation' && rootGrant.grantee === claim.exercisedBy
    if (!isRootHolder || claimed.grantId !== rootGrant?.grantId) {
      refusals.push(refusal('on-behalf-of-forbidden', claim.grantId, `${claim.exercisedBy} is not the root holder`))
    }
    if ((claim.withheldScope ?? []).length > 0) {
      refusals.push(refusal('withheld-scope-not-empty', claim.grantId, (claim.withheldScope ?? []).join(',')))
    }
  }
  // 保留区（ENU-31 reserved：须指定位置决定）
  const reserved = new Set(claimed.reservedScopes ?? [])
  const hitsReserved = claim.scope.some((item) => reserved.has(item))
  if (refusals.length > 0) return { state: 'prohibited', chain, refusals }
  if (hitsReserved) return { state: 'reserved', chain, refusals: [] }
  return { state: 'permitted', chain, refusals: [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// 二、撤回与后代（REC-AUTH-03；I-6「撤回必结清」）
// ─────────────────────────────────────────────────────────────────────────────

/** 停用证据（ENU-130 三选一） */
export interface DeactivationEvidence {
  readonly grantId: string
  readonly kind: 'revocation_receipt' | 'injection_stop_confirm' | 'fence_rejection_record'
  readonly evidenceRef: string
}

/** 撤回请求（最小判定面：后代枚举＋停用证据＋无后代确认＋轮换后继） */
export interface WithdrawalRequestInput {
  readonly rootGrantId: string
  readonly withdrawnAtMs: InstantMs
  readonly enumeratedDescendants: readonly string[]
  readonly deactivationEvidence: readonly DeactivationEvidence[]
  /** 无后代时须显式确认（探测方法＋最后探测时点另记；空数组不得冒充「查过了」） */
  readonly noDescendantsConfirmed?: boolean
  readonly probeMethod?: string
  readonly rotation?: boolean
  readonly successorGrantId?: string
}

/** 撤回完整性判定（后代未全停或凭据未失效时不得记完成） */
export interface WithdrawalCheck {
  readonly complete: boolean
  /** 实际后代（传递闭包，按 id 升序） */
  readonly descendants: readonly string[]
  /** 实际存在但未枚举的后代 */
  readonly missing: readonly string[]
  /** 已枚举但缺停用证据的后代 */
  readonly unevidenced: readonly string[]
  readonly findings: readonly string[]
}

/** 传递后代（含多级；不判环——链数据异常时按集合去重保守处理） */
export function descendantGrants(grants: readonly GrantLink[], rootGrantId: string): readonly string[] {
  const children = new Map<string, string[]>()
  for (const grant of grants) {
    if (grant.parentGrantId === undefined) continue
    const list = children.get(grant.parentGrantId) ?? []
    list.push(grant.grantId)
    children.set(grant.parentGrantId, list)
  }
  const out = new Set<string>()
  const stack = [...(children.get(rootGrantId) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (out.has(id)) continue
    out.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return [...out].sort()
}

/** 授权链是否**实际**失效（自身或任一代祖先已撤回） */
export function isEffectivelyWithdrawn(grants: readonly GrantLink[], grantId: string): boolean {
  const byId = new Map(grants.map((grant) => [grant.grantId, grant]))
  let cursor = byId.get(grantId)
  const seen = new Set<string>()
  while (cursor !== undefined && !seen.has(cursor.grantId)) {
    if (cursor.withdrawnAtMs !== undefined) return true
    seen.add(cursor.grantId)
    cursor = cursor.parentGrantId === undefined ? undefined : byId.get(cursor.parentGrantId)
  }
  return false
}

/**
 * 撤回完整性判定（PORT-AUTH withdraw 的纯核）：
 *   ① 实际后代必须逐项枚举（missing 非空＝未完成）；
 *   ② 每个被枚举后代必须有停用证据（kind 落 ENU-130 三值）；
 *   ③ 无后代时须显式 `noDescendantsConfirmed=true` 且给探测方法（不得留空视为零）；
 *   ④ 轮换须同时给出 `successorGrantId`。
 * 任一条不满足 → complete=false（不得记撤回完成，I-6）。
 */
export function checkWithdrawalCompleteness(input: {
  readonly grants: readonly GrantLink[]
  readonly request: WithdrawalRequestInput
}): WithdrawalCheck {
  const descendants = descendantGrants(input.grants, input.request.rootGrantId)
  const enumerated = new Set(input.request.enumeratedDescendants)
  const evidence = new Map<string, DeactivationEvidence[]>()
  const findings: string[] = []
  for (const item of input.request.deactivationEvidence) {
    const list = evidence.get(item.grantId) ?? []
    list.push(item)
    evidence.set(item.grantId, list)
  }
  const missing = descendants.filter((id) => !enumerated.has(id))
  const unevidenced = input.request.enumeratedDescendants.filter((id) => (evidence.get(id) ?? []).length === 0)
  if (missing.length > 0) findings.push(`unlisted-descendants:${missing.join(',')}`)
  if (unevidenced.length > 0) findings.push(`missing-deactivation-evidence:${unevidenced.join(',')}`)
  if (input.request.enumeratedDescendants.some((id) => !descendants.includes(id))) {
    findings.push('enumerated-not-descendant')
  }
  if (descendants.length === 0) {
    if (input.request.noDescendantsConfirmed !== true) findings.push('no-descendants-not-confirmed')
    if ((input.request.probeMethod ?? '').trim() === '') findings.push('probe-method-missing')
  }
  if (input.request.rotation === true && (input.request.successorGrantId ?? '') === '') {
    findings.push('successor-grant-missing')
  }
  if (!Number.isFinite(input.request.withdrawnAtMs)) findings.push('withdrawn-at-invalid')
  return { complete: findings.length === 0, descendants, missing, unevidenced, findings }
}
