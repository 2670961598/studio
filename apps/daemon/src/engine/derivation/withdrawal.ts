/**
 * derivation/withdrawal —— PORT-AUTH.withdraw 生产实现＋撤回回执写面（GAP-V2-04 S6）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - docs/v2/14 §1.2 PORT-AUTH.withdraw（REC-AUTH-03：后代枚举＋停用证据＋无后代显式确认）；
 *   - docs/v2/07 §四撤回四判据（后代清单/逐个停用或凭据失效/无后代显式确认/残留观察）；
 *   - docs/v2/15 §六 SEC-REV-01（三件套）／SEC-REV-02（整树撤回网关）；
 *   - docs/v2/11 §2.2 REC-AUTH-03 与 §六 REC-EVD-RVK（记录信封/后代清单/停用证据）；
 *   - docs/17-§2（派发前判定）／§6（撤回完成须以证据面收口，不以「父已撤」代替逐后代结清）；
 *   - #528 授权链接线（engine/tools/authority-gate.ts）：撤回完整性判定复用其
 *     `checkWithdrawalCompleteness`，本件不复制授权规则。
 *
 * 顺序（先判后写，任一 fail-closed 码即不得记撤回完成）：
 *   ① 授权链完整性（#528 authority.withdraw）；② 授权记录→目录凭据映射；③ 吊销证明三动作
 *   （撤销记录/停止注入/围栏拒绝）齐备；④ 派生树传播（gateway.revoke：目录枚举＋继承面校验
 *   ＋逐后代停用证据＋撤回后对账）；⑤ REC-EVD-RVK / REC-AUTH-03 记录行（PORT-HIST 唯一写口）。
 *
 * 边界（如实登记）：
 *   - 记录写者不是新契约：REC-AUTH-03 / REC-EVD-RVK 形状已存在（contract records），本件只装配
 *     既有 schema 的生产行；若未来需要新增记录类型/字段，属契约面子项，须报 Lead/制作人批。
 *   - 行内凭据只记逻辑引用（credential_class＋logical_reference），永不记值（三不入）。
 *   - 撤回完成以 `gateway.revoke` 的 `reconciliation.stillUsable=[]` 与记录行落库为双重收口；
 *     进程 termination/注入停止的真实执行面证据由调用方按 ENU-130 三选一注入，本件不伪造。
 */
import type {
  CallContext,
  DeactivationEvidence,
  DescendantClosure,
  GrantRef,
  PortResult,
  WithdrawReceipt,
} from '@studio-next/contract'
import type { DeactivationEvidence as CoreDeactivationEvidence, WithdrawalRequestInput } from '@studio-next/core'
import {
  reconcileRevocation,
  type CatalogEntryView,
  type CredentialCatalog,
  type DerivationDeactivationEvidence,
  type DerivationGateway,
  type DerivationRevocationReceipt,
  type RevocationProof,
} from '@studio-next/gateway'
import type { HistFace } from '@studio-next/store'
import type { AuthorityGate } from '../tools/authority-gate.ts'

/** 撤回原因（与 REC-AUTH-03 payload.reason 同一值集；contract records/auth.ts） */
export type WithdrawalReason = 'expiry' | 'active_withdrawal' | 'conflict_of_interest' | 're_assignment' | 'incapacity' | 'unauthorized_found'

/** 生产撤回入参（PORT-AUTH 形状＋落记录所需的探测/残留字段） */
export interface DaemonWithdrawRequest {
  /** 被撤回授予（REC-AUTH-01 引用） */
  readonly grant: GrantRef
  readonly reason: WithdrawalReason
  /** 授权链后代闭包（与 PORT-AUTH 同形；无后代须显式确认） */
  readonly closure: DescendantClosure
  /** 停用证据（ENU-130 三选一；逐后代证据引用由本件按派生闭包展开） */
  readonly deactivationEvidence: readonly [DeactivationEvidence, ...DeactivationEvidence[]]
  /** 无后代时的显式确认方法（探测方法；closure.noDescendantsConfirmed=true 时必填） */
  readonly probeMethod?: string
  /** 无后代时的最后探测时点（ISO 带偏移） */
  readonly lastProbedAt?: string
  /** 在途动作/未结承诺（REC-AUTH-03 in_flight_inventory；缺省空） */
  readonly inFlightInventory?: readonly string[]
  /** 可能迟到的副作用（REC-AUTH-03 residual_side_effects；缺省空） */
  readonly residualSideEffects?: readonly string[]
  /** 轮换后继授予（REC-AUTH-03 successor_grant；改授/轮换须给） */
  readonly successorGrant?: GrantRef
  /** 被撤回授予类别（缺省取 grant.grantClass） */
  readonly withdrawnGrantClass?: 'delegation' | 'root_delegation'
}

