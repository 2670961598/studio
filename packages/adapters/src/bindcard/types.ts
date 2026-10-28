/**
 * bindcard/types —— 执行宿主绑定档案卡的形状面（BIND-；IMPL-07-05）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - v2/12 §〇.2 四问分立（正当性/技术许可/能力/证据；绑定不是授权）与 §〇.3 三分
 *     （硬边界/软限制/不可表达）——卡面只答「技术许可＋能力＋证据」，授权仍归 v2/03 四态。
 *   - v2/12 §〇.4 绑定档案卡格式（BIND-）：必答十二行（标识/ownerRef/宿主与版本范围/
 *     覆盖·不支持/映射/供给/授权与生效/证据/损失/导出·迁移·退出/探针/现状）＋四条硬规则
 *     ——引用带 ID+版本；摘要未计算前不得当校验位；版本不符＝弃用不静默降级；现状按面拆行、
 *     每面恰一值（禁「部分已有」混写）。
 *   - v2/12 §一 BIND-DSH-01 卡本体（§1.1 卡面 / §1.2 面表 / §1.4 载体映射 / §1.5 专属面）
 *     与 §2.1 三张备选 CLI 卡；§五 探针主表（PRB-，状态三值）；§六 绑定损失表。
 *   - v2/09 ENU-109 现状四值、ENU-110 损失 severity 三值、ENU-111 探针状态三值
 *     （值集唯一主表在 09；本件只是运行时投影，不另立值集）。
 *   - v2/05 §三 DOM-06：能力包、部署绑定＝独立工件（能力包/绑定档案），公司包只携带引用
 *     与兼容声明，唯一写入者＝部署责任者——绑定档案是**公司包之外**的事实源。
 *   - plan/05 IMPL-07-05（本单领土）；plan/02 §五-8 接口耦合（本模块不改 daemon/其它包）。
 *
 * 边界（不冒充）：
 *   - 本模块是**卡的装载与查表面**（纯数据＋纯函数，零 IO、零时钟、零进程），不是绑定执行面：
 *     宿主实际拦截能力未证（PRB-04 等未执行），卡上一切「已有」只表示仓内实现/接线事实，
 *     一律不升级为「机制保证」；探针未执行不得写成「预期通过」（v2/12 §0.4 硬规则）。
 *   - 摘要位：v2/10 jcs@1 跨实现未证 → 卡摘要恒 `computed:false`（「未计算（目标）」），
 *     不得被消费方当作校验位（置 computed:true 的卡在本模块装载期即拒收）。
 *   - 现状行形状：`CarrierRow` 的「无载体」行单列 `unmappable`（v2/12 §〇.3 不可表达类），
 *     不硬塞进现状四值——把「无」写成「未证/目标」都是把不可表达降格成未做的事。
 */
import type { ClassifiedError, ExecutorFamily, Result } from '@studio-next/contract'

/** 卡现状四值（v2/09 ENU-109；v2/12 §〇.4「现状」行：按面拆行、每面恰一值） */
export const CARD_FACT_STATUSES = ['已有', '库级', '目标', '未证'] as const
export type CardFactStatus = (typeof CARD_FACT_STATUSES)[number]

/** 探针执行三态（v2/09 ENU-111；v2/12 §五：只有这三个取值；未执行不得写「预期通过」） */
export const PROBE_STATES = ['executed', 'not-executed', 'not-applicable'] as const
export type ProbeState = (typeof PROBE_STATES)[number]

/** 绑定损失 severity 三值（v2/09 ENU-110；v2/12 §六表头） */
export const LOSS_SEVERITIES = ['blocking', 'degrading', 'cosmetic'] as const
export type LossSeverity = (typeof LOSS_SEVERITIES)[number]

/** 现状面行（「面→现状」表；锚点是仓内文件/文档锚，供复核不供自证） */
export interface CardFaceRow {
  readonly face: string
  readonly status: CardFactStatus
  readonly anchor: string
}

