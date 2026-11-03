/**
 * engine/runtime/lifecycle.ts —— 引擎生命周期面（公司目录热替换／在途 drain 停机）
 *
 * 20-§十五「按域拆件、零行为变更」：原 engine.ts 内 `applyCompanyUpdate` 与 `dispose`
 * 方法体逐字迁出，外部引用经 rt（EngineRuntime）。
 *   - applyCompanyUpdate：整组替换（不半换）——people+assembler 绑定与快照派生三键一起换；
 *     调用方保证拍边界（serve 主循环）；本方法自身纯赋值不抛，失败面归调用方前置校验。
 *   - dispose：在途内存 handle 优雅杀（adapter.kill），work_records 留 running——重启接管
 *     语义不变（引擎不在此收口工时行）。
 */
import type { CompanyRuntimeUpdate } from './contract.ts'
import { buildDirectiveAuthorizer } from '../directive/index.ts'
import { recordRosterLoad } from '../records/hooks.ts'
import type { EngineRuntime } from './types.ts'

/**
 * 公司面热替换（docs/38-§2 L1 配置级热重载的引擎侧落点）：**拍边界调用**——
 * 单线程下无并发 tick，结构性不中断在途单/dispatch。在途工位（inflight/泳道租约/
 * 已落盘指令文件）不动：旧单跑旧装配方，替换后的新派发用新配置。
 */
export function applyCompanyUpdate(rt: EngineRuntime, update: CompanyRuntimeUpdate): void {
  // 整组替换（不半换）：people+assembler 绑定与快照派生三键一起换——调用方保证
  // 拍边界（serve 主循环）；本方法自身纯赋值不抛，失败面归调用方前置校验
  rt.people = update.people
  // 记录族生产写面·人事变更相位（studio-dev-605 刀B）：名册整组换 → 任职/授权链增量重派生（幂等，
  // 缺前置即拒；记录面关=records 缺省不注入=零行为）
  if (rt.records !== undefined) recordRosterLoad({ records: rt.records, at: rt.now(), reason: 'hr-change' })
  rt.assembler = update.assembler
  rt.costGuard = update.costGuard // 恒换（132-§6.4 单C）：摘段即关面
  rt.config.defaultPersonId = update.defaultPersonId
  rt.config.deptFallback = update.deptFallback
  rt.config.defaultLane = update.defaultLane
  // 流表热换（DEV-43 N1）：缺省不换（保持现表）；换表后下一拍 decide/flowOf 对
  // 新表重解析（含在途单——跨边界未知态走既有 NOOP_UNKNOWN_STATE 纪律）
  if (update.flows !== undefined) rt.config.flows = update.flows
  // 州表卫生白名单热换（127-C）：显式传值即换（含空数组=摘白名单——哨兵回全灵敏度）
  if (update.knownForeignStates !== undefined) rt.config.knownForeignStates = update.knownForeignStates
  // 批示归一层部门表热换（studio-dev-171）：整组换 leader 表——组织变动
  // fail-closed；面未开（启动未注入）不因 update 开面
  if (update.directives !== undefined && rt.directiveDeps !== undefined) {
    rt.directiveDeps = { ...rt.directiveDeps, departments: update.directives }
    rt.directives = buildDirectiveAuthorizer(rt.directiveDeps, () => rt.people, rt.config.defaultPersonId)
  }
}

/**
 * 在途 drain（v0：对内存 handle 优雅 kill；work_records 留 running——重启接管归后续刀）。
 * bridge 通道指令临时文件不在此删：接管语义同款——重启接管重写同路径
 *（instructions-store.ts 头注清理策略）。
 */
export async function disposeEngine(rt: EngineRuntime): Promise<void> {
  for (const entry of [...rt.inflight.values()]) {
    try {
      const adapter = rt.registry.resolve(entry.executor)
      await adapter.kill(entry.handle, rt.config.killGraceMs)
    } catch {
      // kill 失败如实吞记（v0：dispose 不抛——停机路径保序）；work_records 留 running
      //（重启由 serve 启动例行接管收口——R-B，serve.ts takeOverRunningWorkRecords）
    }
  }
  rt.crash.shutdownDrain() // 崩溃注入⑤（F3-11）：SIGINT 停机 drain 中途（kill 已跑、在途注销前）——受控测试缝，默认零行为
  rt.inflight.clear()
}
