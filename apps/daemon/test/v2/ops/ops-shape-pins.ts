/**
 * ops-shape-pins —— PORT-OPS 请求形状类型级钉面（OPS 补形 A；只供 `typecheck:v2`）
 *
 * 定位：**编译期**钉住 REC-WORK-18 必填面——缺 actionsTaken/review/notified、裸名串
 * （缺 refVersion）、预设边界缺 boundaryRecordRef 均在类型层拒；本文件不被 vitest 收集
 * （非 .test.ts），由 ops-contract.test.ts 导入只证存在。
 *
 * 依据：docs/v2/14 §1.8（PORT-OPS 请求形状）、docs/v2/11 §六 REC-WORK-18、docs/49「OPS 补形 A」。
 * 纪律：引用版本只由调用方显式给（不硬编码/不臆造）；`@ts-expect-error` 放行即红。
 */
import type * as Ops from '@studio-next/contract'

const AUTHORIZATION: Ops.OpsAuthorization = { poweredBy: 'decision', decisionRef: 'REC-DEC-01' }
const REVIEW: Ops.EmergencyReview = { reviewerRef: 'audit-1', due: '2026-11-02T00:00:00Z' }
const BOUNDARY: Ops.OpsRecordRef = { refType: 'REC-AUTH-01', refId: 'boundary-1', refVersion: '2.1.0' }
const EVIDENCE: Ops.OpsRef[] = [{ refId: 'evidence-1', refVersion: '1.0.0' }]
const NOTIFIED: [Ops.OpsRef, ...Ops.OpsRef[]] = [{ refId: 'G9.internal-boss', refVersion: '1.0.0' }]

/** 最小合法面＋关键拒绝条件的类型级钉子（只编译、不执行端口逻辑） */
export function compileOnlyOpsShapePins(): void {
  // —— 正向：两请求都能落 REC-WORK-18 全字段 ——
  const stop: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: true, boundaryRef: 'boundary-1', boundaryRecordRef: BOUNDARY, permittedActions: ['停止对外写入'] },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: EVIDENCE,
    notified: NOTIFIED,
    review: REVIEW,
  }
  const stopOpen: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损（无预设边界）',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    actionsTaken: ['保全现场'],
    notAuthorized: ['未进入禁止/保留权限'],
    evidencePreserved: [],
    notified: NOTIFIED,
    review: REVIEW,
  }
  const circuit: Ops.CircuitBreakRequest = {
    authorization: AUTHORIZATION,
    reason: '止损围栏',
    requiresPlatformWrite: false,
    target: { kind: 'work', workRef: 'REC-WORK-03' },
    fence: { scope: ['executors'], stopInjection: true, revokeDerived: false, mechanismProven: false },
    triggerRef: 'REC-WORK-17',
    actionsTaken: ['冻结旧写入者'],
    notAuthorized: ['未撤销派生执行体'],
    evidencePreserved: EVIDENCE,
    notified: NOTIFIED,
    review: REVIEW,
  }
  void stop
  void stopOpen
  void circuit

  // —— 负向：紧急止损缺 REC-WORK-18 必填项 ——
  // @ts-expect-error —— actionsTaken 必填（实际处置动作，min1）
  const stopNoActions: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [],
    notified: NOTIFIED,
    review: REVIEW,
  }
  // @ts-expect-error —— review 必填（事后独立复核）
  const stopNoReview: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [],
    notified: NOTIFIED,
  }
  // @ts-expect-error —— notified 必填（具名接收者，min1）
  const stopNoNotified: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [],
    review: REVIEW,
  }
  const stopBareNotified: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [],
    // @ts-expect-error —— notified 只收显式版本引用（裸名串缺 refVersion，不臆造）
    notified: ['G9.internal-boss'],
    review: REVIEW,
  }
  const stopEvidenceWithoutVersion: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    // @ts-expect-error —— 保全物 refVersion 必须显式提供（不硬编码版本）
    evidencePreserved: [{ refId: 'evidence-1' }],
    notified: NOTIFIED,
    review: REVIEW,
  }
  const stopBoundaryWithoutRecordRef: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    // @ts-expect-error —— 预设边界落记录须携 boundaryRecordRef（RecordRef 显式版本）
    boundary: { preset: true, boundaryRef: 'boundary-1', permittedActions: ['停止对外写入'] },
    actionsTaken: ['停止对外写入'],
    notAuthorized: ['未进入禁止面'],
    evidencePreserved: [],
    notified: NOTIFIED,
    review: REVIEW,
  }
  const stopEmptyNotAuthorized: Ops.EmergencyStopRequest = {
    authorization: AUTHORIZATION,
    reason: '紧急止损',
    requiresPlatformWrite: false,
    triggerRef: 'REC-WORK-17',
    boundary: { preset: false, escalationRef: 'escalation-1', prohibitedAmplification: true },
    actionsTaken: ['停止对外写入'],
    // @ts-expect-error —— not_authorized 非空元组（空集不得冒充「未越权」）
    notAuthorized: [],
    evidencePreserved: [],
    notified: NOTIFIED,
    review: REVIEW,
  }
  void stopNoActions
  void stopNoReview
  void stopNoNotified
  void stopBareNotified
  void stopEvidenceWithoutVersion
  void stopBoundaryWithoutRecordRef
  void stopEmptyNotAuthorized

  // —— 负向：止损围栏缺 REC-WORK-18 必填项 ——
  const fence: Ops.FenceDeclaration = { scope: ['executors'], stopInjection: true, revokeDerived: false, mechanismProven: false }
  // @ts-expect-error —— actionsTaken 必填
  const circuitNoActions: Ops.CircuitBreakRequest = {
    authorization: AUTHORIZATION,
    reason: '止损围栏',
    requiresPlatformWrite: false,
    target: { kind: 'work', workRef: 'REC-WORK-03' },
    fence,
    triggerRef: 'REC-WORK-17',
    notAuthorized: ['未撤销派生执行体'],
    evidencePreserved: [],
    notified: NOTIFIED,
    review: REVIEW,
  }
  // @ts-expect-error —— review 必填
  const circuitNoReview: Ops.CircuitBreakRequest = {
    authorization: AUTHORIZATION,
    reason: '止损围栏',
    requiresPlatformWrite: false,
    target: { kind: 'work', workRef: 'REC-WORK-03' },
    fence,
    triggerRef: 'REC-WORK-17',
    actionsTaken: ['冻结旧写入者'],
    notAuthorized: ['未撤销派生执行体'],
    evidencePreserved: [],
    notified: NOTIFIED,
  }
  // @ts-expect-error —— notified 必填
  const circuitNoNotified: Ops.CircuitBreakRequest = {
    authorization: AUTHORIZATION,
    reason: '止损围栏',
    requiresPlatformWrite: false,
    target: { kind: 'work', workRef: 'REC-WORK-03' },
    fence,
    triggerRef: 'REC-WORK-17',
    actionsTaken: ['冻结旧写入者'],
    notAuthorized: ['未撤销派生执行体'],
    evidencePreserved: [],
    review: REVIEW,
  }
  void circuitNoActions
  void circuitNoReview
  void circuitNoNotified
}
