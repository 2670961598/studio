/**
 * assembly/serve/evolve-face —— 进化判负闸·serve 启动自检装配（先拆后增）
 *
 * 依据：docs/17-§2（主循环七相位；启动装配不改相位）、docs/20-§十五.三/§十五.四（拆件纪律）；
 * docs/v2/17（进化管线判负闸）；实现面见 src/evolve/evolve-guard.ts 头注。
 *
 * 拆件动机（studio-dev-537 先拆后增适配）：原 buildServeRuntime 内联的 evolve 自检装配块整块
 * 搬入本件——runtime.ts 现 550/600（余量 50 边缘，宰相 2026-11-04 硬约束「动 runtime 必须先拆后增」），
 * 本件为五对象记录载体接线腾出余量。**搬移语义零漂移**：ledger/clock/makeId/company/actor/dept/log
 * 逐项与原块一致，缺省值（ENGINE_CONFIG_DEFAULTS.actor / departments[0]?.path / deptFallback）不变，
 * 测试注入面（manifest/hashFile/fileExists）仍经 overrides 透传，行为零变更。
 */
import type { CompanySnapshot } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { ENGINE_CONFIG_DEFAULTS } from '../../engine/engine.ts'
import { makeUlid } from '../../engine/tools/id.ts'
import {
  runEvolveStartupSelfCheck,
  type EvolveSelfCheckDeps,
  type EvolveSelfCheckReport,
} from '../../evolve/evolve-guard.ts'
import type { ServeConfig } from './config.ts'

/** 自检测试注入面（沿用 EvolveSelfCheckDeps 的 manifest/hashFile/fileExists 三键；guard/issue 不在 serve 面开放） */
export type ServeEvolveSelfCheckOverrides = Pick<EvolveSelfCheckDeps, 'manifest' | 'hashFile' | 'fileExists'>

/** 自检装配入参（runtime 只传活对象，不传默认值——默认值收口在本件） */
export interface WireServeEvolveSelfCheckArgs {
  readonly config: ServeConfig
  readonly snapshot: CompanySnapshot
  readonly ledger: Ledger
  readonly clock: () => number
  readonly log: (line: string) => void
  readonly overrides?: ServeEvolveSelfCheckOverrides
}

/**
 * serve 启动自检装配（v0 观察模式；接线点仍为 buildServeRuntime，本件只做装配参数归一）：
 *   - 空库首启/逐资产判负/ESCALATE 留痕语义全在 runEvolveStartupSelfCheck（本件不改判据）；
 *   - actor/dept 默认值与原内联块逐项一致，避免搬移引入口径漂移。
 */
export function wireServeEvolveSelfCheck(args: WireServeEvolveSelfCheckArgs): EvolveSelfCheckReport {
  return runEvolveStartupSelfCheck({
    ledger: args.ledger,
    clock: args.clock,
    makeId: makeUlid,
    company: args.config.company,
    actor: ENGINE_CONFIG_DEFAULTS.actor,
    dept: args.snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    log: args.log,
    ...(args.overrides ?? {}),
  })
}
