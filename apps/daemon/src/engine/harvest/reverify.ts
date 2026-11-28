/**
 * harvest/reverify —— 已有证据原位复验（task-158 / FIX-04 ②；Kimi 总审 P0-04）
 *
 * 依据：docs/quality/idempotent-closeout.md §2；docs/17-§6 末（收割成功契约四要件）；docs/v2/11
 * §六（REC-EVD-01；「没采集到」≠「无输出」）。病根证据：LOCAL-434 att5／LOCAL-442 att1——
 * 401/429 类供给错使 turn_end.completed=false，但 REPORT 已落（size=10847）且真验收闸门 exit=0
 * → GATE_FAIL 回新单重跑模型：重跑救不了供给错，白烧一次预算与断路连击。
 *
 * 判据（不看错误类别，只看证据；**比常规路径更严**，四要件语义零放宽）：
 *   资格＝terminalObserved ∧ 输出非空 ∧ REPORT 落盘 ∧ 首闸 exit=0 ∧ 仅缺终态自述 ∧ 注入了真验收闸
 *   （`EngineDeps.reverifyGate`；v0 占位闸门 exit0=模拟 → 无资格，fail-closed）。
 *   程序＝stat REPORT size>0 → 复验闸**独立复跑**一次真验收命令，须 exit=0 ∧ REPORT 在位 → 判过。
 * 补终态只替代「worker 自述终态」一槽，且要求验收命令两次真跑皆绿；判不过=GATE_FAIL 照旧。
 * 四要件判定唯一实现仍在 harvest/batch.ts（本件只消费 requirements，不改判、不代写 REPORT）。
 */
import { statSync } from 'node:fs'
import type { GateInput, GateRunner } from '../gate.ts'
import type { HarvestRequirements } from './batch.ts'

/** 补终态判过的工时记录 gap（自述不改写：terminal 仍记 error，来源另记） */
export const TERMINAL_BACKFILL_GAP = '终态 completed 缺自述——证据复验补终态（来源=证据复验）'

/** 复验结论：判过=补终态成立（携 size 与复验闸 note 留痕）；判不过=reason 进 GATE_FAIL detail 尾 */
export type TerminalBackfill =
  | { readonly ok: true; readonly reportSize: number; readonly note: string }
  | { readonly ok: false; readonly reason: string }

/**
 * 资格判定（纯函数，判定序即文案）：undefined=具资格；否则=不适用理由。理由不进 GATE_FAIL
 * detail（四要件缺项文案已自明；占位闸门下逐条缀「无资格」=对既有失败面刷屏）。
 */
export function terminalBackfillIneligibility(
  requirements: HarvestRequirements,
  reverifier: GateRunner | undefined,
): string | undefined {
  if (requirements.fourOk) return '四要件齐（无需补终态）'
  if (!requirements.terminalObserved) return '终态未观测（未采集≠完成，EXEC-05）'
  if (!requirements.nonEmptyOutput) return '输出为空'
  if (!requirements.reportExists) return 'REPORT 未落盘'
  if (!requirements.exit0) return '首闸 exit≠0'
  if (reverifier === undefined) return '无真验收闸（占位闸门 exit0=模拟，无补终态资格）'
  return undefined
}

function reportSizeOf(reportPath: string): number {
  try {
    return statSync(reportPath).size
  } catch {
    return 0
  }
}

/** 原位复验（零模型调用）：REPORT size>0 → 复验闸独立复跑 → exit=0 ∧ REPORT 在位才判过 */
export async function reverifyTerminalByEvidence(args: {
  readonly reverifier: GateRunner
  readonly input: GateInput
  readonly reportPath: string
}): Promise<TerminalBackfill> {
  const size = reportSizeOf(args.reportPath)
  if (size <= 0) return { ok: false, reason: `REPORT 复验 size=${String(size)}（须 >0）` }
  let gate
  try {
    gate = await args.reverifier.run(args.input)
  } catch (err) {
    // 复验闸异常=判不过（fail-closed 留痕；不上抛——上抛会把供给错降格成「流消费异常」WORKER_DEAD 面）
    return { ok: false, reason: `复验闸异常：${err instanceof Error ? err.message : String(err)}` }
  }
  if (!gate.reportExists || gate.exitCode !== 0) {
    return { ok: false, reason: `复验闸门 exit=${String(gate.exitCode)}；${gate.note ?? '（无 note）'}` }
  }
  return { ok: true, reportSize: size, note: gate.note ?? '（无 note）' }
}
