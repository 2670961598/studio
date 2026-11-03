/**
 * engine/records/authority —— 授权链（REC-AUTH-01）生产写面派生件
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位 0 启动装载／相位 3 派发前权源：本件供两处）；
 *   - docs/v2/11 §2.2（REC-AUTH-01 字段表：目的/对象/范围含不可为边界/条件/期限/退出；根授予子类型
 *     grant_class=root_delegation 只能由外部老板签发，必带 key_fingerprint＋外部签名或离线批准件＋
 *     proof_mode=ritual_and_key）／§0.3-2（决定面封闭清单）／§0.7（证明边界）／§十五-2（G9 必引根授予）；
 *   - docs/v2/03 §3.1/§3.3（根与冷启动、+1/+2 链）；
 *   - docs/v2/15 §七（SEC-ROOT-02 验签/指纹：秘密值不入库，只留公开指纹）。
 *
 * 纪律（本条即「自填即拒」的授权面）：
 *   1. **外部事实只有一处注入口**（`RootGrantFact`）：root 授予的授予人/设立记录引用/公开指纹/期限/
 *      外部证明件/核验结论——全部由装配面注入（生产=#530 根委任生产件；缺省＝无外部事实）；
 *   2. 缺任一项即拒写 `record-prereq-missing`，**不由本件补造**（不猜指纹、不冒充验签通过、不拿
 *      「内部程序」补位——§2.2/§十五-2 明文禁止）；
 *   3. 转授边一律由名册派生（授予人＝上级位置，受授人＝名册人员在岗位置），范围取部门职能/泳道，
 *      不可为边界显式列出（§2.2「scope 含不可为边界」）。
 */
import { validateAuthGrant } from '@studio-next/contract/records'
import type { DraftOutcome, DraftRecordRef } from './drafts.ts'
import { isoAt } from './drafts.ts'
import {
  EXTERNAL_OWNER,
  deptOf,
  isOnDuty,
  personObjectRef,
  personOf,
  positionRefIdOf,
  topPersonOf,
  type CompanyRoster,
  type RosterDept,
} from './roster.ts'

/** 记录类型版本（§十五-4：全部 74 类初始类型版本 1.0.0） */
export const RECORD_TYPE_VERSION = '1.0.0'

/** 根授予外部事实（唯一外部注入口；缺项＝拒写。字段语义见头注纪律 1） */
export interface RootGrantFact {
  /** 公司设立记录引用（root 的 parent_grant；v2/03 §3.1——外部事实，不由本件造） */
  readonly establishmentRef: DraftRecordRef
  /** operating root key 的公开指纹（`sha256:<hex>` 形态由外部登记；**不是密钥值**） */
  readonly keyFingerprint: string
  /** 外部老板签名件引用（与 offlineApprovalRef 二选一，至少一项） */
  readonly externalSignatureRef?: { readonly refId: string; readonly refVersion: string }
  /** 离线批准件引用（与 externalSignatureRef 二选一） */
  readonly offlineApprovalRef?: { readonly refId: string; readonly refVersion: string }
  /** 授予期限（外部事实；ISO 带偏移时刻） */
  readonly term: { readonly from: string; readonly to: string }
  /** 验签核验结论（外部独立信任域给出；false＝不得落库） */
  readonly proofVerified: boolean
  /** 指纹比对结论（false＝不得落库） */
  readonly fingerprintMatches: boolean
}

/**
 * 不可为边界（v2/11 §2.2「scope 含不可为边界」）：任何授予/行使都不得覆盖的动作范围。
 * root 动作只归最高宰相本人（经 REC-AUTH-02 行使面），跨部门写入一律越权——权源解析见即拒。
 */
export const GRANT_FORBIDDEN = ['root:use', 'cross-dept:write'] as const

/** 授权链边（转授链的派生投影；forbidden＝该边的不可为边界，缺省取 GRANT_FORBIDDEN） */
export interface AuthorityChainEdge {
  readonly recordId: string
  readonly grantorId: string
  readonly granteeId: string
  readonly included: readonly string[]
  readonly forbidden?: readonly string[]
}

/** 授权链派生结果（root 缺省时只有 refused 原因，不产出任何边） */
export interface AuthorityChain {
  readonly root?: { readonly recordId: string; readonly topId: string }
  readonly delegations: readonly AuthorityChainEdge[]
}