/** 控制面 ctl- 动作族入口（与 PORT-AUTH 撤回共用同一判定/写面；不新增动作词） */
export interface ControlWithdrawArgs extends DaemonWithdrawRequest {
  /** 控制面调用者（具名位置；决定者不得写框架/系统） */
  readonly decidedBy: string
}

export interface WithdrawalFace {
  /** PORT-AUTH.withdraw 生产实现（授权链→派生网关→记录行） */
  withdraw(request: DaemonWithdrawRequest, ctx: CallContext): PortResult<WithdrawReceipt>
  /** 控制面 ctl- 动作族入口（同一核心，多一个具名决定者校验） */
  controlWithdraw(args: ControlWithdrawArgs, ctx: CallContext): PortResult<WithdrawReceipt>
  /** 只读：目录父链后代（供调用方组装 closure；不新增判据） */
  catalogDescendants(secretId: string): readonly string[]
}

export interface WithdrawalOptions {
  readonly authority: AuthorityGate
  readonly gateway: DerivationGateway
  readonly catalog: CredentialCatalog
  /** 撤回传播＋持久账（生产=PersistentDerivationFace.revoke；测试可注入同形） */
  readonly revoke: (
    secretId: string,
    proof: RevocationProof,
    deactivationEvidence?: readonly DerivationDeactivationEvidence[],
  ) => PortResult<DerivationRevocationReceipt>
  readonly hist: HistFace
  readonly clock: () => number
  readonly company: string
  readonly writtenBy: string
}

const RECORD_VERSION = '1.0.0'

/** ENU 值集（与 contract records/auth.ts 同源；不另立第二套字段表） */
const WITHDRAWAL_REASONS = new Set<WithdrawalReason>([
  'expiry',
  'active_withdrawal',
  'conflict_of_interest',
  're_assignment',
  'incapacity',
  'unauthorized_found',
])
const DEACTIVATION_KINDS = new Set(['revocation_receipt', 'injection_stop_confirm', 'fence_rejection_record'])
const SCHEMA_REF = { schemaId: 'records.auth-withdrawal', schemaVersion: RECORD_VERSION } as const
const EVD_SCHEMA_REF = { schemaId: 'records.evd-revocation', schemaVersion: RECORD_VERSION } as const

function err<T>(
  category: 'rejected_precondition' | 'rejected_authority' | 'rejected_state' | 'unavailable' | 'partial',
  subcause: string,
  detail: string,
  sideEffectPossible = false,
): PortResult<T> {
  return {
    kind: 'err',
    error: {
      category,
      subcause,
      detail,
      retryable: false,
      sideEffectPossible,
      reconcile: sideEffectPossible
        ? { required: true, query: { recordType: 'REC-AUTH-03', keys: { withdrawal: subcause } } }
        : { required: false, reason: detail },
      responsiblePosition: 'daemon',
    },
  }
}

function coreEvidenceFor(request: DaemonWithdrawRequest): readonly CoreDeactivationEvidence[] {
  const first = request.deactivationEvidence[0]
  return request.closure.descendants.map((descendant) => ({
    grantId: descendant.recordId,
    kind: first.kind,
    evidenceRef: first.evidenceRef,
  }))
}

function coreInputOf(request: DaemonWithdrawRequest, withdrawnAtMs: number): WithdrawalRequestInput {
  const descendants = request.closure.descendants
  return {
    rootGrantId: request.grant.recordId,
    withdrawnAtMs,
    enumeratedDescendants: descendants.map((descendant) => descendant.recordId),
    deactivationEvidence: coreEvidenceFor(request),
    ...(descendants.length === 0 ? { noDescendantsConfirmed: request.closure.noDescendantsConfirmed === true } : {}),
    ...(request.probeMethod !== undefined ? { probeMethod: request.probeMethod } : {}),
    ...(request.successorGrant !== undefined
      ? { rotation: true, successorGrantId: request.successorGrant.recordId }
      : {}),
  }
}

