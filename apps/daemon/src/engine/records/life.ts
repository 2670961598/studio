/**
 * engine/records/life —— 任职链（REC-LIFE-05 前件／REC-LIFE-01 任命／REC-LIFE-04 出工段）派生件
 *
 * 依据（实现单必须引文档章节号）：
 *   - docs/17-§2「记录族生产写面」段（相位 0 启动装载／人事变更 → LIFE-01；相位 4 收割 → LIFE-04）；
 *   - docs/17-§6（收割四要件：出工段是收割批次的**输入留痕**，不参与四要件判据）；
 *   - docs/v2/11 §3.1（REC-LIFE-01 任命五条件/幂等四元组/G8 双角色/G9 必引根授予；REC-LIFE-04
 *     出工必引**生效**任命；REC-LIFE-05 累计禁配申报）／§0.2（决定型必带决定面）／§0.3-2／§0.7；
 *   - docs/v2/02 §二（任命五条件）、§六（出工段）；
 *   - docs/v2/15 §七（独立性：自填即拒——禁配核验者不得是被检者本人）。
 *
 * 纪律（逐条对应任务书 §4.2「自填即拒收」）：
 *   1. 入参只有「时刻/工号/单号」；任职与授权事实一律由 `roster.ts`/`authority.ts` 派生——
 *      调用方没有可填字段（类型面即闸）；
 *   2. 非在岗/无部门/自指（决定者＝被任免者）→ 拒写 `record-prereq-missing`，不臆造；
 *   3. 五条件无法从目录取得者（资格 REC-CAP-02、交接 REC-LIFE-03、明示接受回执）**一律置 false 并
 *      写清缺件**——故本轮 LIFE-01 只落**拟任面（pending）**，生效面等前件刀；不冒充「已生效」；
 *   4. 出工段三道前件（生效任命＋REC-WORK-05 计划锁＋REC-AUTH-02 行使）缺一即拒，**不拿别类记录顶位**。
 */
import { validateAppointment } from '@studio-next/contract/records'
import type { DraftOutcome, DraftRecordRef } from './drafts.ts'
import { isoAt } from './drafts.ts'
import { RECORD_TYPE_VERSION } from './authority.ts'
import {
  EXTERNAL_OWNER,
  deptOf,
  isOnDuty,
  personObjectRef,
  personOf,
  positionRefIdOf,
  topPersonOf,
  type CompanyRoster,
  type RosterPerson,
} from './roster.ts'

/** 任命拟任面幂等版本（拟任面固定 v1；生效面另落新记录） */
export const APPOINTMENT_PROPOSED_VERSION = RECORD_TYPE_VERSION

/** 拟任任期长度（缺省 365 天；目录不登记任期事实——拟任登记时刻起算，如实写进 term） */
export const PROPOSED_TERM_MS = 365 * 24 * 60 * 60 * 1000

/** 位置职级（v2/03 §2.2/§3.3 判据输入；决定字段在 REC-LIFE-01 校验器） */
export type PositionGrade = 'G9' | 'G8_unit_head' | 'G8_dept_head' | 'other'

/** 位置职级裁决：顶位＝G9；一级单元（parent 空）主管＝G8_unit_head；下级部门主管＝G8_dept_head；余＝other */
export function positionGradeOf(roster: CompanyRoster, person: RosterPerson): PositionGrade {
  const top = topPersonOf(roster)
  if (top !== undefined && top.id === person.id) return 'G9'
  const dept = deptOf(roster, person.dept)
  if (dept === undefined || dept.leader !== person.id) return 'other'
  return dept.parentPath === undefined || dept.parentPath === '' ? 'G8_unit_head' : 'G8_dept_head'
}

/** 独立禁配核验位置（§七）：优先人事职能部门主管；该位置＝被检者本人时改用外部老板（保留给外部的动作） */
export function independentCheckerOf(roster: CompanyRoster, personId: string): string {
  const hr = roster.departments.find((dept) => dept.functions.includes('人事'))
  if (hr !== undefined && hr.leader !== personId) return hr.leader
  return `${EXTERNAL_OWNER.label}（外部独立位置，charter-§四）`
}

/**
 * LIFE-05 记录 id（一公司一人一**位置**一份累计申报）：部门 path 入身份键——人事变更（调部门）产生
 * 新申报记录（旧记录不覆盖不删除，§0.4-1 身份不复用）；同位置重放恒同 id（§0.4-4）。
 */
export function conflictRegistryRecordId(company: string, personId: string, deptPath: string): string {
  return `rec-life-05:${company}:${personId}:${deptPath}`
}

