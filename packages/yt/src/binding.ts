/**
 * 绑定档案 —— YouTrack 平台绑定三件套（BIND-PLAT-YT-01；IMPL-07-01）
 *
 * 依据（实现单引用设计文档章节号——AGENTS §五.1）：
 *   - v2/12 §2.2「协作平台绑定卡（三张）」BIND-PLAT-YT-01：覆盖/映射/活动流/供给/证据/损失/探针
 *   - v2/12 §2.3「状态映射规则」：平台态→工作十态（v2/09 ENU-03）**允许**；未映射但合法⇒
 *     Ok(unverified)＋原值逐字保留＋只观察；仅空/畸形⇒Err（配置缺陷）。**逐平台值映射表是
 *     部署工件**（状态板值域随实例配置），规范卷不冻结平台字面值——不确定即 unverified，
 *     不得猜（PRB-23 落证前本档案不带任何 verified 行）
 *   - v2/14 §八：平台三件套统一签名（bindingProfile/mapState/lossReport＋bindingId 选择器，
 *     治 L3J-P1-05「签名无选择器」，形状源=本卷 PORT-WORK 备注列＋v2/12 绑定卡）
 *   - docs/80 §6.6 BIND-01 三层：平台包只供**纯数据/纯函数**；不出 describe/exportBundle/
 *     exitPlan（宿在 daemon assembly/platform/binding.ts，禁第二实现）；零 IO、不写记录、
 *     不读时钟——本件满足（无 import 副作用、无记录写、常量冻结）
 *   - plan/05 IMPL-07-01；plan/02 LANE-B 平台绑定面；差距 G-DOM-02（yt 腿）/L3O-04
 *
 * 本件是「档案＋判决」，不是第二个平台实现：不持 FlowPlatform 实例、不调能力面、不读盘。
 * 三包（yt/taiga/localplatform）同形——改形状必须三包同改（同形由各包 test/v2/binding.test.ts
 * 以同一份键表断言）。
 */
import type { ClassifiedError, Result, WorkState } from '@studio-next/contract'

/** 本包唯一绑定标识（v2/12 §2.2 卡头；选择器只认它） */
export const BINDING_ID = 'BIND-PLAT-YT-01'

/** 平台种类（三包同形枚举字面量：youtrack｜taiga｜localfile） */
export type BindingPlatformKind = 'youtrack' | 'taiga' | 'localfile'

/** 平台端口七能力（能力名值集唯一主表 v2/09 ENU-112；v2/12 §2.2 覆盖口径） */
export type BindingCapabilityName = 'issues' | 'comments' | 'fields' | 'kb' | 'activity' | 'links' | 'guards'

/**
 * 能力覆盖形态：
 *   - implemented＝端口面端到端实现，无声明损失
 *   - degraded   ＝端口面**本身**可用但有已声明损失（损失逐项见 losses，按七能力可报）
 *   - unsupported＝显式不支持（调用即明报拒绝，不静默）
 * 不含部署/宿主侧缺失（那属宿主装配断言，平台包不自报）。
 */
export type BindingCapabilityStatus = 'implemented' | 'degraded' | 'unsupported'

/** 损失严重度三值（唯一主表 v2/09 ENU-110；v2/12 §六 表头同口径） */
export type BindingSeverity = 'blocking' | 'degrading' | 'cosmetic'

/** 档案事实状态（v2/12 §2.2 卡「现状」列；80-§6.6 BindingFactStatus 四值） */
export type BindingFactStatus = '已有' | '库级' | '目标' | '未证'

/** 探针执行三态（v2/12 §五：未执行不得写「预期通过」） */
export type BindingProbeState = 'executed' | 'not-executed' | 'not-applicable'

export interface BindingCapabilityRow {
  readonly name: BindingCapabilityName
  readonly status: BindingCapabilityStatus
  /** 覆盖口径的现状注记（卡行摘要，不写「预期通过」） */
  readonly note: string
}

