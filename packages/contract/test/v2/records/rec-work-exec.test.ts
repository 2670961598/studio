/**
 * rec-work-exec.test.ts —— WORK 结清/协作/承诺/异常 10..18＋三条具名类「一正一负」
 * （MIG-03 / IMPL-03-02；NEG-REC-04 底行）
 *
 * 依据：v2/17 §4.3 NEG-REC-04（结清不结派生面/动作充数/静默恢复/相对方验收等 W 族负形态，V1 形状腿）｜
 *   v2/11 §5.2/§5.3/§5.4（10..18＋ACCEPT-MAINT/HANDOVER/COMMIT-CHANGE 字段与不变量）、§14.1 M-24..M-28｜
 *   v2/09 ENU-10/11/15/17/19/20/21/22/23/24/25/26/27/28/107/124/126/127。
 * 拆件：夹具在 fixtures-work.ts；01..09＋74 类登记齐在 rec-work-intent.test.ts。
 */
import { describe, expect, it } from 'vitest'
import { deriveWorkSettledState, validateReworkRecord, validateReopenRecord, validateWorkSettlement, validateCollaborationRequest, validateObligationInstance, validateCommitment, validateFulfillmentMapping, validateExceptionRecord, validateEmergencyStop, validateMaintenanceAcceptance, validateHandoverPackage, validateCommitmentChange, WORK_SETTLEMENT_ITEMS, HANDOVER_ITEMS } from '../../../src/records/work.ts'
import { reworkPayload, reopenPayload, settlementPayload, handoverPayload, commitmentChangePayload, collaborationPayload, obligationPayload, commitmentPayload, fulfillmentPayload, exceptionPayload, emergencyStopPayload, maintPayload, PROOF } from './fixtures-work.ts'
import { AT, envelope, issuePaths, ref } from './fixtures.ts'

describe('WORK 10..18＋ACCEPT-MAINT/HANDOVER/COMMIT-CHANGE 正例', () => {

  it('10 返工记录：原因归类＋阈值状态未达 → 放行', () => {
    expect(validateReworkRecord(envelope('REC-WORK-10', reworkPayload()))).toEqual({ ok: true })
  })

  it('11 重开记录：终态复核动作（不产生状态回退）＋原结论标注 → 放行', () => {
    expect(validateReopenRecord(envelope('REC-WORK-11', reopenPayload()), { reopensTerminal: true, acceptedAction: true })).toEqual({ ok: true })
  })

  it('12 工作结清：九项关闭＋四态按推导＋记忆分流＋价值引用 → 放行', () => {
    expect(validateWorkSettlement(envelope('REC-WORK-12', settlementPayload()))).toEqual({ ok: true })
  })

  it('12 结清四态推导写死（未结清＞转入清算＞保留＞完全）', () => {
    expect(deriveWorkSettledState([{ state: 'closed' }])).toBe('fully_settled')
    expect(deriveWorkSettledState([{ state: 'open' }, { state: 'closed', into_liquidation: true }])).toBe('unsettled')
    expect(deriveWorkSettledState([{ state: 'closed', into_liquidation: true }])).toBe('into_liquidation')
    expect(deriveWorkSettledState([{ state: 'reservation' }])).toBe('settled_with_reservations')
  })

  it('13 派工请求：携要件、未响应到期升级 → 放行', () => {
    expect(validateCollaborationRequest(envelope('REC-WORK-13', collaborationPayload()))).toEqual({ ok: true })
  })

  it('14 义务实例：权源与接受分开、已结清有判断者 → 放行', () => {
    expect(validateObligationInstance(envelope('REC-WORK-14', obligationPayload()))).toEqual({ ok: true })
  })

  it('15 具体承诺：相对方与兑现判据齐备 → 放行', () => {
    expect(validateCommitment(envelope('REC-WORK-15', commitmentPayload()))).toEqual({ ok: true })
  })

  it('16 履约对应：派生状态 at_risk 且未声称已兑现 → 放行', () => {
    expect(validateFulfillmentMapping(envelope('REC-WORK-16', fulfillmentPayload()))).toEqual({ ok: true })
  })

  it('17 异常记录：具名接收＋升级链＋终局缺省（未终局）→ 放行', () => {
    expect(validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload()))).toEqual({ ok: true })
  })

  it('18 紧急止损：预设边界内保全＋事后独立复核 → 放行', () => {
    expect(validateEmergencyStop(envelope('REC-WORK-18', emergencyStopPayload()))).toEqual({ ok: true })
  })

  it('ACCEPT-MAINT：双指标分判＋独立抽样＋维持结论 → 放行', () => {
    expect(validateMaintenanceAcceptance(envelope('REC-WORK-ACCEPT-MAINT', maintPayload(), PROOF))).toEqual({ ok: true })
  })

  it('HANDOVER：十项齐备＋连续性四问＋派生面清点 → 放行', () => {
    expect(validateHandoverPackage(envelope('REC-WORK-HANDOVER', handoverPayload()))).toEqual({ ok: true })
  })

  it('COMMIT-CHANGE：四段逐段留痕＋僵局计时＋原口径在途结算 → 放行', () => {
    expect(validateCommitmentChange(envelope('REC-WORK-COMMIT-CHANGE', commitmentChangePayload()))).toEqual({ ok: true })
  })

})