/** 权源引用（REC-AUTH-01 记录引用；决定型记录 authority_ref 的唯一来源） */
export function grantRef(recordId: string): DraftRecordRef {
  return { refType: 'REC-AUTH-01', refId: recordId, refVersion: RECORD_TYPE_VERSION }
}

/** 根授予记录 id（身份不复用：一公司一顶位一份根授予；轮换走新版本/新记录） */
export function rootGrantRecordId(company: string, topId: string): string {
  return `rec-auth-01:${company}:root:${topId}`
}

/** 转授边记录 id（授予人×受授人×部门；同语义重放恒同 id——§0.4-1/§0.4-4） */
export function delegationRecordId(company: string, grantorId: string, granteeId: string, deptPath: string): string {
  return `rec-auth-01:${company}:deleg:${grantorId}:${granteeId}:${deptPath}`
}

/** 授予范围（由部门职能/泳道派生；不可为边界显式列出——§2.2） */
function grantScopeOf(dept: RosterDept, isLeader: boolean): {
  purpose: string
  object: string
  included: string[]
  forbidden: string[]
} {
  const included = [
    `dept:${dept.path}`,
    ...dept.lanes.map((lane) => `lane:${lane}`),
    ...dept.functions.map((fn) => `function:${fn}`),
  ]
  if (isLeader) included.push(`dept-head:${dept.path}`)
  return {
    purpose: `${dept.path} 职能履行（${dept.functions.join('、')}）与泳道执行（${dept.lanes.join('、')}）`,
    object: dept.path,
    included,
    forbidden: [...GRANT_FORBIDDEN],
  }
}

/** 缺项原因（逐项点名，便于对账定位——不合并成一句「外部事实缺」） */
function missingRootFacts(fact: RootGrantFact | undefined): string[] {
  if (fact === undefined) {
    return [
      'root 授予事实未登记（REC-AUTH-01 grant_class=root_delegation 的外部事实逐项缺：' +
        'parent_grant/公司设立记录引用、key_fingerprint/operating root key 公开指纹、' +
        'external_signature 或 offline_approval_ref/外部证明件、term/期限、proof_verified 验签结论、fingerprint_matches 指纹比对结论）',
      '生产者＝#530 根委任启动接线（差距 #4）；本件不猜指纹、不冒充验签通过（v2/11 §2.2/§十五-2）',
    ]
  }
  const missing: string[] = []
  if (fact.establishmentRef.refId === '') missing.push('公司设立记录引用（parent_grant）')
  if (fact.keyFingerprint === '') missing.push('operating root key 公开指纹（key_fingerprint）')
  if (fact.externalSignatureRef === undefined && fact.offlineApprovalRef === undefined) {
    missing.push('外部签名件或离线批准件（external_signature/offline_approval_ref 二选一）')
  }
  if (fact.term.from === '' || fact.term.to === '') missing.push('授予期限（term.from..term.to）')
  if (!fact.proofVerified) missing.push('验签核验结论（proof_verified=false：未验过不得落库）')
  if (!fact.fingerprintMatches) missing.push('指纹比对结论（fingerprint_matches=false：与外部登记不符）')
  return missing
}

/**
 * 根授予草案（REC-AUTH-01 root_delegation；外部老板 → 顶位）。
 * 前置：①外部事实齐（缺口逐项拒）②顶位可从名册裁决 ③顶位在岗 ④顶位禁配申报（conflict_check_ref）已落。
 */
