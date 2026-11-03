/**
 * assembly/serve/runtime-types —— ServeRuntime 装配契约（从 runtime.ts 析出，20-§十五.三「先拆再增」）
 *
 * 依据：docs/17-§2（七相位主循环，runServe 与测试共用装配）；docs/38-§2（L1 热重载面）；
 * docs/v2/14 §四（对外 API 同进程装配）；docs/17-§7（worker wkey 按单签发）。
 *
 * 析出动机：runtime.ts 触及 600 行阈——纯类型件外移不改变装配行为（本件零运行时语义），
 * runtime 再出口同名类型，既有导入路径（assembly/serve.ts）零漂移。
 */
import type { EventRecord, TicketId } from '@studio-next/contract'
import type { Engine } from '../../engine/engine.ts'
import type { Scheduler } from '../../engine/scheduler.ts'
import type { SourceRegistry } from '../../engine/sources.ts'
import type { EvolveSelfCheckReport } from '../../evolve/evolve-guard.ts'
import type { HotReload } from '../../control/hot-reload.ts'
import type { ServeApiWiring } from '../api/serve-face.ts'
import type { ServeConfig } from './config.ts'
import type { RestartProbeFace } from './executor-face.ts'
import type { ServeOpsFace } from '../ops/index.ts'
import type { DerivationServeFace } from './derivation.ts'
import type { RootDelegationTrace } from './root-delegation/root-face.ts'

/** serve 运行栈（engine + 唤起源注册表 + PORT-OPS 面 + 统一停机面；runServe 与测试共用装配） */
export interface ServeRuntime extends ServeOpsFace, RestartProbeFace {
  engine: Engine
  scheduler: Scheduler | null
  /** 唤起源注册表（22-§一）：startAll 的 emit 统一进 engine.ingest（runServe 接线） */
  sources: SourceRegistry
  /**
   * L1 配置热重载执行体（docs/38-§2 L1 / §4 R-A；companyDir 给定时存在）：
   * runServe 主循环在**拍边界**（tick() 收口后）调 check()——指纹自动 + 控制面手动
   * 两触发面；缺省=未挂公司目录（demo 快照），L1 不适用（reload 请求由
   * answerReloadNoCompanyDir 回执拒绝）。详见 src/control/hot-reload.ts 头注。
   */
  hotReload?: HotReload
  /**
   * 启动期进化判负自检汇报（src/evolve/evolve-guard.ts，v0 观察模式）：ESCALATE 事件已在装配期
   * 落账（unauthorized 时）；本字段为汇报面（测试/面板观测锚）。
   */
  evolveSelfCheck: EvolveSelfCheckReport
  /**
   * 续命意图推送面（129-E 单E，studio-dev-184；resume: true 时存在）：v0 生产调用面=
   * 测试与后续 CLI `studio resume <单号>`（50a-B4 归档在册——命令面另批，此处先露面）。
   */
  resumePublish?: (ticket: TicketId, cause?: string) => boolean
  /**
   * notify 事件中继（105-刀B，studio-dev-219；notifyBroadcast 注入时存在）：
   * runServe 主循环在拍边界（tick() 收口后）以本拍新事件 TickReport.events 调用——
   * 按冻结路由表广播 #alert/部门频道/总览（docs/17-§2 七相位结构不动：中继在相位外
   * 只读消费）。永不抛（软失败=日志+计量 failed 数，面板仍第一落点——刀B-6）。
   */
  notifyRelay?: (events: readonly EventRecord[]) => Promise<void>
  /** 对外 API 同进程装配面（MIG-06 收口；v2/14 §四）：runServe 在源启动前 await start()，停机先 close() */
  api: ServeApiWiring
  /** 根委任审计投影（SEC-ROOT-02 启动腿；v2/15 §7.3 步⑤；装配期已验，缺省=未装 root 面） */
  rootDelegation?: RootDelegationTrace
  /** daemon.yaml seatbelt 解析产物（IMPL-07-09 配置通道；与 EngineDeps.dispatchSeatbelt 同引用，undefined=read-only 缺省） */
  dispatchSeatbelt: ServeConfig['seatbelt']
  /** 派生树面（GAP-V2-04 S6）：PORT-AUTH.withdraw／控制面 ctl- 撤回入口＋REC 行写面 */
  derivation: DerivationServeFace
  /** 优雅停：先关 API→stopAll 唤起源→在途 drain→关台账（SIGINT/SIGTERM 同一收口，可重入；未消费意图停机即弃，at-most-once——engine.ts 头注）。 */
  stop(): Promise<void>
}