/** 探针行（PRB- 引用＋状态；未执行即 not-executed，不写期望） */
export interface CardProbeRow {
  readonly probeId: string
  readonly state: ProbeState
}

/** 损失行（v2/12 §六；cannotClaim＝该损失下不得作出的宣称） */
export interface CardLossRow {
  readonly lossId: string
  readonly severity: LossSeverity
  readonly description: string
  readonly cannotClaim: string
}

/**
 * 载体映射行（v2/12 §1.4 四列：语义/载体/强度/现状）。
 * `status` 与 `unmappable` **二选一**：宿主词汇里没有该维度（网络/进程/秘密/组织/验收/
 * 跨进程互斥）＝不可表达类（§〇.3），不是「未证」；两者同时给出或同时缺席＝装载期拒收。
 */
export interface CarrierRow {
  readonly semantic: string
  readonly carrier: string
  readonly strength: string
  readonly status?: CardFactStatus
  readonly unmappable?: true
  readonly note?: string
}

/** 导出/迁移/退出行（无退出＝锁定，判缺陷——v2/12 §〇.4） */
export interface CardExportExit {
  readonly export: string
  readonly migration: string
  readonly exit: string
}

/** 授权与生效行（绑定不是授权；生效＝宿主承认按段＋运行时比对） */
export interface CardAuthorization {
  /** 按段计（v2/12 §1.6）；本字段恒 'per-segment'，不提供「整体已生效」布尔 */
  readonly mode: 'per-segment'
  /** 未承载段在供给链上的上限与禁称（v2/12 §1.6） */
  readonly unsupportedSegmentRule: string
  /** 授权权源引位（v2/03 四态——本卡不复制授权值集） */
  readonly notAuthority: string
}

/** 宿主绑定档案卡（必答十二行；卡面无授权判定位——绑定不是授权） */
export interface BindingCard {
  readonly cardId: string
  readonly cardVersion: string
  /** 宿主家族（与 registry/agentconfig 的 ExecutorFamily 同值集；卡不另立执行器名） */
  readonly family: ExecutorFamily
  /** 摘要位：未计算即 computed:false（v2/10 jcs@1 跨实现未证） */
  readonly digest: { readonly computed: false; readonly note: string }
  readonly ownerRef: string
  readonly host: {
    readonly name: string
    readonly version: string
    readonly license: string
    readonly launchForm: string
    readonly supplyRef: string
  }
  readonly coverage: readonly string[]
  readonly unsupported: readonly string[]
  readonly carrierMap: readonly CarrierRow[]
  readonly supply: readonly string[]
  readonly authorization: CardAuthorization
  readonly evidence: readonly string[]
  readonly losses: readonly CardLossRow[]
  readonly exportExit: CardExportExit
  readonly probes: readonly CardProbeRow[]
  readonly faces: readonly CardFaceRow[]
}

/** 执行宿主绑定卡 ID 家族（本包领土：DSH 主绑定＋三张备选 CLI 卡；平台/WS/PRM 卡不在此） */
export const HOST_BINDING_CARD_IDS = [
  'BIND-DSH-01',
  'BIND-CLI-CLAUDE-01',
  'BIND-CLI-CODEX-01',
  'BIND-CLI-KIMI-01',
] as const
export type HostBindingCardId = (typeof HOST_BINDING_CARD_IDS)[number]

/** 深冻结（卡面是常量事实；取到卡再顺手改＝不可能——机制不是注释） */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const key of Object.keys(value)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/** 分类失败 Result（CONFIG_INVALID；与包内 configInvalid 抛错通道同族，本模块走 Result 不抛） */
export function configErr<T>(subcause: string, detail: string): Result<T, ClassifiedError> {
  return { kind: 'err', error: { category: 'CONFIG_INVALID', subcause, detail } }
}

/** 成功 Result */
export function okResult<T>(value: T): Result<T, ClassifiedError> {
  return { kind: 'ok', value }
}
