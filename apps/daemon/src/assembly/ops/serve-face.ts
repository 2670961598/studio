/**
 * assembly/ops/serve-face —— runtime 接线面：PORT-OPS 装配进 ServeRuntime（OPS 补形 A）
 *
 * 依据：docs/v2/14 §1.8（PORT-OPS）、§1.6（PORT-HIST 唯一记录写口）；docs/v2/11 §六
 * REC-WORK-18；docs/49「OPS 补形 A」；docs/v2/16 §三 daemon 行（serve 装配面）。
 *
 * 拆件动机：runtime.ts 守卫 600 行阈——把「ops 装配＋makeId/now 注入＋装配日志」收在本件，
 * runtime 只留一行接线（20-§十五.三「先拆再增」）。行为边界：本件**只提供装配面**，
 * runServe 不自动触发 emergencyStop/circuitBreak（控制面停机文件协议与相位不变）。
 */
import type { Ledger } from '@studio-next/store'
import { makeUlid } from '../../engine/tools/id.ts'
import type { OpsLanding } from '../../control/ops/index.ts'
import { assembleOps } from './assemble.ts'

/** ServeRuntime 的 PORT-OPS 面（记录写口已在装配期接 PORT-HIST；调用方自行触发） */
export interface ServeOpsFace {
  /**
   * PORT-OPS 落口（v2/14 §1.8）：emergencyStop/circuitBreak 的 control 实现，记录经
   * PORT-HIST 落 REC-WORK-18（assembly/ops 装配）。**只提供装配面**——runServe 不自动
   * 触发；控制面停机文件协议（stop-channel）行为不变。
   */
  readonly ops: OpsLanding
}

/** runtime 接线入参（clock 注入令 makeId/now 同源，不另读墙钟） */
export interface WireServeOpsArgs {
  readonly ledger: Ledger
  readonly clock: () => number
  /** 三不入·库闸（runtime 传 outbound.gate.guardStoreRecord；测试可省） */
  readonly guardRecord?: (record: unknown) => unknown
  readonly log?: (line: string) => void
}

/**
 * 装配 PORT-OPS 面并返回 ServeRuntime 片段：
 *   - makeId＝ULID（时间部分取注入 clock）；now＝注入 clock 的 ISO（同一时钟，可复现）；
 *   - appendRecord→`createHistFace(ledger.db).append`；记录写前过三不入·库闸；
 *   - 装配日志显式（生产装配证据锚）。只返回值，不调用任何处置方法。
 */
export function wireServeOps(args: WireServeOpsArgs): ServeOpsFace {
  const assembly = assembleOps({
    ledger: args.ledger,
    makeId: () => makeUlid(args.clock()),
    now: () => new Date(args.clock()).toISOString(),
    ...(args.guardRecord !== undefined ? { guardRecord: args.guardRecord } : {}),
    ...(args.log !== undefined ? { log: args.log } : {}),
  })
  args.log?.('[serve] PORT-OPS 落口已装配：emergencyStop/circuitBreak → REC-WORK-18 → PORT-HIST（appendRecord 注入；runServe 不自动触发）')
  return { ops: assembly.ops }
}
