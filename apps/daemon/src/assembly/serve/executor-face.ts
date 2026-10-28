/**
 * serve/executor-face —— executor 注册面装配（agent.yaml／价目表／模型档／judge 两址）
 *
 * 依据（实现单引用）：plan/05 IMPL-06-05「serve 拆分·config/runtime/run」；docs/v2/16 §三
 *   daemon 行（DISP-02：只沿既有目录语义拆，不新增域平面散件）；docs/17-§4（executor 注册
 *   与价目表装载）；160-B/studio-dev-196（judge 注册位与模型档）；34-§3.1（bridge overlay
 *   装载法 B）；129-§6.2 单B（队列两址）。
 *
 * 为什么独立一件（20-§十五.三 尺寸阈）：runtime.ts 的装配体超 600 行线，本段是其中**零
 * engine 实例依赖**的构造面（只读 config＋台账/时钟/日志）——拆出后 runtime.ts 留运行栈
 * 编排，本件留 executor 面构造，职责单一可单测。
 *
 * 行为边界：错误码（CONFIG_INVALID 明报）、日志顺序、注册/装载顺序与原 serve.ts 装配段
 * 逐字迁移零漂移；本文件不做 IO 以外的编排、不持主循环状态。
 */
import {
  createRegistry,
  isJudgeExecutorName,
  judgeAwareResolver,
  loadAgentConfig,
  tierAwareResolver,
  wireRegistry,
  type ExecutorRegistry,
} from '@studio-next/adapters'
import { assertJudgeRoleLow, createModelCatalog, fingerprint, parseModelsYaml, type TierId } from '@studio-next/core'
import { configInvalid } from '@studio-next/contract'
import type { ModelCatalog, TicketId } from '@studio-next/contract'
import type { Ledger } from '@studio-next/store'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { dshJudgeAdapterFactory, createJudgeRuntime } from '../../engine/judge/invoke.ts'
import { createQueueJudge, parseJudgeSites, type QueueJudgeHook } from '../../engine/judge/sites129.ts'
import { checkTierPositionDeclarations, parseModelTierTickets, provisionModelTierOverlays } from '../../engine/tier/model-tier.ts'
import { createFakeAdapter } from '../../engine/fakes.ts'
import { provisionDshBridgeOverlay } from '../../engine/instructions-store.ts'
import type { ServeConfig } from './config.ts'

/**
 * demo 冻结验收命令（单一常量双消费：装配器 L4 acceptance + Blind 读面验收面——
 * 17-§7 读面分级与 17-§6 收割口径同源，不双源漂移；真单刀接任务书粒度冻结时此处换装载）
 */
const ACCEPTANCE: string[] = ['echo demo-ok（v0 占位闸门不执行验收命令）']

/** executor 面装配入参（config 之外的运行时依赖；零 engine 实例） */
export interface ExecutorFaceDeps {
  ledger: Ledger
  clock: () => number
  log: (line: string) => void
}

/** executor 面装配产物（engine 构造与启动日志共用） */
export interface ExecutorFace {
  /** executor 注册表（agentYaml=真注册表；缺省=fake adapter） */
  registry: ExecutorRegistry
  /** 价目表（models: 段给定=态 A；缺省 undefined=态 B 降级） */
  catalog: ModelCatalog | undefined
  /** 模型档角色映射（仅价目表在场时） */
  modelRoles: Readonly<Record<string, TierId>> | undefined
  /** 显式单级覆盖表（modelTierTickets 解析产物；未配=undefined） */
  modelTierTickets: Readonly<Record<TicketId, TierId>> | undefined
  /** 队列小模型两址钩子（judgeSites 开且面齐时） */
  judgeHook: QueueJudgeHook | undefined
  /** 冻结验收命令（acceptance 配置给定=真单模式；缺省 demo 占位） */
  acceptance: string[]
  /** 真验收闸门形态（acceptance 配置给定） */
  realGate: boolean
}

/**
 * 装配 executor 面：注册表双形态（agentYaml/fake）→ bridge overlay provisioning →
 * 冻结验收命令单一事实源 → 价目表/模型档 → judge 注册位启动闸 → 队列小模型两址。
 * 失败即抛（CONFIG_INVALID 明报不猜）——调用方（buildServeRuntime）不做二次吞错。
 */