/** 撤回证明：三动作必须齐（缺任一＝不得记撤回完成） */
function proofOf(
  request: DaemonWithdrawRequest,
  recordId: string,
  descendants: readonly string[],
): PortResult<RevocationProof> {
  const kinds = new Set(request.deactivationEvidence.map((item) => item.kind))
  if (!kinds.has('injection_stop_confirm') || !kinds.has('fence_rejection_record')) {
    return err(
      'rejected_precondition',
      'auth/withdraw-evidence-incomplete',
      '停用证据缺「停止注入」或「围栏拒绝记录」——三动作未齐不得记撤回完成（SEC-REV-01）',
    )
  }
  if (descendants.length === 0) {
    if (request.probeMethod === undefined || request.probeMethod.trim() === '' || request.lastProbedAt === undefined) {
      return err(
        'rejected_precondition',
        'auth/probe-method-missing',
        '无后代时须给显式确认方法（探测方法＋最后探测时点），不得留空视为零（REC-AUTH-03/EVD-RVK）',
      )
    }
    return {
      kind: 'ok',
      value: {
        recordId,
        injectionStopped: true,
        fenceRejectionRecorded: true,
        evidenceRefs: request.deactivationEvidence.map((item) => item.evidenceRef) as [string, ...string[]],
        noDescendantConfirmation: { probeMethod: request.probeMethod, lastProbedAt: request.lastProbedAt },
      },
    }
  }
  return {
    kind: 'ok',
    value: {
      recordId,
      injectionStopped: true,
      fenceRejectionRecorded: true,
      evidenceRefs: request.deactivationEvidence.map((item) => item.evidenceRef) as [string, ...string[]],
      descendants,
    },
  }
}

/** 计划撤回的派生闭包（受影响执行体＋全部后代；供逐后代证据与记录行） */
function plannedDerivations(gateway: DerivationGateway, secretId: string): readonly string[] {
  const affected = gateway.affectedByCredential(secretId)
  if (affected.kind !== 'ok') return []
  const planned: string[] = []
  for (const inventory of affected.value) {
    if (!planned.includes(inventory.derivation.derivationId)) planned.push(inventory.derivation.derivationId)
    const descendants = gateway.enumerateDescendants(inventory.derivation.derivationId)
    if (descendants.kind === 'ok') {
      for (const id of descendants.value) if (!planned.includes(id)) planned.push(id)
    }
  }
  return planned
}

/** 记录行共用的后代清单（REC-AUTH-03 descendants[] / REC-EVD-RVK descendants_inventory） */
interface DescendantRow {
  readonly descendant_type: string
  readonly identity_ref: string
  readonly credential: { readonly credential_class: string; readonly logical_reference: string }
  readonly deactivation_evidence: string
  readonly reconcile_entry: string
}

/** 目录父链后代（被注入/被复制凭据）也进 REC-AUTH-03 descendants[]（不只派生执行体） */
function credentialDescendantRows(
  descendants: readonly string[],
  views: readonly CatalogEntryView[],
  evidenceRef: string,
): readonly DescendantRow[] {
  const byId = new Map(views.map((view) => [view.secretId, view] as const))
  return descendants.map((secretId) => {
    const view = byId.get(secretId)
    return {
      descendant_type: '被注入凭据',
      identity_ref: secretId,
      credential: {
        credential_class: view?.credentialClass ?? 'scoped',
        logical_reference: view?.logicalReference ?? `credential:${secretId}`,
      },
      deactivation_evidence: evidenceRef,
      reconcile_entry: `credential:${secretId}`,
    }
  })
}

