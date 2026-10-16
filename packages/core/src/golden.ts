/**
 * golden —— golden trace 回放器（docs/17-§2「golden trace 可回放」，需求 F1-03 验收口径）
 *
 * 规格依据（实现单引用）：
 *   - F1-03 验收：派单决策纯状态驱动，golden trace 回放决策一致。
 *   - docs/02 F2-14：外部依赖转 golden trace——本格式即决策面的契约雏形。
 *
 * **格式即契约雏形——将来进 contract 包**（本刀放 core 内；升包走进化管线 F3-01，冻结前
 * trace 文件与回放器同改同批，禁单侧漂移）：
 *
 *   GoldenTrace = {
 *     name: string                     // trace 稳定名（文件名对应）
 *     description?: string             // 链路说明（人读）
 *     inputs: DecisionInput[]          // 逐拍输入（同一单的连续拍；时间/计数全入参，可重放）
 *     expected: { type, code }[]       // 与 inputs 逐一对应：动作类型 + 理由码
 *   }
 *
 *   回放判据（零分歧口径）：每拍 action.type 与 action.code 逐一相等即绿；
 *   toState/lane 等载字段不进判据（它们由流表派生，属实现细节，不冻结）。
 *
 * 纯函数纪律：replayTrace 零 IO（文件读取归测试层）、同输入恒同输出。
 */

import { decide, type Action, type DecisionCode, type DecisionInput, type ActionType } from './decide.ts'

/** 单步期望：动作类型 + 理由码（零分歧判据的最小冻结面） */
export interface GoldenExpectation {
  type: ActionType
  code: DecisionCode
}

/** trace 文件整体形状（JSON 落盘于 test/golden/*.json） */
export interface GoldenTrace {
  name: string
  description?: string
  inputs: DecisionInput[]
  expected: GoldenExpectation[]
}

/** 单步失配（人读定位：第几拍、期望 vs 实际；结构性失配无 per-step 期望则留空） */
export interface GoldenFailure {
  trace: string
  step: number
  reason: string
  expected?: GoldenExpectation
  actual?: GoldenExpectation
}

/** 回放一条 trace：全部命中返回空数组（绿）；任何失配即红并列出全部失配步 */
export function replayTrace(trace: GoldenTrace): GoldenFailure[] {
  if (trace.inputs.length !== trace.expected.length) {
    return [
      {
        trace: trace.name,
        step: -1,
        reason: `inputs(${trace.inputs.length}) 与 expected(${trace.expected.length}) 步数不等`,
      },
    ]
  }
  const failures: GoldenFailure[] = []
  trace.inputs.forEach((input, i) => {
    const action: Action = decide(input).action
    const exp = trace.expected[i]
    if (exp === undefined || exp.type !== action.type || exp.code !== action.code) {
      const failure: GoldenFailure = {
        trace: trace.name,
        step: i,
        reason: `第 ${i} 拍期望 (${exp?.type ?? '?'}/${exp?.code ?? '?'}) 实际 (${action.type}/${action.code})`,
        actual: { type: action.type, code: action.code },
      }
      if (exp !== undefined) failure.expected = exp
      failures.push(failure)
    }
  })
  return failures
}