export function rootGrantDraft(args: {
  readonly roster: CompanyRoster
  readonly company: string
  readonly at: number
  readonly fact: RootGrantFact | undefined
  readonly conflictCheckRef: DraftRecordRef | undefined
}): DraftOutcome {
  const missing = missingRootFacts(args.fact)
  if (missing.length > 0) {
    return { ok: false, recordType: 'REC-AUTH-01', code: 'record-prereq-missing', reason: `根授予外部事实不齐：${missing.join('；')}` }
  }
  const fact = args.fact as RootGrantFact
  const top = topPersonOf(args.roster)
  if (top === undefined) {
    return {
      ok: false,
      recordType: 'REC-AUTH-01',
      code: 'record-prereq-missing',
      reason: '顶位不可裁决（根部门主管等级并列且职能同含「管理」）——授予人/受授人无法从名册确定，不猜',
    }
  }
  if (!isOnDuty(top)) {
    return { ok: false, recordType: 'REC-AUTH-01', code: 'record-prereq-missing', reason: `顶位 ${top.id} 非在岗（status=${top.status ?? '未登记'}）——非在岗不得受授（§七 独立性/§2.2）` }
  }
  if (args.conflictCheckRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-AUTH-01',
      code: 'record-prereq-missing',
      reason: `顶位 ${top.id} 的 REC-LIFE-05 累计禁配申报未落——conflict_check_ref 为 REC-AUTH-01 必填字段（§2.2）`,
    }
  }
  const at = isoAt(args.at)
  const scope = grantScopeOf(deptOf(args.roster, top.dept) as RosterDept, true)
  return {
    ok: true,
    // 族不变量二道闸（形状闸之后）：根授予三闸（授予人类别/验签结论/指纹比对）——判据唯一源=contract
    gate: {
      validate: (record) =>
        validateAuthGrant(record, { grantorClass: 'external_owner', proofVerified: fact.proofVerified, fingerprintMatches: fact.fingerprintMatches }),
    },
    draft: {
      recordType: 'REC-AUTH-01',
      recordId: rootGrantRecordId(args.company, top.id),
      producedAt: at,
      // 具名位置＝外部老板（不是 agent、不是最高宰相本人——§2.2 根授予授予人约束）
      decidedBy: EXTERNAL_OWNER.label,
      effectiveState: 'effective',
      effectiveFrom: fact.term.from,
      idempotencyKey: {
        recordType: 'REC-AUTH-01',
        subjectId: top.id,
        operationClass: 'root-grant',
        requesterSequence: 'root-1',
      },
      proofBoundary:
        '本记录证明：外部老板已按 v2/11 §2.2 根授予子类型向顶位授予权源（目的/对象/范围含不可为边界/条件/期限/退出/公开指纹/外部证明件引用）；' +
        '不证明密钥持有与行使（REC-AUTH-02 未落）；不证明本记录引用之外的外部法律效力；不证明下属转授边已成立（逐边另记）。',
      payload: {
        grantor: { refId: EXTERNAL_OWNER.refId, refVersion: EXTERNAL_OWNER.refVersion },
        grantee: personObjectRef(top.id),
        parent_grant: fact.establishmentRef,
        grant_class: 'root_delegation',
        scope,
        conditions: ['按公司目录职能/泳道范围行使', '越出 included 或落入 forbidden 即无效（§2.2）'],
        term: { from: fact.term.from, to: fact.term.to },
        delegable: true,
        withdrawal_terms: '外部老板可随时撤回（REC-AUTH-03，后代枚举＋停用证据）；轮换须新根授予，旧签名在停用完成后失效',
        conflict_check_ref: args.conflictCheckRef,
        key_fingerprint: fact.keyFingerprint,
        ...(fact.externalSignatureRef !== undefined ? { external_signature: fact.externalSignatureRef } : {}),
        ...(fact.offlineApprovalRef !== undefined ? { offline_approval_ref: fact.offlineApprovalRef } : {}),
        proof_mode: 'ritual_and_key',
        external_veto_configured: false,
      },
    },
  }
}

/**
 * 转授边（REC-AUTH-01 delegation）：上级位置 → 名册在岗人员。
 * 前置：①名册可裁决顶位 ②授予人＝顶位或部门主管且在岗 ③受授人在岗 ④双方禁配申报已落
 * ⑤父授予记录已成立（parent_grant 必须是已落库的 REC-AUTH-01，不引用未来记录）。
 */