function descendantRows(
  receipt: DerivationRevocationReceipt,
  anchor: CatalogEntryView,
): readonly DescendantRow[] {
  return receipt.revokedDerivations.map((record) => {
    const evidence = receipt.deactivationEvidence.find((item) => item.derivationId === record.derivationId)
    const evidenceRef = evidence?.evidenceRef ?? receipt.catalogReceipt.evidenceRefs[0] ?? receipt.recordId
    return {
      descendant_type: record.backend === 'external-cli' ? '外部后端子进程' : '进程内子执行体',
      identity_ref: record.derivationId,
      // 后代可能不直接持锚凭据（继承默认无），记录其受限面所依的锚凭据逻辑引用；
      // 只记引用、不记值（三不入）。credential_class 取目录事实源。
      credential: { credential_class: anchor.credentialClass, logical_reference: anchor.logicalReference },
      deactivation_evidence: evidenceRef,
      reconcile_entry: `derivation:${record.derivationId}`,
    }
  })
}

function envelopeOf(
  recordId: string,
  recordType: string,
  schemaRef: { schemaId: string; schemaVersion: string },
  company: string,
  producedAt: string,
  decidedBy: string,
  writtenBy: string,
  payload: unknown,
  proofBoundary: string,
): unknown {
  return {
    recordId,
    recordType,
    schemaRef,
    specVersion: RECORD_VERSION,
    companyRef: company,
    producedAt,
    producer: { decidedBy, writtenBy },
    basisRefs: [],
    payload,
    effectiveState: 'effective',
    effectiveTime: { from: producedAt },
    proofBoundary,
    idempotencyKey: {
      companyRef: company,
      recordType,
      subjectId: recordId,
      operationClass: 'auth-withdraw',
      requesterSequence: recordId,
    },
  }
}