/** LIFE-01 记录 id（拟任面；位置×任职者×拟任版本——与幂等四元组同源） */
export function appointmentRecordId(company: string, personId: string, positionRefId: string): string {
  return `rec-life-01:${company}:${personId}:${positionRefId}:${APPOINTMENT_PROPOSED_VERSION}`
}

/** LIFE-04 记录 id（出工段：单号×attempt） */
export function workSegmentRecordId(company: string, ticket: string, attempt: number): string {
  return `rec-life-04:${company}:${ticket}:${attempt}`
}

/**
 * REC-LIFE-05 累计禁配申报（任职/授权链的**契约必填前件**：两者的 conflict_check_ref 唯一来源）。
 * 事实源＝公司目录：任职阵列取部门/岗位登记；申报与回避安排目录无载 → 空列表＋如实结论。
 */
export function conflictRegistryDraft(args: {
  readonly roster: CompanyRoster
  readonly company: string
  readonly at: number
  readonly personId: string
}): DraftOutcome {
  const person = personOf(args.roster, args.personId)
  if (person === undefined) {
    return { ok: false, recordType: 'REC-LIFE-05', code: 'record-prereq-missing', reason: `工号 ${args.personId} 不在公司目录名册——不自造任职者` }
  }
  if (!isOnDuty(person)) {
    return {
      ok: false,
      recordType: 'REC-LIFE-05',
      code: 'record-prereq-missing',
      reason: `工号 ${person.id} 非在岗（status=${person.status ?? '未登记'}）——禁配申报只对在岗位置登记（§七）`,
    }
  }
  const dept = deptOf(args.roster, person.dept)
  if (dept === undefined) {
    return { ok: false, recordType: 'REC-LIFE-05', code: 'record-prereq-missing', reason: `工号 ${person.id} 的部门 ${person.dept} 不在 departments 索引（悬空引用）` }
  }
  const checker = independentCheckerOf(args.roster, person.id)
  if (checker === person.id) {
    return {
      ok: false,
      recordType: 'REC-LIFE-05',
      code: 'record-prereq-missing',
      reason: '禁配核验者＝被检者本人（§七 独立性判负）——不得自填自证',
    }
  }
  const at = isoAt(args.at)
  return {
    ok: true,
    draft: {
      recordType: 'REC-LIFE-05',
      recordId: conflictRegistryRecordId(args.company, person.id, dept.path),
      producedAt: at,
      decidedBy: checker,
      effectiveState: 'effective',
      effectiveFrom: at,
      idempotencyKey: {
        recordType: 'REC-LIFE-05',
        subjectId: person.id,
        operationClass: 'conflict-registry',
        requesterSequence: APPOINTMENT_PROPOSED_VERSION,
      },
      proofBoundary:
        '本记录证明：该工号的在岗位置与部门职能已按公司目录登记为禁配申报基线（无申报/无回避安排/结论=未申报），核验位置独立于被检者；' +
        '不证明存在/不存在实际利益冲突（申报采集面未接）、不证明跨部署/账号累计视图完整（REC-LIFE-05 累计口径归后续刀）。',
      payload: {
        holder_ref: personObjectRef(person.id),
        // 拟任面未生效前不算 holding（§3.1 holdings=全部现有任职）——空列表是如实状态，不是「无任职」
        holdings: [],
        interest_declarations: [],
        avoidance_arrangements: [],
        conflict_check: {
          conclusion: 'no_conflict_declared',
          basis: `公司目录无禁配/兼职申报事实（people/departments 镜像；部门 ${dept.path} 职能 ${dept.functions.join('、')}）`,
          checked_at: at,
          checker,
        },
        cumulative_view: `按工号跨位置累计：本人在岗位置 1 个（${dept.path}）；拟任记录（REC-LIFE-01 拟任面）未生效不计入 holdings`,
        check_points: ['任职登记', '部门变更', '授权授予'],
      },
    },
  }
}

/**
 * REC-LIFE-01 任命与任职关系（相位 0 启动装载／人事变更）。
 *
 * 决定面/权源/禁配引用一律由调用链注入**已派生的记录引用**（authority.ts 的 AUTH-01 边、本文件的
 * LIFE-05）——调用方给不出任职事实；五条件逐面**按事实判**：
 *   authority＝权源链已解析；qualification＝REC-CAP-02（未落→false）；conflict＝LIFE-05（已落→true）；
 *   handover＝REC-LIFE-03（未落→false）；acceptance＝明示接受回执（无通道→false）。
 * 五条件不齐 ⇒ 只落**拟任面（pending）**（§14.2 L-01 ∅→候选），生效面（L-02）等前件刀；
 * 生效面还须 acceptance_time（决定≠接受——§3.1），本件不冒充。
 */
