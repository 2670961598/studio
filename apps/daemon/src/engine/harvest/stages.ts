/**
 * harvest/stages —— 判断分级与验收输入可用性（X2/X3/X4；NEG-REC-05 / NEG-EVD-01）
 *
 * 规格依据：
 *   - docs/v2/08 §1.5（五类判断不合并：执行结果不能推出完成/验收/结清）、§1.4（收割批次是
 *     EX-2+ 验收判断的强制输入；完整性存疑不得判接受）、§0.2-3（自供不成独立）；
 *   - docs/v2/11 §六 REC-EVD-01（观察与输入，不是判断）、REC-WORK-12（结清核验者≠责任者）；
 *   - docs/v2/17 NEG-EVD-01（自述与独立两分，对账差异非空即判负）／NEG-REC-05
 *     （X2 事件冒验收／X3 回执冒验收／X4 验收冒结清——完成分级三分离校验拒）；
 *   - docs/plan/05 IMPL-06-03（engine 拆分·收割域；冻结验收 NEG-EVD-01 分级）。
 *
 * 本件只出**分级口径与输入可用性**：执行观察归收割批次；验收/结清恒 `not_judged`
 * （归独立验收/核验位置）。不新增记录类/端口，不做验收或结清判断。
 */
import { HARVEST_INDEPENDENCE_DECLARATION, type HarvestBatchView } from './batch.ts'

// ————————————————————————— 一、三判不合并（X2/X3/X4）与验收输入可用性 —————————————————————————

/** 判断阶段（五类判断不合并——v2/08 §1.5） */
export type HarvestStage = 'execution' | 'acceptance' | 'settlement'

/** 阶段边界（state 只『observed』与『not_judged』两值：本件不产出验收/结清判断） */
export interface HarvestStageBoundary {
  readonly stage: HarvestStage
  readonly state: 'observed' | 'not_judged'
  readonly judgedBy: string
  readonly proves: readonly string[]
  readonly doesNotProve: readonly string[]
}

/**
 * X2/X3/X4 分级口径（NEG-REC-05 / NEG-EVD-01）：
 *   - X2 事件冒验收：执行面报「完成」≠工作已接受——执行观察只到 stages.execution；
 *   - X3 回执冒验收：闸门退出码/平台回执只证写入与可复算事实，不证符合口径；
 *   - X4 验收冒结清：结清是「还剩什么没关闭」，验收接受不推出结清（REC-WORK-12）。
 */
export const HARVEST_STAGE_BOUNDARIES: readonly HarvestStageBoundary[] = [
  {
    stage: 'execution',
    state: 'observed',
    judgedBy: '框架收割通道（framework.daemon.harvest）＋闸门执行器（机械采集）',
    proves: ['执行面终态/输出/REPORT/闸门退出码被观察（四要件＝执行完成判据）'],
    doesNotProve: ['验收合格', '结清', '价值'],
  },
  {
    stage: 'acceptance',
    state: 'not_judged',
    judgedBy: '独立验收位置（验者≠交付者——v2/04 §六；EX-2+ 另需独立收割最小主体，DEC-OPEN-13 未裁）',
    proves: [],
    doesNotProve: ['X2：执行事件/终态即验收合格', 'X3：平台回执/闸门退出码即验收合格', '收割批次可自判接受'],
  },
  {
    stage: 'settlement',
    state: 'not_judged',
    judgedBy: '独立核验位置（核验者≠责任者及其控制者——REC-WORK-12）',
    proves: [],
    doesNotProve: ['X4：验收接受即结清', '接受不推出结清（结清清单逐项）'],
  },
]

/** 三判分级只读面（测试/审计的固定口径；本件不产出第三、四类判断） */
export function gradeHarvestStages(): readonly HarvestStageBoundary[] {
  return HARVEST_STAGE_BOUNDARIES
}

/** 验收输入可用性（**输入**不是判断：acceptance/settlement 恒 not_judged） */
export interface AcceptanceInputView {
  /** 可作验收输入（完整性/关系要件/幂等无冲突）——仍不得自我宣布接受 */
  readonly usable: boolean
  readonly reasons: readonly string[]
  readonly notes: readonly string[]
  readonly acceptance: 'not_judged'
  readonly settlement: 'not_judged'
  readonly independentPositionRequired: string
  /** EX-2+ 独立闭合：DEC-OPEN-13 未裁＝undetermined（不得读成已独立） */
  readonly ex2Closure: 'undetermined'
}

/** 独立验收/结清位置声明（EX-2+ 另引 DEC-OPEN-13） */
export const ACCEPTANCE_INPUT_REQUIRES =
  '独立验收位置（验者≠交付者；EX-2+ 另需独立收割最小主体——DEC-OPEN-13 未裁）'

/**
 * 批次作验收输入（REC-EVD-01 不变量）：完整性存疑/幂等冲突/未封/自供关系不成立→不可用。
 * 恒不产出 acceptance/settlement 判断（X2..X4 结构性拒绝——本件无验收权）。
 */
export function acceptanceInputOf(batch: HarvestBatchView): AcceptanceInputView {
  const reasons: string[] = []
  if (batch.harvester.differsFromDeliverer !== true) reasons.push('收割者=交付者：关系要件不成立（自供不成独立——v2/08 §2.2）')
  if (batch.status === 'conflict') reasons.push('同键异内容（幂等冲突）：重复交付已拒，不得作验收输入')
  if (batch.status !== 'sealed') reasons.push(`批次状态=${batch.status}（未封批）：不得作验收输入`)
  if (batch.completeness !== 'complete') reasons.push(`完整性=${batch.completeness}：存疑时不得判接受（REC-EVD-01 不变量）`)
  return {
    usable: reasons.length === 0,
    reasons,
    notes: [HARVEST_INDEPENDENCE_DECLARATION],
    acceptance: 'not_judged',
    settlement: 'not_judged',
    independentPositionRequired: ACCEPTANCE_INPUT_REQUIRES,
    ex2Closure: 'undetermined',
  }
}