/** 建 PORT-AUTH 撤回面（一次装配一实例；判定/写面全注入） */
export function createWithdrawalFace(options: WithdrawalOptions): WithdrawalFace {
  const face: WithdrawalFace = {
    catalogDescendants(secretId: string): readonly string[] {
      return reconcileRevocation(options.catalog.entryViews(), secretId).descendants
    },

    withdraw(request: DaemonWithdrawRequest, ctx: CallContext): PortResult<WithdrawReceipt> {
      if (request.grant.recordId.trim() === '') {
        return err('rejected_precondition', 'auth/grant-invalid', '撤回目标授予须有非空 recordId')
      }
      // 先在**任何状态变更之前**做请求形状闸：坏 reason/坏证据形状不得先撤后报错（fail-closed）
      if (!WITHDRAWAL_REASONS.has(request.reason)) {
        return err('rejected_precondition', 'auth/reason-invalid', `撤回原因 ${String(request.reason)} 不在 ENU 值集（不得自造原因）`)
      }
      if (request.deactivationEvidence.length === 0) {
        return err('rejected_precondition', 'auth/evidence-invalid', '停用证据不得为空（ENU-130 三选一）')
      }
      for (const item of request.deactivationEvidence) {
        if (!DEACTIVATION_KINDS.has(item.kind) || item.evidenceRef.trim() === '') {
          return err('rejected_precondition', 'auth/evidence-invalid', `停用证据 ${item.kind}/${item.evidenceRef} 形状非法（ENU-130 三选一且引用非空）`)
        }
      }
      const views = options.catalog.entryViews()
      const matches = views.filter((view) => view.boundGrant.recordId === request.grant.recordId)
      if (matches.length === 0) {
        return err(
          'rejected_precondition',
          'auth/credential-unmapped',
          `授予 ${request.grant.recordId} 在凭据目录无 bound_grant 映射——不得以「已撤」冒充凭据失效（先登记 REC-AUTH-04 逻辑引用）`,
        )
      }
      if (matches.length > 1) {
        return err(
          'rejected_precondition',
          'auth/credential-ambiguous',
          `授予 ${request.grant.recordId} 绑定多个目录凭据（${matches.map((view) => view.secretId).join('/')}）——撤回目标不唯一，须先拆授予或显式指定凭据（不猜）`,
        )
      }
      const anchor = matches[0] as CatalogEntryView

      const withdrawnAtMs = options.clock()
      const decision = options.authority.withdraw(coreInputOf(request, withdrawnAtMs))
      if (!decision.allowed) {
        return err(
          'rejected_authority',
          'auth/withdraw-incomplete',
          `授权链撤回完整性未通过（${decision.reason ?? 'unknown'}）：${decision.check?.findings.join(';') ?? '无判定材料'}——不得记撤回完成（I-6）`,
        )
      }

      const descendants = face.catalogDescendants(anchor.secretId)
      const proof = proofOf(request, decision.evidenceId, descendants)
      if (proof.kind !== 'ok') return proof

      const planned = plannedDerivations(options.gateway, anchor.secretId)
      const evidenceRefs = request.deactivationEvidence.map((item) => item.evidenceRef)
      const derivationEvidence: readonly DerivationDeactivationEvidence[] = planned.map((derivationId) => ({
        derivationId,
        evidenceRef: `${evidenceRefs[0]}#derivation/${derivationId}`,
      }))

      const revoked = options.revoke(anchor.secretId, proof.value, derivationEvidence)
      if (revoked.kind !== 'ok') return revoked
      const receipt = revoked.value
      if (receipt.reconciliation.stillUsable.length > 0) {
        return err(
          'rejected_state',
          'derivation/reconciliation-residual',
          `撤回后对账仍可用 ${receipt.reconciliation.stillUsable.join('/')}（NEG-SEC-08）`,
          true,
        )
      }

      const nowIso = new Date(withdrawnAtMs).toISOString()
      const evdRecordId = `EVD-RVK-${decision.evidenceId}`
      const authRecordId = `REC-AUTH-03-${decision.evidenceId}`
      const anchorEvidenceRef = evidenceRefs[0] as string
      const rows = [
        ...credentialDescendantRows(descendants, options.catalog.entryViews(), anchorEvidenceRef),
        ...descendantRows(receipt, anchor),
      ]
      const noDescendants = rows.length === 0
      const firstKind = request.deactivationEvidence[0].kind
      const deactivation = {
        kind: firstKind,
        evidence_ref: evidenceRefs[0],
        ...(noDescendants
          ? { no_descendant_confirmation: { probe_method: request.probeMethod as string, last_probed_at: request.lastProbedAt as string } }
          : {}),
      }
      const grantRef = {
        refType: 'REC-AUTH-01' as const,
        refId: request.grant.recordId,
        refVersion: RECORD_VERSION,
      }
      const evdPayload = {
        subject: grantRef,
        descendants_inventory: rows,
        deactivation_evidence: deactivation,
        ...(noDescendants
          ? { no_descendant_confirmation: { probe_method: request.probeMethod as string, last_probed_at: request.lastProbedAt as string } }
          : {}),
      }
      const authPayload = {
        withdrawn_grant: grantRef,
        reason: request.reason,
        effective_time: nowIso,
        in_flight_inventory: [...(request.inFlightInventory ?? [])],
        descendants: rows,
        deactivation_evidence: deactivation,
        runtime_stop_evidence: { refType: 'REC-EVD-RVK' as const, refId: evdRecordId, refVersion: RECORD_VERSION },
        credential_actions: receipt.revokedCredentials.map((id) => `revoked:${id}`),
        residual_side_effects: [...(request.residualSideEffects ?? [])],
        ...(request.successorGrant !== undefined
          ? { successor_grant: { refType: 'REC-AUTH-01' as const, refId: request.successorGrant.recordId, refVersion: RECORD_VERSION } }
          : {}),
        withdrawn_grant_class: request.withdrawnGrantClass ?? request.grant.grantClass,
      }

      const decidedBy = ctx.caller.positionRef ?? ctx.caller.callerId
      const company = ctx.company.companyId
      const proofBoundary =
        '本记录证明授权链完整性判定通过、派生树闭包已置撤回、目录三动作与逐后代停用证据引用齐备；不证明执行体进程已被操作系统终止，也不证明残留副作用为零（残留观察归 REC-OBS-03）'

      try {
        options.hist.append(
          envelopeOf(
            evdRecordId,
            'REC-EVD-RVK',
            EVD_SCHEMA_REF,
            company,
            nowIso,
            decidedBy,
            options.writtenBy,
            evdPayload,
            proofBoundary,
          ),
        )
        options.hist.append(
          envelopeOf(
            authRecordId,
            'REC-AUTH-03',
            SCHEMA_REF,
            company,
            nowIso,
            decidedBy,
            options.writtenBy,
            authPayload,
            proofBoundary,
          ),
        )
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        return err(
          'partial',
          'auth/withdraw-record-write-failed',
          `撤回已传播但记录行写入失败（${evdRecordId}/${authRecordId}）：${detail}——不得记撤回完成`,
          true,
        )
      }

      return {
        kind: 'ok',
        value: {
          recordId: evdRecordId,
          revoked: [request.grant],
          noDescendants,
          gatewayEnforced: true,
          deactivationEvidence: [...request.deactivationEvidence],
        },
      }
    },

    controlWithdraw(args: ControlWithdrawArgs, ctx: CallContext): PortResult<WithdrawReceipt> {
      const decidedBy = args.decidedBy.trim()
      if (decidedBy === '') {
        return err('rejected_precondition', 'auth/control-decider-missing', '控制面撤回须给具名决定者（不得以框架/系统代签）')
      }
      if (['framework', 'system', 'platform', 'daemon', 'monitoring', 'auto_policy'].includes(decidedBy.toLowerCase())) {
        return err(
          'rejected_authority',
          'auth/control-decider-forbidden',
          `控制面撤回决定者不得为「${decidedBy}」（§0.2-1/I-9 要求具名位置）`,
        )
      }
      return face.withdraw(args, ctx)
    },
  }
  return face
}