/**
 * 档案里的状态映射行（v2/12 §2.3 允许面；80-§6.6 字段 #11 形状）。
 * `ours` 只许工作十态（v2/09 ENU-03）——禁验收/结清族（不同轴，v2/12 §2.3「禁止」段）。
 * `theirs`/`direction`/`lossRefs` 是部署工件字段；本包默认无已核值表（见 STATE_MAPPINGS）。
 */
export interface StateMappingRow {
  /** 族名恒 'work'（ENU-80 工作族；跨族映射＝拒收） */
  readonly family: 'work'
  /** 平台态原值（逐字保留，不预归一） */
  readonly theirs: string
  /** 工作十态（多对一必须列全） */
  readonly ours: readonly WorkState[]
  readonly direction: 'in' | 'out' | 'both'
  readonly verification: 'verified' | 'unverified'
  /** 损失锚（v2/12 §2.2 卡行锚；不自造 BIND-LOSS 编号——那是 v2/12 §六 全局表专用） */
  readonly lossRefs: readonly string[]
}

/**
 * 运行时映射判决（80-§6.6 StateMapping 的仓内投影：**无 mapped 字段**，false 分支不可达）。
 * 未命中⇒workStates 空＋verification='unverified'；消费方不得据此推进/验收/结清。
 */
export interface StateMapping {
  /** 平台原状态，原样保留（先归一化再映射＝缺陷） */
  readonly platformState: string
  /** 只许工作十态；未命中时为空数组（仍 Ok：未映射是观察事实，不是调用失败） */
  readonly workStates: readonly WorkState[]
  readonly verification: 'verified' | 'unverified'
  /** 唯一合法值：只观察、不推进 */
  readonly unmappedBehavior: 'observe-unmapped'
  readonly note?: string
}

/**
 * 单条绑定损失（平台侧，按七能力逐项可报；v2/12 §2.2 各卡「损失」行）。
 * `lossRef` 是**文档锚**（卡行位置），不是记录引用——REC-LOSS-01 记录写口在 daemon，
 * 平台包只有静态声明（80-§6.6 三层第 3 条：不写记录）。
 */
export interface BindingLoss {
  readonly lossRef: string
  readonly capability: BindingCapabilityName
  readonly severity: BindingSeverity
  readonly description: string
  /** 该损失下**不得**作出的宣称（v2/12 §六「每项都不能出现在损失豁免理由里充当已具备」） */
  readonly cannotClaim: string
}

/** 损失报告（数据面；severity 计数由静态声明复算，不手写合计） */
export interface RecBindingLossReport {
  readonly bindingId: string
  readonly losses: readonly BindingLoss[]
  readonly summary: {
    readonly blocking: number
    readonly degrading: number
    readonly cosmetic: number
  }
}

export interface BindingProbe {
  readonly probeId: string
  readonly state: BindingProbeState
}

/** 绑定档案（字段面＝bindingId/平台/能力/状态映射/损失报告＋事实状态/探针；三包同形） */
export interface BindingProfile {
  readonly bindingId: string
  readonly platform: {
    readonly kind: BindingPlatformKind
    /** 平台展示名（卡头标识行） */
    readonly title: string
    /** 档案版本（v2/12 §2.2 卡版本：v2.0，随探测实例版本重判） */
    readonly version: string
  }
  readonly capabilities: readonly BindingCapabilityRow[]
  readonly stateMappings: readonly StateMappingRow[]
  readonly losses: readonly BindingLoss[]
  readonly probes: readonly BindingProbe[]
  readonly factStatus: BindingFactStatus
}

// ─────────────────────────────────────────────────────────────────────────────
// 静态档案数据（唯一源；平台面与测试都从这里取，不另立第二张表）
// ─────────────────────────────────────────────────────────────────────────────