export function delegationDraft(args: {
  readonly roster: CompanyRoster
  readonly company: string
  readonly at: number
  readonly grantorId: string
  readonly granteeId: string
  readonly dept: RosterDept
  readonly parentGrantRef: DraftRecordRef
  readonly parentTerm: { readonly from: string; readonly to: string }
  readonly grantorConflictCheckRef: DraftRecordRef | undefined
  readonly granteeConflictCheckRef: DraftRecordRef | undefined
}): DraftOutcome {
  const grantor = personOf(args.roster, args.grantorId)
  const grantee = personOf(args.roster, args.granteeId)
  if (grantor === undefined || grantee === undefined) {
    return {
      ok: false,
      recordType: 'REC-AUTH-01',
      code: 'record-prereq-missing',
      reason: `转授边两端不在名册（grantor=${args.grantorId}/grantee=${args.granteeId}）——不自造主体`,
    }
  }
  if (!isOnDuty(grantor) || !isOnDuty(grantee)) {
    return {
      ok: false,
      recordType: 'REC-AUTH-01',
      code: 'record-prereq-missing',
      reason: `转授边两端须均在岗（grantor=${grantor.id}/${grantor.status ?? '未登记'}，grantee=${grantee.id}/${grantee.status ?? '未登记'}）`,
    }
  }
  if (args.grantorId === args.granteeId) {
    return { ok: false, recordType: 'REC-AUTH-01', code: 'record-prereq-missing', reason: '授予人＝受授人（自授）——§七 独立性判负，拒写' }
  }
  if (args.grantorConflictCheckRef === undefined || args.granteeConflictCheckRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-AUTH-01',
      code: 'record-prereq-missing',
      reason: `转授边两端的 REC-LIFE-05 累计禁配申报未齐（grantor=${args.grantorConflictCheckRef === undefined ? '缺' : '有'}/grantee=${args.granteeConflictCheckRef === undefined ? '缺' : '有'}）——conflict_check_ref 必填（§2.2）`,
    }
  }
  const isLeader = args.dept.leader === args.granteeId
  const at = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType: 'REC-AUTH-01',
      recordId: delegationRecordId(args.company, args.grantorId, args.granteeId, args.dept.path),
      producedAt: at,
      decidedBy: args.grantorId,
      effectiveState: 'effective',
      effectiveFrom: isoAt(args.at),
      idempotencyKey: {
        recordType: 'REC-AUTH-01',
        subjectId: args.granteeId,
        operationClass: 'delegation',
        requesterSequence: args.dept.path,
      },
      proofBoundary:
        '本记录证明：上级位置按 v2/11 §2.2 向本人在岗位置转授部门范围内权源（范围取部门职能/泳道，不可为边界显式列出），父授予可溯至根授予；' +
        '不证明权源行使（REC-AUTH-02 未落）、不证明范围足够完成具体动作（逐动作 within_scope 核验归行使面）。',
      payload: {
        grantor: personObjectRef(args.grantorId),
        grantee: personObjectRef(args.granteeId),
        parent_grant: args.parentGrantRef,
        grant_class: 'delegation',
        scope: grantScopeOf(args.dept, isLeader),
        conditions: ['不得超出父授予目的/范围/条件/期限（v2/11 §2.2 I-6）', '部门变更即失效，须新记录'],
        term: { from: args.parentTerm.from, to: args.parentTerm.to },
        delegable: isLeader,
        withdrawal_terms: '上级位置或外部老板可撤回（REC-AUTH-03）；受授人离岗即失效',
        conflict_check_ref: args.granteeConflictCheckRef,
      },
    },
  }
}

/** 权源解析：某工号在给定动作范围上是否有覆盖授予（不可为边界优先；无覆盖＝undefined） */
export function coveringGrantOf(
  chain: AuthorityChain,
  personId: string,
  actionScope: string,
): DraftRecordRef | undefined {
  // 不可为边界优先：落在 forbidden 内的动作任何授予都不覆盖（含顶位根授予）
  if ((GRANT_FORBIDDEN as readonly string[]).includes(actionScope)) return undefined
  const exact = chain.delegations.find(
    (edge) => edge.granteeId === personId && edge.included.includes(actionScope),
  )
  if (exact !== undefined) {
    if (exact.forbidden !== undefined && exact.forbidden.includes(actionScope)) return undefined
    return grantRef(exact.recordId)
  }
  // 顶位：根授予覆盖（其 included 记录在 root 记录内，这里以记录存在性 + 顶位身份解析）
  if (chain.root !== undefined && chain.root.topId === personId) return grantRef(chain.root.recordId)
  return undefined
}

/** 派生用：部门主管的授予记录 id（转授边父引用；顶位时＝根授予） */
export function leaderGrantRecordId(company: string, topId: string, leaderId: string, deptPath: string): string {
  if (leaderId === topId) return rootGrantRecordId(company, topId)
  return delegationRecordId(company, topId, leaderId, deptPath)
}

/** 位置引用（LIFE-01 position_ref；供 life.ts 复用，避免双源） */
export { positionRefIdOf }