/** 从控制面 ctl- 动作参数解析撤回请求（严格形状；不认识的键=拒，不猜不修复） */
export function parseControlWithdraw(raw: unknown): PortResult<ControlWithdrawArgs> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('rejected_precondition', 'auth/control-args-invalid', '控制面撤回参数须为对象')
  }
  const bag = raw as Record<string, unknown>
  const allowed = new Set([
    'grant',
    'reason',
    'closure',
    'deactivationEvidence',
    'probeMethod',
    'lastProbedAt',
    'inFlightInventory',
    'residualSideEffects',
    'successorGrant',
    'withdrawnGrantClass',
    'decidedBy',
  ])
  for (const key of Object.keys(bag)) {
    if (!allowed.has(key)) return err('rejected_precondition', 'auth/control-args-invalid', `控制面撤回参数出现未声明键 \`${key}\``)
  }
  const grant = bag['grant'] as GrantRef | undefined
  const decidedBy = typeof bag['decidedBy'] === 'string' ? bag['decidedBy'] : ''
  if (grant === undefined || typeof grant.recordId !== 'string' || grant.recordId === '') {
    return err('rejected_precondition', 'auth/control-args-invalid', 'grant 须为 REC-AUTH-01 引用（recordId/version/grantClass）')
  }
  if (typeof bag['reason'] !== 'string') {
    return err('rejected_precondition', 'auth/control-args-invalid', 'reason 须为非空撤回原因')
  }
  if (typeof bag['closure'] !== 'object' || bag['closure'] === null) {
    return err('rejected_precondition', 'auth/control-args-invalid', 'closure 须为后代闭包（descendants[] 或 noDescendantsConfirmed）')
  }
  if (!Array.isArray(bag['deactivationEvidence']) || bag['deactivationEvidence'].length === 0) {
    return err('rejected_precondition', 'auth/control-args-invalid', 'deactivationEvidence 须为非空数组（ENU-130 三选一）')
  }
  return {
    kind: 'ok',
    value: {
      grant,
      reason: bag['reason'] as WithdrawalReason,
      closure: bag['closure'] as DescendantClosure,
      deactivationEvidence: bag['deactivationEvidence'] as unknown as DaemonWithdrawRequest['deactivationEvidence'],
      decidedBy,
      ...(typeof bag['probeMethod'] === 'string' ? { probeMethod: bag['probeMethod'] } : {}),
      ...(typeof bag['lastProbedAt'] === 'string' ? { lastProbedAt: bag['lastProbedAt'] } : {}),
      ...(Array.isArray(bag['inFlightInventory']) ? { inFlightInventory: bag['inFlightInventory'] as string[] } : {}),
      ...(Array.isArray(bag['residualSideEffects']) ? { residualSideEffects: bag['residualSideEffects'] as string[] } : {}),
      ...(bag['successorGrant'] !== undefined ? { successorGrant: bag['successorGrant'] as GrantRef } : {}),
      ...(bag['withdrawnGrantClass'] === 'delegation' || bag['withdrawnGrantClass'] === 'root_delegation'
        ? { withdrawnGrantClass: bag['withdrawnGrantClass'] as 'delegation' | 'root_delegation' }
        : {}),
    },
  }
}

