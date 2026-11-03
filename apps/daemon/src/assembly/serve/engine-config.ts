/**
 * serve/engine-config —— 引擎配置装配（runServe 装配序的纯构造段）
 *
 * 依据（实现单引用）：
 *   - docs/v2/16 §三 daemon 行（DISP-02：serve 拆 config/runtime/run，runtime 只留运行栈编排）；
 *   - docs/17-§2（主循环七相位——配置装配不改相位）；docs/17-§6（收割四要件；收账/对账是
 *     GATE_PASS 后置步）；
 *   - docs/v2/15 §4.4（SEC-SEC-04 第 5 出口证据导出）：本件承载 engineConfig.evidenceExportGuard
 *     注入——收割归档与 P3 对账补收在写出 company/reports 前过闸（拒发档，fail-closed）。
 *
 * 为什么独立一件（20-§十五.三 尺寸阈「先拆再增」）：runtime.ts 已 562 行（距 600 阈余量
 * 38<50），本段是其中**零 engine 实例依赖**的纯装配（只读 config＋公司快照＋已装配面），
 * 拆出后 runtime.ts 留运行栈编排；本件单职责、可独立类型门、<600 行。
 *
 * 行为边界：与拆前 runtime.ts 内联块逐字等价（键序/条件展开/缺省回退不变）；唯一新增键
 * =evidenceExportGuard（第 5 出口接线，见 docs/v2/15 §4.4 与 outbound-gate/gate.ts）。
 */
import path from 'node:path'
import { DEFAULT_FLOW_TABLE, type FlowTable, type TierId } from '@studio-next/core'
import type { CompanySnapshot, PersonRef, TicketId } from '@studio-next/contract'
import { ENGINE_CONFIG_DEFAULTS, type EngineConfig } from '../../engine/engine.ts'
import { mergeCostThresholdDefaults } from '../../engine/intents/escalate.ts'
import { queueServeOverrides } from '../../engine/todoqueue/queue.ts'
import { loadTaigaFieldMap, provisionDeclaredStates } from '../platform/wire.ts'
import { stallServeOverrides } from './watchdog-config.ts'
import type { ServeConfig } from './config.ts'

/** 引擎配置装配入参（runtime 装配序已解析/已装配面；本件零 IO、零引擎实例依赖） */
export interface ServeEngineConfigInput {
  config: ServeConfig
  snapshot: CompanySnapshot
  /** .AIWS 员工家根（runtime 依 docs/43-§五 单一规则推导） */
  aiwsRoot: string
  /** data-change 路由表（129-A；未配=undefined） */
  dataChangeRoutes: Record<string, string> | undefined
  /** 模型档角色映射（models.yaml 已装载=态 A） */
  modelRoles: Readonly<Record<string, TierId>> | undefined
  /** 显式单级覆盖表（modelTierTickets 解析产物；未配=undefined） */
  modelTierTickets: Readonly<Record<TicketId, TierId>> | undefined
  /** 冻结验收命令（读面分级与装配器 acceptance **同一事实源**） */
  acceptance: string[]
  /** workflows → T 键流表（未声明=undefined） */
  typeFlows: FlowTable | undefined
  /** 第 5 出口证据导出闸（docs/v2/15 §4.4；拒发档，收割归档/对账补收写出前过闸） */
  evidenceExportGuard: (text: string) => string
}