/** 七能力覆盖（顺序固定＝端口面顺序；卡「覆盖」行逐项） */
const CAPABILITIES: readonly BindingCapabilityRow[] = Object.freeze([
  { name: 'issues', status: 'implemented', note: 'list/get/create/transition/setField；parent 只挂链不换链' },
  { name: 'comments', status: 'implemented', note: '写=PATCH comment（含署名尾行）；读=history 条目过滤' },
  { name: 'fields', status: 'implemented', note: 'fieldmap 翻译；provision 仅实例内热换绑（平台侧建字段未做，N10）' },
  { name: 'kb', status: 'implemented', note: 'articles 面读写；kb.get 404 收口为 kb-not-found' },
  {
    name: 'activity',
    status: 'degraded',
    note: '只能轮询（无 webhook）；since(null)=最旧一批靠游标翻新；$top/$skip 偏移分页并发下可漏可重',
  },
  { name: 'links', status: 'implemented', note: 'Subtask 链读写；LinkType 三型映射见 links.ts' },
  {
    name: 'guards',
    status: 'unsupported',
    note: '显式不支持：install/uninstall/read 调用即 CONFIG_INVALID/yt-guards-not-implemented（N6 后续单，不静默）',
  },
])

/**
 * 状态映射表（v2/12 §2.3：**逐平台值表是部署工件**）。
 *
 * 本部署**没有**已核值表 → 空表，一字不猜：YouTrack 状态板值域随实例配置自定义，
 * 规范卷不冻结字面值；PRB-23（读侧）未执行前任何 `verified` 行都是编造。
 * 空表下 mapState 对一切非空合法原值返回 Ok(unverified)+workStates=[]（只观察）；
 * 只有空串/畸形才 Err。部署侧将来注入表（宿主合并或带 PRB-23 证据的提案）时，
 * 本常量是**唯一**落点——不得在 platform.ts 或别处再写第二张表。
 */
const STATE_MAPPINGS: readonly StateMappingRow[] = Object.freeze([])

/** 损失报告数据（v2/12 §2.2 BIND-PLAT-YT-01「损失」行；不豁免、不合并） */
const LOSSES: readonly BindingLoss[] = Object.freeze([
  {
    lossRef: 'v2/12 §2.2 BIND-PLAT-YT-01 损失行·guards 缺失',
    capability: 'guards',
    severity: 'degrading',
    description: 'YouTrack workflow guard 面未实现（install/uninstall/read 一律明报拒绝）：平台侧第二道闸不齐，与 Taiga 同口径',
    cannotClaim: '不得称平台侧第二道闸已齐；不得称越权写会被平台拒绝',
  },
  {
    lossRef: 'v2/12 §2.2 BIND-PLAT-YT-01 损失行·无 webhook',
    capability: 'activity',
    severity: 'degrading',
    description: '无 webhook 推送，活动流只能轮询（增量语义靠游标边界）',
    cannotClaim: '不得称平台变更实时可见或事件不漏',
  },
  {
    lossRef: 'v2/12 §2.2 BIND-PLAT-YT-01 损失行·偏移分页',
    capability: 'activity',
    severity: 'degrading',
    description: '$top/$skip 偏移分页在服务端数据并发变更时可漏可重（v0 已知局限，对账兜底=全量翻页）',
    cannotClaim: '不得称活动流无漏无重；对账结论不得省掉重放',
  },
  {
    lossRef: 'v2/12 §2.2 BIND-PLAT-YT-01 证据行·零真实网络',
    capability: 'issues',
    severity: 'degrading',
    description: '证据=fake 回放测试；零真实网络测试（PRB-13 写侧未执行），docs/03 只读探测不证明写路径可用',
    cannotClaim: '不得称 YouTrack 写路径已在真实例验证（PRB-13 未过前不宣读写侧契约）',
  },
])

/** 探针（v2/12 §2.2 卡「探针/现状」行；本仓 docs/probe 只有 pb-1 平台面零留证——一律 not-executed） */
const PROBES: readonly BindingProbe[] = Object.freeze([
  { probeId: 'PRB-13', state: 'not-executed' },
  { probeId: 'PRB-23', state: 'not-executed' },
])

function countSeverity(losses: readonly BindingLoss[], severity: BindingSeverity): number {
  return losses.filter((l) => l.severity === severity).length
}