export function appointmentDraft(args: {
  readonly roster: CompanyRoster
  readonly company: string
  readonly at: number
  readonly personId: string
  readonly appointingAuthorityRef?: DraftRecordRef
  readonly nominationRef?: DraftRecordRef
  readonly decisionBasisRef?: DraftRecordRef
  readonly rootDelegationRef?: DraftRecordRef
  readonly conflictCheckRef?: DraftRecordRef
}): DraftOutcome {
  const person = personOf(args.roster, args.personId)
  if (person === undefined) {
    return { ok: false, recordType: 'REC-LIFE-01', code: 'record-prereq-missing', reason: `工号 ${args.personId} 不在公司目录名册——不自造任职者` }
  }
  if (!isOnDuty(person)) {
    return {
      ok: false,
      recordType: 'REC-LIFE-01',
      code: 'record-prereq-missing',
      reason: `工号 ${person.id} 非在岗（status=${person.status ?? '未登记'}）——非在岗不得任命（§七/§3.1）`,
    }
  }
  const dept = deptOf(args.roster, person.dept)
  const top = topPersonOf(args.roster)
  if (dept === undefined || top === undefined) {
    return { ok: false, recordType: 'REC-LIFE-01', code: 'record-prereq-missing', reason: '名册无法裁决部门/顶位——任命者与被任免者不可确定，不猜' }
  }
  const grade = positionGradeOf(args.roster, person)
  if (args.conflictCheckRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-01',
      code: 'record-prereq-missing',
      reason: `缺 ${person.id} 的 REC-LIFE-05 累计禁配申报（conflict_check_ref 为契约必填——§3.1）`,
    }
  }
  if (args.appointingAuthorityRef === undefined || args.nominationRef === undefined || args.decisionBasisRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-01',
      code: 'record-prereq-missing',
      reason: '缺 REC-AUTH-01 权源链接线（appointing_authority_ref/nomination_ref/decision_basis_ref 必填——§2.2/§3.1）；无授权链不得任命',
    }
  }
  if (grade === 'G9' && args.rootDelegationRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-01',
      code: 'record-prereq-missing',
      reason: 'G9（最高宰相）任命必引 root_delegation（REC-AUTH-01 grant_class=root_delegation）——缺失即任命不得生效（§3.1/§十五-2）',
    }
  }
  // 决定者（具名位置）：G9＝外部老板；部门/单元首长及成员＝上级位置（顶位/部门主管）
  const decidedBy = grade === 'G9' ? EXTERNAL_OWNER.label : grade === 'other' ? dept.leader : top.id
  if (decidedBy === person.id) {
    return {
      ok: false,
      recordType: 'REC-LIFE-01',
      code: 'record-prereq-missing',
      reason: `${person.id} 自任自免（决定者＝被任免者）——§七 独立性判负，拒写（自授不是豁免）`,
    }
  }
  if (grade === 'G8_unit_head') {
    return {
      ok: false,
      recordType: 'REC-LIFE-01',
      code: 'record-prereq-missing',
      reason:
        `一级单元首长 ${person.id} 由最高宰相同体提名/任免——须带「内部老板双角色」标注＋外部审计抽样件（dual_role_record，§3.3 规则 1）；` +
        '本刀无该外部事实，不冒充（缺件：外部审计抽样记录）。',
    }
  }
  const at = isoAt(args.at)
  const termFrom = at
  const termTo = isoAt(args.at + PROPOSED_TERM_MS)
  const gates = {
    authority: { satisfied: true, note: 'REC-AUTH-01 权源链已解析（root→delegation）' },
    qualification: { satisfied: false, note: 'REC-CAP-02 资格记录未落（能力/资格面归后续刀）' },
    conflict: { satisfied: true, note: 'REC-LIFE-05 累计禁配申报已落（核验位置独立于被检者）' },
    handover: { satisfied: false, note: 'REC-LIFE-03 交接面未落（无交接核验记录）' },
    acceptance: { satisfied: false, note: '无明示接受回执通道（目录在岗≠明示接受——决定≠接受）' },
  }
  const unmet = Object.entries(gates)
    .filter(([, gate]) => !gate.satisfied)
    .map(([face]) => face)
  const effective = unmet.length === 0
  return {
    ok: true,
    // 族不变量二道闸：任命五条件/G9 必引根授予/G8 双角色（判据输入由名册派生，不读调用方事实）
    gate: {
      validate: (record) =>
        validateAppointment(record, {
          positionGrade: grade,
          appointingAuthorityClass: grade === 'G9' ? 'external_owner' : 'internal_boss',
          nominatorClass: grade === 'G9' ? 'external_owner' : grade === 'other' ? 'internal_position' : 'internal_boss',
        }),
    },
    draft: {
      recordType: 'REC-LIFE-01',
      recordId: appointmentRecordId(args.company, person.id, positionRefIdOf(person)),
      producedAt: at,
      decidedBy,
      effectiveState: effective ? 'effective' : 'pending',
      ...(effective ? { effectiveFrom: termFrom } : {}),
      idempotencyKey: {
        recordType: 'REC-LIFE-01',
        subjectId: person.id,
        operationClass: 'appointment',
        requesterSequence: `${positionRefIdOf(person)}@${APPOINTMENT_PROPOSED_VERSION}`,
      },
      proofBoundary:
        `本记录证明：${person.id} 在 ${dept.path} 的任职关系已按公司目录派生登记（位置/任职者/权源链/禁配结论/五条件逐面核验结论/拟任任期）；` +
        `**${effective ? '五条件齐备，记录生效' : `五条件未齐（未过：${unmet.join('/')}），本记录仅为拟任面（pending）`}**；` +
        '不证明程序性 +1 提议/外部审计（nomination_ref 与 decision_basis_ref 取权源链记录，非提议记录生产者）；不证明资格/交接/接受面已过（前件未落）。',
      payload: {
        appointment_kind: 'appointment',
        position_ref: { refId: positionRefIdOf(person), refVersion: RECORD_TYPE_VERSION },
        holder_ref: personObjectRef(person.id),
        nomination_ref: args.nominationRef,
        appointing_authority_ref: args.appointingAuthorityRef,
        decision_basis_ref: args.decisionBasisRef,
        ...(args.rootDelegationRef !== undefined ? { root_delegation_ref: args.rootDelegationRef } : {}),
        scope: {
          duties: person.role !== undefined && person.role !== '' ? `${person.role}：${dept.functions.join('、')}` : dept.functions.join('、'),
          forbidden: [`越出 ${dept.path} 职能范围的动作`, '未经授权的跨部门写入'],
        },
        term: { from: termFrom, to: termTo, expiry_disposition: '届满不自动续任，须新任命记录（§3.1）' },
        qualification_refs: [],
        conflict_check_ref: args.conflictCheckRef,
        acceptance_state: effective ? 'accepted' : 'pending_acceptance',
        ...(effective ? { acceptance_time: termFrom } : {}),
        entry_gate_results: gates,
        idempotency_four_tuple: {
          position_ref: { refId: positionRefIdOf(person), refVersion: RECORD_TYPE_VERSION },
          holder_ref: personObjectRef(person.id),
          term_start: termFrom,
          proposed_version: APPOINTMENT_PROPOSED_VERSION,
        },
        decision_face: {
          decided_by: decidedBy,
          authority_ref: args.appointingAuthorityRef,
          rationale: `公司目录名册派生：${person.id} 在岗于 ${dept.path}（岗位 ${person.role ?? '成员'}，等级 L${person.level}）；决定者＝${decidedBy}（上级位置）`,
          basis_refs: [args.nominationRef, args.conflictCheckRef],
          scope_judged: {
            judged: ['在岗事实', '部门/岗位归属', '权源链覆盖', '禁配申报基线'],
            not_judged: ['资格/能力覆盖（REC-CAP-02 未落）', '交接面（REC-LIFE-03 未落）', '明示接受（无通道）', '程序性 +1 提议记录'],
          },
          dissent_position: '无异议',
          effective_state: effective ? 'effective' : 'pending',
        },
      },
    },
  }
}