export function wireExecutorFace(config: ServeConfig, deps: ExecutorFaceDeps): ExecutorFace {
  const { ledger, clock, log } = deps

  // —— executor 注册双形态（v0.5 真单刀）：agentYaml=真注册表；缺省=fake（demo 不变）——
  const registry = createRegistry()
  let agentConf: ReturnType<typeof loadAgentConfig> | undefined
  if (config.agentYaml !== undefined) {
    const agentText = readFileSync(path.resolve(config.agentYaml), 'utf8')
    agentConf = loadAgentConfig(agentText)
    // resolver 组合（studio-dev-196）：judge 外包 tier——`<family>-<tier>` 档位（patches
    // 透传，agentconfig.ts）+ `<family>-judge` 判断位两层都可注册（此前裸 builtinResolver
    // 对两形态都 unknown-executor——judge 位从未真正可装配的潜伏缺口随本单一并闭合）
    wireRegistry(registry, agentConf, judgeAwareResolver(tierAwareResolver()))
    log(
      `[serve] executor 注册（agent.yaml=${config.agentYaml}）：${registry.list().map((e) => `${e.name}${e.default ? '(default)' : ''}`).join('、')}`,
    )
  } else {
    registry.register(createFakeAdapter(), { default: true })
  }

  // —— dsh bridge 插件 provisioning（v1.5#1 通道装载自动化）：注册表含 bridge 通道
  //    注册表含 bridge 通道 executor（agents_md≠native）时生成 overlay（装载法 B，34-§3.1，
  //    instructions-store.ts）；挂载归 agent.yaml cmd --patch；未挂载=env 无消费者（明报不拒启动）。
  const bridgeChannelUsers = registry.list().filter((e) => e.capabilities.agents_md !== 'native')
  if (bridgeChannelUsers.length > 0) {
    const overlay = provisionDshBridgeOverlay(path.resolve(config.rootDir))
    if (overlay !== undefined) {
      log(
        `[serve] bridge 插件 overlay 已生成：${overlay.overlayPath}（插件源 ${overlay.bridgeSrc}）` +
          `——通道 executor：${bridgeChannelUsers.map((e) => e.name).join('、')}；agent.yaml 该家 cmd 追加 --patch <该路径> 即挂载（docs/34-§3.1 装载法 B；未挂载则注入不发生）`,
      )
    } else {
      log(
        '[serve] 警告：注册表含 bridge 通道 executor（' +
          `${bridgeChannelUsers.map((e) => e.name).join('、')}）但 dsh-bridge 包不在仓内预期位置（仓外部署？）` +
          '——overlay 未生成；须自行以 --patch 挂载 studio-next-bridge，否则 STUDIO_NEXT_INSTRUCTIONS 无消费者、身份注入不发生',
      )
    }
  }

  // —— 冻结验收命令单一事实源（v0.5 真单刀）：acceptance 配置给定=真单模式（装配器 L4 /
  //    Blind 读面 / 真验收闸门三消费面同源）；缺省=demo 占位常量——不双源漂移 ——
  const acceptance: string[] = config.acceptance !== undefined ? [config.acceptance] : ACCEPTANCE
  const realGate = config.acceptance !== undefined

  // 价目表装载（可选，17-§4）：daemon.yaml models: 段 → parseModelsYaml → catalog 注入引擎
  // （态 A）；缺省不装载=态 B 降级——**不拷贝 models.example.yaml**（示例价入账=伪依据）。
  // fingerprint 启动日志呈现；台账事件锚归后续 daemon 单。装载失败 → CONFIG_INVALID 拒启动。
  let catalog: ModelCatalog | undefined
  let modelRoles: Readonly<Record<string, TierId>> | undefined
  if (config.models !== undefined) {
    const text = readFileSync(path.resolve(config.models), 'utf8')
    const parsed = parseModelsYaml(text)
    catalog = createModelCatalog(parsed)
    modelRoles = parsed.roles
    log(`[serve] 价目表装载：${config.models}（fingerprint=${fingerprint(parsed)}；估算态 A：estimateCost 校准+双帽）`)
    // —— 模型档执行面（studio-dev-196，制作人 2026-10-22 三档定调）：低/高档 dsh overlay
    //    生成（mid=现役缺省不生成）+ 档位声明一致性闸（agent.yaml 档位镜像 vs tiers 漂移
    //    =启动拒——三面同源纪律，见 src/engine/model-tier.ts 头注）。
    const tierOverlays = provisionModelTierOverlays(path.resolve(config.rootDir), parsed)
    if (agentConf !== undefined) checkTierPositionDeclarations(agentConf.executors, parsed)
    const overlayDesc = Object.entries(tierOverlays)
      .map(([t, p]) => `${t}=${p}`)
      .join('、')
    log(
      `[serve] 模型档执行面开（tier→executor 路由：单级覆盖>岗单锚>角色映射）：overlay ${overlayDesc !== '' ? overlayDesc : '（无——低/高档 tier 缺失）'}；中档=现役 profile 缺省（现役即中档）；agent.yaml 档位 cmd 追加 --patch <该路径> 即挂载`,
    )
  } else {
    log('[serve] 无价目表：预算闸态 B 降级（估算=适配器自报、仅票级帽——见 src/engine/budget-gate.ts 头注两态）；模型档路由面关（派发行为不变）')
  }
  // 显式单级覆盖（studio-dev-196）：daemon.yaml modelTierTickets（解析即验在装载 case 面；
  // 此处装配期转 map——空串=空表合法：面开但只靠角色映射路由）
  const modelTierTicketsMap =
    config.modelTierTickets !== undefined ? parseModelTierTickets(config.modelTierTickets) : undefined

  // —— judge 注册位启动闸（studio-dev-164，红队 1 机制点）：agent.yaml 有 <family>-judge
  //    位时三查：①家族=v1 冻结面 dsh ②价目表在场（三帽要价目）③roles.micro_judge
  //    必显式 low（高档判断=成本事故，拦在启动面）——判断调用库本体的接线归单B ——
  const judgeRegs = agentConf?.executors.filter((e) => isJudgeExecutorName(e.name)) ?? []
  if (judgeRegs.length > 0) {
    for (const reg of judgeRegs) dshJudgeAdapterFactory(reg)
    if (catalog === undefined) {
      configInvalid('judge/no-models', 'judge 注册位在场但 daemon.yaml 无 models 段——三帽估算要价目表（studio-dev-160 §6.4）')
    }
    assertJudgeRoleLow(modelRoles ?? {})
    log(`[serve] judge 注册位：${judgeRegs.map((r) => r.name).join('、')}（v1=dsh 家派发面；三帽缺省 $0.01/次+$0.50/址/日+$5/公司/日）`)
  }

  // —— 队列小模型两址开关（160-B·studio-dev-182）：judgeSites 非空 → 组装 JudgeDeps
  //    + serve 常驻 rt（engine 每拍 beginTick）+ 两址编排器注入 EngineDeps.judge；空/未配
  //    =零装配零注入，规则缺省档行为零变（register 面 org-config 通用注册表归后续单）。
  const judgeSites = config.judgeSites !== undefined ? parseJudgeSites(config.judgeSites) : undefined
  let judgeHook: QueueJudgeHook | undefined
  const judgeReg = judgeRegs[0]
  if (judgeSites !== undefined && (judgeSites.pick || judgeSites.interrupt)) {
    if (judgeReg === undefined || catalog === undefined) {
      configInvalid('judge/no-face', 'judgeSites 开关在场但 judge 注册位/价目表缺席——判断调用要派发面+三帽价目（studio-dev-160 §6.3/§6.4）')
    }
    judgeHook = createQueueJudge({
      rt: createJudgeRuntime(),
      deps: { company: config.company, ledger, catalog, makeAdapter: dshJudgeAdapterFactory(judgeReg), now: clock },
      sites: judgeSites,
    })
    const on = [judgeSites.pick ? 'mj-129-pick' : '', judgeSites.interrupt ? 'mj-129-interrupt' : ''].filter((s) => s !== '').join('、')
    log(`[serve] 队列小模型两址：${on}（拍闸缺省 1/址/拍+2/公司/拍+12s 墙钟；降级=规则档原序）`)
  }

  return {
    registry,
    catalog,
    modelRoles,
    modelTierTickets: modelTierTicketsMap,
    judgeHook,
    acceptance,
    realGate,
  }
}