/** 档案对象（冻结；同一引用供选择器/映射/损失三入口共享——单一源在运行时也是同一份） */
const PROFILE: BindingProfile = Object.freeze({
  bindingId: BINDING_ID,
  platform: Object.freeze({ kind: 'youtrack', title: 'YouTrack', version: 'v2.0' }),
  capabilities: CAPABILITIES,
  stateMappings: STATE_MAPPINGS,
  losses: LOSSES,
  probes: PROBES,
  // 卡「现状」= 库级：适配器存在、daemon 未接线（宿主绑定装配归 IMPL-07-06）
  factStatus: '库级',
})

const LOSS_REPORT: RecBindingLossReport = Object.freeze({
  bindingId: BINDING_ID,
  losses: LOSSES,
  summary: Object.freeze({
    blocking: countSeverity(LOSSES, 'blocking'),
    degrading: countSeverity(LOSSES, 'degrading'),
    cosmetic: countSeverity(LOSSES, 'cosmetic'),
  }),
})

// ─────────────────────────────────────────────────────────────────────────────
// 唯一绑定选择器 ＋ 三件套
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 唯一绑定选择器（治 L3J-P1-05：签名缺 bindingId → 读错档案/用错族表）。
 * 只认本包 BINDING_ID；缺省＝本包；**外域/未知/空串一律 Err**（不回落、不冒充——
 * 拿到别的平台档案会把状态映射与损失套错对象）。全包只有这一处解释 bindingId，
 * mapState/lossReport/bindingProfile 全部经它。
 */
export function resolveBinding(bindingId?: string): Result<BindingProfile, ClassifiedError> {
  const id = bindingId ?? BINDING_ID
  if (id !== BINDING_ID) {
    return {
      kind: 'err',
      error: {
        category: 'CONFIG_INVALID',
        subcause: 'binding-unknown',
        detail: `未知绑定 ${String(id)}：本包只承载 ${BINDING_ID}（不回落冒充）`,
      },
    }
  }
  return { kind: 'ok', value: PROFILE }
}

/** 档案骨架（v2/12 §2.2 卡：bindingId/平台/能力/状态映射/损失报告） */
export function bindingProfile(bindingId?: string): Result<BindingProfile, ClassifiedError> {
  return resolveBinding(bindingId)
}

/**
 * 平台态→工作十态**纯判决**（零 IO、不写记录、不读时钟；REC-OBS-02 由消费方落）。
 *   命中档案行 ⇒ Ok({workStates: row.ours, verification: row.verification})
 *   未命中但非空合法 ⇒ Ok(unverified, workStates=[], observe-unmapped)（原值逐字保留）
 *   空/畸形 ⇒ Err(rejected_precondition/CONFIG_INVALID)——配置缺陷，不是「不存在」
 */
export function mapState(platformState: string, bindingId?: string): Result<StateMapping, ClassifiedError> {
  const selected = resolveBinding(bindingId)
  if (selected.kind === 'err') return selected
  if (typeof platformState !== 'string' || platformState.trim() === '') {
    return {
      kind: 'err',
      error: {
        category: 'CONFIG_INVALID',
        subcause: 'platform-state-invalid',
        detail: `平台状态必须是非空字符串（空/畸形＝配置缺陷）：${String(platformState)}`,
      },
    }
  }
  const row = selected.value.stateMappings.find((m) => m.theirs === platformState)
  if (row === undefined) {
    return {
      kind: 'ok',
      value: { platformState, workStates: [], verification: 'unverified', unmappedBehavior: 'observe-unmapped' },
    }
  }
  return {
    kind: 'ok',
    value: {
      platformState,
      workStates: row.ours,
      verification: row.verification,
      unmappedBehavior: 'observe-unmapped',
    },
  }
}

/** 损失报告（与档案 losses 同一数组——单一源；severity 计数复算非手写） */
export function lossReport(bindingId?: string): Result<RecBindingLossReport, ClassifiedError> {
  const selected = resolveBinding(bindingId)
  if (selected.kind === 'err') return selected
  return { kind: 'ok', value: LOSS_REPORT }
}