/** 装配 EngineConfig（键序/条件展开与拆前 runtime.ts 内联块逐字等价） */
export function buildServeEngineConfig(input: ServeEngineConfigInput): EngineConfig {
  const { config, snapshot, aiwsRoot, dataChangeRoutes, modelRoles, modelTierTickets, acceptance, typeFlows, evidenceExportGuard } = input
  return {
    ...ENGINE_CONFIG_DEFAULTS,
    company: config.company,
    rootDir: path.resolve(config.rootDir),
    // .AIWS 员工家（DEV-28）：派发 workspace 落员工家（docs/43-§五）——收割四要件与
    // deliverables 收账经 dirname(briefPath) 全随迁；缺省不注入=引擎旧布局回退面
    aiwsRoot,
    defaultPersonId: (snapshot.people[0] as PersonRef | undefined)?.id ?? '',
    ...(dataChangeRoutes !== undefined ? { dataChangeRoutes } : {}), // 129-A 路由登记位（未配=闸面 fail-closed）
    ...mergeCostThresholdDefaults(snapshot.hooks, config.costThresholdTarget, config.costThresholdLane), // 129-D 缺省路由登记位（org 规范位+daemon 逃生位整体覆盖；全缺=引擎 fail-closed）
    deptFallback: snapshot.departments[0]?.path ?? ENGINE_CONFIG_DEFAULTS.deptFallback,
    defaultLane: snapshot.departments[0]?.lanes[0] ?? ENGINE_CONFIG_DEFAULTS.defaultLane,
    limits: {
      maxActionsPerTick: config.maxActionsPerTick,
      maxInflight: config.maxInflight,
      // 人闸缺省帽（129-§6.2-R3）：缺省不注入=引擎兜底 1（串行）；批量执行岗走覆盖表
      ...(config.maxInflightPerPerson !== undefined ? { maxInflightPerPerson: config.maxInflightPerPerson } : {}),
    },
    ...queueServeOverrides(config), // 队列面三键（129-§6.2 单B：步长/人闸覆盖表/置顶集——解析件 todoqueue/queue.ts）
    // 模型档路由面（studio-dev-196）：modelTierByRole 注入即开面（models.yaml 未装载=
    // 不注入=面关，派发行为与本单之前一致）；显式单级覆盖表装配期转 map（解析即验在
    // 装载 case 面——serve/model-tier-tickets fail-closed）
    ...(modelRoles !== undefined ? { modelTierByRole: modelRoles } : {}),
    ...(modelTierTickets !== undefined ? { modelTierTickets } : {}),
    ...stallServeOverrides(config), // 看门狗阈值面（studio-dev-505：含按 executor 分级）
    harvestSliceMs: config.harvestSliceMs,
    laneTtlMs: config.laneTtlMs,
    mergeLeaseTtlMs: config.mergeLeaseTtlMs,
    breakerThreshold: config.breakerThreshold,
    breakerCooldownMs: config.breakerCooldownMs,
    mirrorRescanEveryTicks: config.mirrorRescanEveryTicks,
    ...(config.autoAssign !== undefined ? { autoAssign: config.autoAssign } : {}),
    autoApprove: config.autoApprove,
    // 读面分级（17-§7）：Blind 档冻结验收命令来源——与装配器 acceptance **同一事实源**
    //（单一事实源，不双源漂移；真单模式=acceptance 配置）；遇 Blind 派发而缺失 →
    // createView fail-closed 明报
    readBlindAcceptance: acceptance,
    // 类型流注入（DEV-43，docs/18-§2.1.1 D13 合并序）：T 键叠在 DEFAULT_FLOW_TABLE 上；
    // 无 workflows 声明=不注入（引擎走内置缺省表，现状行为字节不变——D9）
    ...(typeFlows !== undefined ? { flows: { ...DEFAULT_FLOW_TABLE, ...typeFlows } } : {}),
    ...(config.budgetTicketCapUsd !== undefined ? { budgetTicketCapUsd: config.budgetTicketCapUsd } : {}),
    ...(config.budgetPersonCapUsd !== undefined ? { budgetPersonCapUsd: config.budgetPersonCapUsd } : {}),
    // C2 声明态漂移哨输入（studio-dev-126）：taiga 且挂了字段映射文件才注入（同一份
    // 文件 loadTaigaFieldMap 单源重读——启动期一次，非每拍）；其余平台缺省=面关
    ...(config.platform === 'taiga' && config.taigaFieldsFile !== undefined
      ? { provisionDeclaredStates: provisionDeclaredStates(loadTaigaFieldMap(config.taigaFieldsFile), config.taigaEntity ?? 'userstory') }
      : {}),
    // 州表卫生白名单注入（127-C，studio-dev-127 §4.7）：快照携带（org-config
    // yt.known_foreign_states 经 SH-1 内容规则校验）——已知外来态哨兵降 FOREIGN_KNOWN
    // 观察级；恒传显式数组（缺声明=空数组=哨兵全灵敏度，不留 undefined 滞留面）
    knownForeignStates: snapshot.knownForeignStates ?? [],
    ...(config.companyDir !== undefined ? { companyDir: path.resolve(config.companyDir) } : {}), // 岗产物落位收账锚（DEV-50）
    evidenceExportGuard, // 第 5 出口：收割归档写出前过闸（拒发档，fail-closed）
  }
}