describe('NEG-REC-04 结清/协作/承诺/异常拒绝条件', () => {

  it('结清不结派生面：转入清算却无派生面证据与承接 → 拒（W-12/L3E-01）', () => {
    const payload = settlementPayload({
      items: [{ item: 'artifact', state: 'closed', into_liquidation: true }, ...WORK_SETTLEMENT_ITEMS.filter((item) => item !== 'artifact').map((item) => ({ item, state: 'closed' }))],
      settled_state: 'into_liquidation',
    })
    const outcome = validateWorkSettlement(envelope('REC-WORK-12', payload), { workTerminated: true, touchedSensitive: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.derived_face_evidence')
    expect(issuePaths(outcome)).toContain('payload.handover_ref')
  })

  it('结清四态自报（逐项含未结清却声称完全结清）→ 拒（L3E-13）', () => {
    const items = WORK_SETTLEMENT_ITEMS.map((item) => ({ item, state: item === 'resource' ? 'open' : 'closed' }))
    const outcome = validateWorkSettlement(envelope('REC-WORK-12', settlementPayload({ items })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.settled_state')
  })

  it('请求授权未响应却按默认授权处理 → 拒（ENU-25）', () => {
    const payload = collaborationPayload({ action_kind: 'request_authority', no_response_effect: 'silence_not_consent' })
    const outcome = validateCollaborationRequest(envelope('REC-WORK-13', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.no_response_effect')
  })

  it('已兑现无相对方验收引用 → 拒（L3E-06）', () => {
    const outcome = validateFulfillmentMapping(envelope('REC-WORK-16', fulfillmentPayload({ derived_status: 'fulfilled' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.counterparty_acceptance')
  })

  it('内部任务冒称对外承诺 → 拒（§5.3）', () => {
    const outcome = validateCommitment(envelope('REC-WORK-15', commitmentPayload()), { internalOnly: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.commitment_kind')
  })

  it('异常接收者写「系统」→ 拒（L3E-16）', () => {
    const outcome = validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload({ receiver: '系统' })))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.receiver')
  })

  it('未终局被当作已结案 → 拒（无终局的异常状态本身是异常）', () => {
    const outcome = validateExceptionRecord(envelope('REC-WORK-17', exceptionPayload()), { treatedAsClosed: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.terminal')
  })

  it('维持性验收以收割四要件替代 → 拒（W-07）', () => {
    const outcome = validateMaintenanceAcceptance(envelope('REC-WORK-ACCEPT-MAINT', maintPayload(), PROOF), { fourElementsOnly: true })
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('recordType')
  })

  it('交接包缺项留空（十项缺一）→ 拒（§5.2）', () => {
    const payload = handoverPayload({ items: HANDOVER_ITEMS.slice(0, 9).map((item) => ({ item, present: true })) })
    const outcome = validateHandoverPackage(envelope('REC-WORK-HANDOVER', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.items')
  })

  it('承诺变更四段缺「相对方表达」→ 拒（段序不可跳）', () => {
    const payload = commitmentChangePayload({
      stages: [
        { stage: 'application', at: AT, actor: 'g9.internal-boss', materials: [ref('REC-WORK-15')] },
        { stage: 'decision', at: AT, actor: 'g9.internal-boss', materials: [ref('REC-WORK-15')] },
      ],
    })
    const outcome = validateCommitmentChange(envelope('REC-WORK-COMMIT-CHANGE', payload))
    expect(outcome.ok).toBe(false)
    expect(issuePaths(outcome)).toContain('payload.stages')
  })

})