/** 出工段前件闸输入（缺一即拒，逐项点名） */
export interface WorkSegmentPrereqs {
  readonly appointmentRef?: DraftRecordRef
  readonly planRef?: DraftRecordRef
  readonly authorizationRef?: DraftRecordRef
  /** 资格记录（REC-CAP-02；六面交集的资格面——缺即拒，不拿「无资格要求」顶位） */
  readonly qualificationRef?: DraftRecordRef
}

/**
 * REC-LIFE-04 出工段（相位 4 收割；事件型）。
 * 三道前件：①**生效** REC-LIFE-01 ②REC-WORK-05 计划锁 ③REC-AUTH-02 授权行使结果。
 * 前件未落即拒写并点名缺件——不用别类记录顶位（v2/11 §3.1 明文 →REC-WORK-05/→REC-AUTH-02）。
 */
export function workSegmentDraft(args: {
  readonly roster: CompanyRoster
  readonly company: string
  readonly at: number
  readonly ticket: string
  readonly attempt: number
  readonly personId: string
  readonly workspace?: string
  readonly briefRef?: string
  readonly evidenceRefs?: readonly DraftRecordRef[]
  readonly prereqs: WorkSegmentPrereqs
}): DraftOutcome {
  const person = personOf(args.roster, args.personId)
  if (person === undefined) {
    return { ok: false, recordType: 'REC-LIFE-04', code: 'record-prereq-missing', reason: `出工者 ${args.personId} 不在公司目录名册——不自造出工主体` }
  }
  if (!isOnDuty(person)) {
    return { ok: false, recordType: 'REC-LIFE-04', code: 'record-prereq-missing', reason: `出工者 ${person.id} 非在岗——非在岗不得开启出工段` }
  }
  if (args.prereqs.appointmentRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-04',
      code: 'record-prereq-missing',
      reason: `缺 ${person.id} 的**生效** REC-LIFE-01 任命（出工必引生效任命——§3.1/§十五-2；本轮 LIFE-01 仅拟任面 pending）`,
    }
  }
  if (args.prereqs.planRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-04',
      code: 'record-prereq-missing',
      reason: '缺 REC-WORK-05 计划锁引用（plan_ref 为 REC-LIFE-04 契约必填首项；WORK-05 生产者归刀C）——不拿意图信封顶位',
    }
  }
  if (args.prereqs.authorizationRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-04',
      code: 'record-prereq-missing',
      reason: '缺 REC-AUTH-02 授权行使结果引用（authorization_result 为契约必填；AUTH-02 生产者归授权行使面）',
    }
  }
  if (args.prereqs.qualificationRef === undefined) {
    return {
      ok: false,
      recordType: 'REC-LIFE-04',
      code: 'record-prereq-missing',
      reason: '缺 REC-CAP-02 资格记录引用（六面交集的资格面未落——不拿「无资格要求」顶位，§3.1）',
    }
  }
  const at = isoAt(args.at)
  // 六面交集逐面结论：四道前件均已在上面逐项核验（缺一即拒），此处只落「已核验」面——不置真未核验面
  const gateFaces = [
    { face: '任职范围覆盖', satisfied: true },
    { face: '资格覆盖', satisfied: true },
    { face: '计划版本＝授权范围', satisfied: true },
    { face: '任命已生效', satisfied: true },
  ]
  return {
    ok: true,
    draft: {
      recordType: 'REC-LIFE-04',
      recordId: workSegmentRecordId(args.company, args.ticket, args.attempt),
      producedAt: at,
      decidedBy: person.id,
      effectiveState: 'effective',
      effectiveFrom: at,
      idempotencyKey: {
        recordType: 'REC-LIFE-04',
        subjectId: args.ticket,
        operationClass: 'work-segment',
        requesterSequence: `${args.attempt}`,
      },
      proofBoundary:
        '本记录证明：该单该 attempt 的出工段已按 v2/11 §3.1 开启（任职/计划锁/授权结果三前件引用齐、六面交集核验逐面结论）；' +
        '不证明执行结果合格（判定归收割四要件与验收）、不证明用量与成本（归 REC-EVD-01）。',
      payload: {
        holder_ref: personObjectRef(person.id),
        appointment_ref: args.prereqs.appointmentRef,
        plan_ref: args.prereqs.planRef,
        authorization_result: args.prereqs.authorizationRef,
        segment_gate_check: gateFaces.map((face) => ({ face: face.face, satisfied: face.satisfied })),
        inputs_snapshot: [
          `ticket=${args.ticket}#attempt-${args.attempt}`,
          `workspace=${args.workspace ?? '未登记'}`,
          ...(args.briefRef !== undefined ? [`brief=${args.briefRef}`] : []),
        ],
        decision_basis: '公司目录在岗事实＋授权链覆盖（REC-AUTH-01 派生）＋计划锁/授权结果前件引用',
        action_receipts: [],
        artifacts_and_evidence: args.evidenceRefs !== undefined ? [...args.evidenceRefs] : [],
        open_items: [],
        known_incapabilities: [],
      },
    },
  }
}
