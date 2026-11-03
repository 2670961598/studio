/**
 * assembly/serve/capability-face —— 能力供给 CAP 记录面装配（REC-CAP 写者生产接线）
 *
 * 依据（实现单必须引文档章节号——AGENTS §五.1）：
 *   - docs/v2/11 §9 CAP 族（REC-CAP-01 声明/RECEIPT 回执；写口＝PORT-HIST 唯一写口）；
 *   - docs/v2/14 §1.6（PORT-HIST）；docs/v2/07 §一（九维声明/采集者独立性）；
 *   - docs/v2/02 §五（缺能力处置五出口）；docs/v2/17 §5.1 NEG-RING-03；
 *   - docs/v2/16 §三 daemon 行（serve 装配面）；docs/17-§2（主循环七相位不改）。
 *
 * 职责：把 executor 注册面（agent.yaml/fake）与 `createHistFace(ledger.db)` 接起来——
 * 启动期逐执行体落 REC-CAP-01 声明，并把面注入 EngineDeps.capabilitySupply（派发相位
 * 探测回执/五出口决策消费）。零记录形状定义（形状唯一源＝contract cap.ts）、零判定复制。
 *
 * fail-closed：声明落库失败直接抛（装配期拒启，不静默无供给记录）；回执失败由面内日志
 * 明报，不阻断判定（缺口决策仍 fail-closed 拒绝派发）。
 */
import type { ExecutorRegistry } from '@studio-next/adapters'
import { createHistFace, type Ledger } from '@studio-next/store'
import {
  createCapabilitySupplyFace,
  type CapabilitySupplyFace,
  type CapabilitySupplyExecutor,
} from '../../engine/capability/index.ts'
import { makeUlid } from '../../engine/tools/id.ts'

/** 装配入参（ledger/registry 已由调用方构造；clock/log 与 serve 同源） */
export interface WireCapabilitySupplyArgs {
  readonly ledger: Ledger
  readonly registry: ExecutorRegistry
  readonly company: string
  readonly clock: () => number
  readonly log?: (line: string) => void
}

/**
 * 装配能力供给记录面并落启动声明：
 *   - executors＝registry.list()（读能力声明，零 executor 名单硬编码）；
 *   - 写口＝createHistFace(ledger.db).append（PORT-HIST 唯一写口）；
 *   - 返回面供 `EngineDeps.capabilitySupply` 注入（派发相位消费）。
 * 声明写失败＝抛出（serve 启动失败，fail-closed——「无供给记录」不得静默）。
 */
export function wireCapabilitySupply(args: WireCapabilitySupplyArgs): CapabilitySupplyFace {
  const executors: CapabilitySupplyExecutor[] = args.registry.list().map((entry) => ({
    name: entry.name,
    capabilities: entry.capabilities,
    source: `executor 注册面（${entry.default ? 'default；' : ''}agent.yaml/fake 装配）`,
  }))
  const face = createCapabilitySupplyFace({
    hist: createHistFace(args.ledger.db),
    company: args.company,
    executors,
    makeId: (ts) => makeUlid(ts),
    now: args.clock,
    ...(args.log !== undefined ? { log: args.log } : {}),
  })
  const declared = face.ensureDeclared()
  args.log?.(
    `[serve] CAP 能力供给记录面已装配：REC-CAP-01 × ${declared.length}（${declared.map((d) => d.executor).join('、')}）→ PORT-HIST records（company=${args.company}）；` +
      '能力缺口五出口决策已接派发判定相位（missing/degraded/cost_runaway；fail-closed——出口缺失/非法不继续）',
  )
  return face
}
