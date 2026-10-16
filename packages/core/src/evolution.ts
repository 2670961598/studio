/**
 * evolution —— 进化管线纯逻辑：候选制品谱系 + 三态闸门 + 无 candidate id 判负
 * （docs/16-§四 v0.10「进化管线+健壮性」首刀；02-F3-01/02/03；17-§3；20-§八.3/§九；08-§五 D8）
 *
 * 规格依据（实现单引用）：
 *   - docs/17-§3：candidates 表列 = id / 资产类型 / version / diff_hash / blast_radius /
 *     验证结果 / 谱系父 id / 状态——CandidateRecord 逐列对齐。
 *     **注意**：store 侧 candidates 表尚未建（migrations 现至 v4：v0.2 五表无 candidates，
 *     store/src/index.ts TODO 列明归后续 migration）——本刀形状以 17-§3 列集为准对齐，
 *     store 建表时以此为准（任务书「candidates 表已建（v2 迁移）」与实际不符，已如实上报）。
 *   - docs/02 F3-01：进化管线统一入口——同一 promote 状态机（观测→提案→沙箱→闸门→灰度→
 *     切权→复盘），禁旁路；**无 candidate id 的生产改动即判负**（16-§四 v0.10 验收原文）。
 *   - docs/02 F3-02：候选制品四元组 {版本/diff 哈希/blast_radius 分级/验证结果} + 谱系父 id
 *     **缺一不进闸门**；任一上线资产反追 ≥3 跳谱系。
 *   - docs/02 F3-03：三态闸门 accept/reject/escalate 按 blast_radius×风险档定档，
 *     仅 escalate 惊动制作人；无审批人默认拒绝（fail-closed）；初期建议全 escalate 再放开。
 *   - docs/20-§八.3：三态闸门 escalate 项 = 制作人触点（惊动预算口径的判定源）。
 *   - docs/20-§九：判据类资产（验收口径/探针/阈值/分歧判据）属宪法内核，改=制作人亲批。
 *   - docs/08-§五 D8 + 五不变律 4（护栏外置）：判据类锁死规则落在本文件（框架侧代码，
 *     agent 不可编辑面）——**不是 GatePolicy 的可配置项**，任何策略都关不掉；
 *     GatePolicy 只管可变面（blast_radius 定档放宽）。
 *
 * 语义裁定（拟稿待批点，汇报后走批示流）：
 *   - **AssetKind 枚举**（17-§3 只说「资产类型」未列值域）：prompt（提示词片段）/
 *     org_config（章程与组织配置）/ report_spec（报表口径）/ flow（状态流模板覆盖）/
 *     criterion（判据类——验收口径/探针/阈值/分歧判据，L4 宪法内核）。冻结前可扩，
 *     升 contract 走进化管线自身。
 *   - **BlastRadius 分级**（F3-02「分级」未定档；02-F3 开放问题「daemon 自我进化的
 *     blast_radius 定档」）：isolated（改动影响限该资产自身）/ company（影响跨部门或
 *     全司行为）/ framework（影响 daemon 决策面/契约/宪法面）——序即风险递增。
 *   - **幂等键 = asset_path × diff_hash**（任务书字面「同 diff_hash 幂等」收窄）：全局纯
 *     diff_hash 会把「两资产同内容」误并为一条（不同资产的相同改动各自成谱系）；
 *     且幂等只对**非终态**候选生效——rejected/retired 后同键再提案=新谱系代（被拒内容
 *     原样重提需改内容得新 hash，或换代重提；promoted→retired 后回滚原内容重提同此）。
 *   - **闸门条件与优先序**（首命中即定档，确定性）：
 *     ① 形状不完备（含验证结果快照缺）→ reject——「缺一不进闸门」的防御面；
 *     ② 判据类 → 恒 escalate——宪法面任何触碰（含沙箱红的提案）都该让制作人看见（审计面）；
 *     ③ sandboxPass≠true（含缺失，fail-closed）→ reject——技术验证是机器可判面；
 *     ④ blastRadiusOk≠true（含缺失）→ escalate——影响面超标是治理判断，人裁；
 *     ⑤ judges 任一不过 → reject——裁判证据红即红；
 *     ⑥ blast_radius 超出策略机器批上限 → escalate——F3-03「按 blast_radius 定档」+
 *     「初期建议全 escalate 再放开」（默认上限 isolated，仅局部低风险可机器批）；
 *     ⑦ 全绿 → approve。
 *   - **judges 同族判定不在本刀**（F3-05/F3-08 异源监控单收口）：gate 只收裁决结论
 *     （judge 标识 + pass）；「judge 禁同族模型/同源比对自动开 bug 单」归产证侧后续刀。
 *   - **approved→retired 边**：批后未晋升即放弃（提案弃案）；promoted→retired=退役/回滚。
 *     rejected / retired 为终态——复活不迁移、走 fork 新子代（谱系保留多样性档案，
 *     08 共性 7「好变体常出自平庸祖先」）。
 *   - **escalated→approved/rejected 只经 makerRuling**（制作人亲批面，20-§八.3）；
 *     gated→三态只经 applyGateDecision——两路人裁/闸门边不在机器迁移表内 =
 *     「禁旁路」（F3-01）在纯逻辑面的结构化：transitionCandidate 走不到这两步。
 *   - **asset_path 列**：17-§3 列集未列，但判负面「生产改动（资产路径+diff_hash）匹配
 *     approved/promoted 候选」机制上需要——纯 diff 匹配会把改动授权给任意同内容资产。
 *     本刀加入 CandidateRecord（拟稿），store 建表时对齐。
 *   - **ChangeRejected 类别**：任务书口径 CONFIG_INVALID/evolve/unauthorized。备选
 *     EVOLVE_REJECT（17-§9 枚举已有，dispositions→open_ticket 自动开单留谱系）语义
 *     亦合——已上报疑点，批示前按任务书冻结。
 *
 * 后续刀（本刀不做，头注声明）：
 *   - 沙箱执行器（sandboxRun 的真执行面）、灰度（shadow 并行记账+决策字段级 diff，F3-04）、
 *     切权（supervisor 重启加载，17-§2）、复盘（POSTMORTEM）——本刀只到「闸门决策纯函数
 *     + 状态迁移纯函数」。
 *   - daemon 侧接线：store 建 candidates 表 migration、判负面挂主循环/网关写径、
 *     闸门时点证据与落盘 verification 快照的一致性校验。
 *
 * 纯函数纪律（core 零 IO）：状态不可变（迁移返回新记录，不改原引用）；零 IO、零随机、
 * 零 Date.now；候选 id 生成归调用方（daemon 持 ULID，同 budget.ts 行 id 口径）。
 */

import type { ClassifiedError } from '@studio-next/contract'

// ---------------------------------------------------------------------------
// 值域：资产类型 / blast_radius 分级 / 状态机
// ---------------------------------------------------------------------------

/** 可进化资产类型（17-§3「资产类型」列；值域拟稿待批，见头注） */
export const ASSET_KINDS = ['prompt', 'org_config', 'report_spec', 'flow', 'criterion'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

/** 判据类资产（宪法内核 L4，08-§五 D8 / 20-§九）——闸门恒 escalate，非策略项 */
export const CRITERION_ASSET_KIND: AssetKind = 'criterion'

/** blast_radius 分级（F3-02「分级」；序=风险递增，拟稿待批，见头注） */
export const BLAST_RADII = ['isolated', 'company', 'framework'] as const
export type BlastRadius = (typeof BLAST_RADII)[number]

/** 分级序（0 起）：策略比较用；未知值 → CONFIG_INVALID（运行期防御，TS 面挡不住 JS 调用方） */
export function blastRadiusRank(r: BlastRadius): number {
  const i = BLAST_RADII.indexOf(r)
  if (i < 0) {
    const err = new Error(`CONFIG_INVALID/evolve/bad-blast-radius：未知 blast_radius「${String(r)}」（值域 ${BLAST_RADII.join('/')}）`) as Error & ClassifiedError
    err.category = 'CONFIG_INVALID'
    err.subcause = 'evolve/bad-blast-radius'
    throw err
  }
  return i
}

/**
 * 候选制品状态机（任务书冻结链 + 拟稿边，全表见头注）：
 *   draft → proposed → sandboxed → gated →（三态闸门）approved / rejected / escalated
 *   escalated →（制作人亲批）approved / rejected
 *   approved → promoted（灰度切权，后续刀接线）| retired（弃案）
 *   promoted → retired（退役/回滚）
 *   rejected / retired = 终态（复活走 fork 新子代，不迁移）
 */
export const CANDIDATE_STATUSES = [
  'draft', 'proposed', 'sandboxed', 'gated', 'approved', 'rejected', 'escalated', 'promoted', 'retired',
] as const
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

/** 终态集合（无出边；复活=fork 子代） */
export const TERMINAL_STATUSES: readonly CandidateStatus[] = ['rejected', 'retired']

/** 机器可走迁移表（表驱动，同 flows.ts 手法）。gated/escalated 无机器出边——两路人裁/闸门边单独收口（禁旁路） */
const MACHINE_EDGES: Readonly<Record<CandidateStatus, readonly CandidateStatus[]>> = {
  draft: ['proposed'],
  proposed: ['sandboxed'],
  sandboxed: ['gated'],
  gated: [],
  escalated: [],
  approved: ['promoted', 'retired'],
  promoted: ['retired'],
  rejected: [],
  retired: [],
}

/** 授权状态集：判负面唯一认的生产改动授权态（approved=闸门/人批放行；promoted=已切权在产） */
export const AUTHORIZING_STATUSES: readonly CandidateStatus[] = ['approved', 'promoted']

/**
 * 全部合法后继（机器边 ∪ 闸门三态边 ∪ 人裁边）——供测试枚举/面板渲染；
 * daemon 迁移态**不得**直接用本表（gated→approved 必须经 applyGateDecision，
 * escalated→* 必须经 makerRuling，见头注「禁旁路」段）。
 */
export function legalNextStatuses(status: CandidateStatus): readonly CandidateStatus[] {
  const machine = MACHINE_EDGES[status]
  const out: CandidateStatus[] = [...machine]
  const push = (s: CandidateStatus): void => {
    if (!out.includes(s)) out.push(s)
  }
  if (status === 'gated') {
    push('approved'); push('rejected'); push('escalated')
  }
  if (status === 'escalated') {
    push('approved'); push('rejected')
  }
  return out
}

/** 迁移合法性查表（含闸门/人裁边；语义约束另见 transitionCandidate 各守卫） */
export function canTransitionStatus(from: CandidateStatus, to: CandidateStatus): boolean {
  return legalNextStatuses(from).includes(to)
}

// ---------------------------------------------------------------------------
// 记录形状（对齐 17-§3 candidates 列；store 表未建，以此为准——见头注）
// ---------------------------------------------------------------------------

/** 裁判裁决结论（F3-05；同族过滤归异源监控单，本刀只收结论——见头注拟稿点） */
export interface JudgeVerdict {
  /** 裁判标识（executor/模型名；仅作谱系记录） */
  judge: string
  pass: boolean
}

/** 闸门证据（F3-03 fail-closed：任一 false/缺失即不过；judges 为可选加强通道） */
export interface GateEvidence {
  sandboxPass: boolean
  blastRadiusOk: boolean
  judges?: readonly JudgeVerdict[]
}

/**
 * 候选制品记录：逐列对齐 17-§3 candidates 表（id / asset_type / version / diff_hash /
 * blast_radius / verification / parent_id / status）+ asset_path（判负面机制需要，
 * 17-§3 未列——拟稿，见头注）。verification=闸门证据快照（store 侧 JSON 文本列，
 * 同 events.tokens 口径）；draft 期为 null（沙箱未跑），进 gated 前 must 非 null。
 */
export interface CandidateRecord {
  id: string
  asset_type: AssetKind
  /** 资产定位键（公司目录相对路径 / 框架资产键）——判负面匹配键之一（拟稿列，见头注） */
  asset_path: string
  version: string
  diff_hash: string
  blast_radius: BlastRadius
  verification: GateEvidence | null
  /** 谱系父 id（null=初代显式标记；fork 语义 v0 只此一种——rebase 归后续版本，parent_id 不可变） */
  parent_id: string | null
  status: CandidateStatus
}

/** 生产改动（判负面输入：被授权检查的最小单位——资产路径 + diff 哈希） */
export interface ProposedChange {
  asset_path: string
  diff_hash: string
}

// ---------------------------------------------------------------------------
// 抛错通道（CONFIG_INVALID=形状/数据损坏面；EVOLVE_REJECT=治理/状态机违规面）
// ---------------------------------------------------------------------------

function failInvalid(subcause: string, detail: string): never {
  const err = new Error(`CONFIG_INVALID/${subcause}：${detail}`) as Error & ClassifiedError
  err.category = 'CONFIG_INVALID'
  err.subcause = subcause
  err.detail = detail
  throw err
}

function failEvolve(subcause: string, detail: string): never {
  const err = new Error(`EVOLVE_REJECT/${subcause}：${detail}`) as Error & ClassifiedError
  err.category = 'EVOLVE_REJECT'
  err.subcause = subcause
  err.detail = detail
  throw err
}

/** 形状完备（非空字符串列 + 值域内枚举）：draft 创建时与 gate 防御面共用。
 *  枚举列不比 ''（类型面无重叠）——值域外/空值由 includes 运行期兜底（JS 调用方防御）。 */
function recordComplete(r: CandidateRecord): boolean {
  return (
    r.id !== '' && r.asset_path !== '' && r.version !== '' && r.diff_hash !== '' &&
    (ASSET_KINDS as readonly string[]).includes(r.asset_type) &&
    (BLAST_RADII as readonly string[]).includes(r.blast_radius)
  )
}

// ---------------------------------------------------------------------------
// 提案（幂等登记）：proposeCandidate
// ---------------------------------------------------------------------------

/** 提案入参（创建 draft；id 由调用方生成——daemon 持 ULID） */
export interface ProposalInput {
  id: string
  asset_type: AssetKind
  asset_path: string
  version: string
  diff_hash: string
  blast_radius: BlastRadius
  /** 谱系父 id（null=初代；父必须在 existing 中存在且挂接不成环） */
  parent_id: string | null
}

/** 提案结果：created=false 即幂等命中（record=既有候选，输入 id 被忽略——「返回既有 id 不新建」） */
export interface ProposalOutcome {
  created: boolean
  record: CandidateRecord
}

/** 现存候选 → id 索引（lineage/环检测共用；id 冲突时后者覆盖——store 主键唯一，此处防御面） */
export function candidatesById(records: readonly CandidateRecord[]): Map<string, CandidateRecord> {
  return new Map(records.map(r => [r.id, r]))
}

/**
 * 提案登记（幂等）：同 (asset_path, diff_hash) 且非终态 → 返回既有记录（created=false，
 * 不新建）；终态命中或键不同 → 建 draft（created=true）。
 * 形状闸（CONFIG_INVALID/evolve/bad-proposal）：空串列 / 未知枚举值 / parent 自引用。
 * 谱系闸（CONFIG_INVALID）：父不在现存集（evolve/parent-unknown）/ 挂接成环
 * （evolve/lineage-cycle——沿父链上爬遇自身 id 即环）。
 */
export function proposeCandidate(input: ProposalInput, existing: readonly CandidateRecord[]): ProposalOutcome {
  // 形状闸（含自引用——不需要登记集即可判定）
  const empty: string[] = []
  if (input.id === '') empty.push('id')
  if (input.asset_path === '') empty.push('asset_path')
  if (input.version === '') empty.push('version')
  if (input.diff_hash === '') empty.push('diff_hash')
  if (!(ASSET_KINDS as readonly string[]).includes(input.asset_type)) empty.push(`asset_type(${String(input.asset_type)})`)
  if (!(BLAST_RADII as readonly string[]).includes(input.blast_radius)) empty.push(`blast_radius(${String(input.blast_radius)})`)
  if (empty.length > 0) {
    failInvalid('evolve/bad-proposal', `提案形状不完备或值域外：${empty.join(' / ')}`)
  }
  if (input.parent_id === input.id) {
    failInvalid('evolve/self-parent', `候选 ${input.id} 谱系父指向自身（自引用环）`)
  }

  // 幂等闸：同资产同内容且非终态 → 既有 id 不新建（终态命中放行新建=换代重提，见头注拟稿点）
  const hit = existing.find(
    r => r.asset_path === input.asset_path && r.diff_hash === input.diff_hash &&
      !(TERMINAL_STATUSES as readonly string[]).includes(r.status),
  )
  if (hit !== undefined) return { created: false, record: hit }

  // 谱系闸：父必须存在；挂接不得成环
  if (input.parent_id !== null) {
    const byId = candidatesById(existing)
    if (!byId.has(input.parent_id)) {
      failInvalid('evolve/parent-unknown', `候选 ${input.id} 谱系父 ${input.parent_id} 不在现存候选集（F3-02 谱系可反追）`)
    }
    for (const ancestor of ancestorIds(input.parent_id, byId)) {
      if (ancestor === input.id) {
        failInvalid('evolve/lineage-cycle', `候选 ${input.id} 挂接父 ${input.parent_id} 将构成谱系环`)
      }
    }
  }

  return {
    created: true,
    record: {
      id: input.id,
      asset_type: input.asset_type,
      asset_path: input.asset_path,
      version: input.version,
      diff_hash: input.diff_hash,
      blast_radius: input.blast_radius,
      verification: null,
      parent_id: input.parent_id,
      status: 'draft',
    },
  }
}

/** 沿 parent_id 上爬的祖先 id 流（不含起点自身；父缺失即断流——供环检测与 lineage 共用底座） */
function ancestorIds(startId: string, byId: ReadonlyMap<string, CandidateRecord>): readonly string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let cur = byId.get(startId)
  while (cur !== undefined && cur.parent_id !== null) {
    if (seen.has(cur.parent_id)) throw cycleError(cur.parent_id)
    seen.add(cur.parent_id)
    out.push(cur.parent_id)
    cur = byId.get(cur.parent_id)
  }
  return out
}

function cycleError(culprit: string): Error & ClassifiedError {
  const err = new Error(`CONFIG_INVALID/evolve/lineage-cycle：谱系链在 ${culprit} 处成环（环内候选反追不出根）`) as Error & ClassifiedError
  err.category = 'CONFIG_INVALID'
  err.subcause = 'evolve/lineage-cycle'
  return err
}

// ---------------------------------------------------------------------------
// 谱系：lineage（全祖先链，自含起点，新→旧）
// ---------------------------------------------------------------------------

/**
 * 全祖先链：[自身, 父, 祖父, …, 根]（初代=仅 [自身]）。
 * F3-02「任一上线资产反追 ≥3 跳谱系」的查询面——上线资产应能给出 length≥4 的链。
 * fail-closed（CONFIG_INVALID）：父 id 在索引中缺失（evolve/lineage-broken——台账丢数据，
 * 不静默截断）/ 链成环含自引用（evolve/lineage-cycle——store 侧数据损坏的防御面）。
 */
export function lineage(record: CandidateRecord, byId: ReadonlyMap<string, CandidateRecord>): readonly CandidateRecord[] {
  const out: CandidateRecord[] = [record]
  const seen = new Set<string>([record.id])
  let parent = record.parent_id
  while (parent !== null) {
    if (seen.has(parent)) throw cycleError(parent)
    const node = byId.get(parent)
    if (node === undefined) {
      failInvalid('evolve/lineage-broken', `候选 ${record.id} 谱系断链：祖先 ${parent} 不在候选集（F3-02 反追 ≥3 跳不可满足）`)
    }
    seen.add(parent)
    out.push(node)
    parent = node.parent_id
  }
  return out
}

// ---------------------------------------------------------------------------
// 状态迁移（表驱动 + 守卫）；闸门/人裁边单独收口
// ---------------------------------------------------------------------------

/**
 * 机器迁移（draft→proposed→sandboxed→gated / approved→promoted|retired / promoted→retired）。
 * 守卫：sandboxed→gated 需 verification 非 null——F3-02「验证结果缺一不进闸门」的机器侧
 * 落点（闸门侧防御面见 gate①）。非法迁移显式拒（EVOLVE_REJECT/evolve/illegal-transition）；
 * gated→三态 / escalated→人裁 走 applyGateDecision / makerRuling（本函数到不了=禁旁路结构化）。
 * 返回新记录（不可变；parent_id 等谱系列原样——fork-only，rebase 不存在）。
 */
export function transitionCandidate(record: CandidateRecord, to: CandidateStatus): CandidateRecord {
  const legal = MACHINE_EDGES[record.status]
  if (!(legal as readonly string[]).includes(to)) {
    failEvolve(
      'evolve/illegal-transition',
      `非法迁移 ${record.status}→${to}（候选 ${record.id}；合法机器后继 [${legal.join('/') || '无'}]` +
        `${record.status === 'gated' ? '——闸门三态只经 applyGateDecision' : ''}` +
        `${record.status === 'escalated' ? '——人裁只经 makerRuling' : ''}）`,
    )
  }
  if (record.status === 'sandboxed' && to === 'gated' && record.verification === null) {
    failEvolve('evolve/verification-missing', `候选 ${record.id} 无验证结果快照不得进闸门（F3-02 四元组+谱系缺一不进闸门）`)
  }
  return { ...record, status: to }
}

/** 三态闸门决策 → 状态（approve→approved / reject→rejected / escalate→escalated） */
export function decisionToStatus(decision: GateVerdict): CandidateStatus {
  switch (decision) {
    case 'approve': return 'approved'
    case 'reject': return 'rejected'
    case 'escalate': return 'escalated'
  }
}

/** 施加闸门决策：前置 status==='gated'（未进闸门不得施加——EVOLVE_REJECT/evolve/not-gated） */
export function applyGateDecision(record: CandidateRecord, decision: GateDecision): CandidateRecord {
  if (record.status !== 'gated') {
    failEvolve('evolve/not-gated', `候选 ${record.id} 状态 ${record.status} 未进闸门，不得施加闸门决策（禁旁路，F3-01）`)
  }
  return { ...record, status: decisionToStatus(decision.decision) }
}

/**
 * 制作人裁决（20-§八.3 escalate 项触点的人裁回路口）：escalated→approved（亲批放行）/
 * escalated→rejected（驳回）。前置 status==='escalated'（EVOLVE_REJECT/evolve/not-escalated）。
 */
export function makerRuling(record: CandidateRecord, ruling: 'approve' | 'reject'): CandidateRecord {
  if (record.status !== 'escalated') {
    failEvolve('evolve/not-escalated', `候选 ${record.id} 状态 ${record.status} 不在人裁位（escalated），制作人裁决不可施加`)
  }
  return { ...record, status: ruling === 'approve' ? 'approved' : 'rejected' }
}

// ---------------------------------------------------------------------------
// 三态闸门（纯决策函数，fail-closed）
// ---------------------------------------------------------------------------

/** 闸门三态（F3-03 accept/reject/escalate；词汇取 escalate——事件枚举 ESCALATE 20-§八.3） */
export type GateVerdict = 'approve' | 'reject' | 'escalate'

/** 机器可比对理由码（首命中优先序，冻结后升 contract 拟稿） */
export type GateReason =
  | 'incomplete-record'
  | 'criterion-locked'
  | 'sandbox-failed'
  | 'blast-radius-breached'
  | 'judge-failed'
  | 'blast-radius-above-auto-approve'
  | 'all-evidence-green'

/** 闸门决策（纯数据；note 引 docs 供面板/日志人读） */
export interface GateDecision {
  decision: GateVerdict
  reason: GateReason
  note: string
}

/** 闸门策略（可变面）：机器可批准的 blast_radius 上限（含）；超出恒 escalate。
 *  判据类锁死**不在此**（宪法面不可配置，08-§五 D8 护栏外置）。 */
export interface GatePolicy {
  autoApproveMaxBlast: BlastRadius
}

/** 默认策略（F3-03「初期建议全 escalate 再放开」的保守落档：仅 isolated 可机器批） */
export const DEFAULT_GATE_POLICY: GatePolicy = { autoApproveMaxBlast: 'isolated' }

/**
 * 三态闸门（F3-03 fail-closed）：批准条件全枚举——
 *   approve ⇔ ①形状完备（含 verification 快照非 null）②非判据类 ③sandboxPass===true
 *             ④blastRadiusOk===true ⑤judges 未提供或全 pass ⑥blast_radius ≤ 策略上限。
 *   判据类恒 escalate（②不成立即 escalate——L4 锁死，制作人亲批，任何策略关不掉）。
 *   证据缺失（undefined/缺字段）与不过同判（fail-closed：无审批人=无证据=不放行）。
 *   评估序=头注拟稿点①…⑦，首命中即定档（同输入恒同决策，golden 可回放）。
 */
export function gate(
  candidate: CandidateRecord,
  evidence: GateEvidence,
  policy: GatePolicy = DEFAULT_GATE_POLICY,
): GateDecision {
  // ① 形状完备（创建时已闸，此处防御 JS 调用方/坏行流；verification 快照缺=四元组缺一）
  if (!recordComplete(candidate) || candidate.verification === null) {
    return {
      decision: 'reject', reason: 'incomplete-record',
      note: '候选形状不完备或验证结果快照缺失——四元组+谱系缺一不进闸门（F3-02），fail-closed 拒',
    }
  }
  // ② 判据类：宪法内核 L4 锁死——机器恒不批，制作人亲批（20-§九/08-§五 D8）；优先于一切证据
  if (candidate.asset_type === CRITERION_ASSET_KIND) {
    return {
      decision: 'escalate', reason: 'criterion-locked',
      note: '判据类资产（验收口径/探针/阈值/分歧判据）属宪法内核：改=制作人亲批，机器恒 escalate（20-§九）',
    }
  }
  // ③ 沙箱红/缺 → reject（技术验证机器可判）
  if (evidence.sandboxPass !== true) {
    return {
      decision: 'reject', reason: 'sandbox-failed',
      note: '沙箱验证未过或证据缺失——fail-closed 与 false 同判（F3-03）',
    }
  }
  // ④ 影响面超标/缺 → escalate（实测超声明是治理判断，人裁）
  if (evidence.blastRadiusOk !== true) {
    return {
      decision: 'escalate', reason: 'blast-radius-breached',
      note: 'blast_radius 检查未过或证据缺失——影响面超标是治理判断，escalate 人裁（F3-03）',
    }
  }
  // ⑤ 裁判证据红即红（可选通道：任一不过=不过）
  if (evidence.judges !== undefined && evidence.judges.some(j => j.pass !== true)) {
    return {
      decision: 'reject', reason: 'judge-failed',
      note: '裁判证据存在未过项（F3-05）——任一 judge 红即红',
    }
  }
  // ⑥ 超策略上限 → escalate（默认仅 isolated 可机器批——F3-03 初期保守档）
  if (blastRadiusRank(candidate.blast_radius) > blastRadiusRank(policy.autoApproveMaxBlast)) {
    return {
      decision: 'escalate', reason: 'blast-radius-above-auto-approve',
      note: `blast_radius=${candidate.blast_radius} 超出机器批上限 ${policy.autoApproveMaxBlast}——按 blast_radius 定档 escalate（F3-03）`,
    }
  }
  // ⑦ 全绿
  return {
    decision: 'approve', reason: 'all-evidence-green',
    note: '沙箱绿+影响面绿+裁判（如提供）全过+分级在机器批上限内——批准条件全枚举见 evolution.ts 头注',
  }
}

// ---------------------------------------------------------------------------
// 「无 candidate id 的生产改动判负」判定面（F3-01 / 16-§四 v0.10 验收）
// ---------------------------------------------------------------------------

/** 判负诊断：同资产路径的近似命中（改了什么/差在哪，不静默——不伪造不隐瞒） */
export interface NearMiss {
  id: string
  asset_path: string
  diff_hash: string
  status: CandidateStatus
  /** hash-mismatch=同资产不同内容；status-not-authorizing=同内容但状态未授权（含 retired 吊销） */
  reason: 'hash-mismatch' | 'status-not-authorizing'
}

/** 判负错误（CONFIG_INVALID/evolve/unauthorized——任务书口径，备选疑点见头注） */
export type ChangeRejectedError = Error & ClassifiedError & {
  change: ProposedChange
  nearMisses: readonly NearMiss[]
}

/**
 * 生产改动授权断言（20-§九「无 candidate id 的生产改动判负」的纯逻辑判定面）：
 * 改动 (asset_path, diff_hash) 必须命中**恰一** approved/promoted 候选（多命中取首现，
 * 并存是 daemon 数据面问题——如实放行不猜）。
 *   - 命中 → 返回授权候选（daemon 记谱系/日志用）；
 *   - 未命中 → 抛 ChangeRejected（CONFIG_INVALID/evolve/unauthorized），携带同资产路径
 *     的 nearMisses（hash 不符 / 状态未授权——**retired 吊销匹配仍拒**：授权态只有
 *     approved|promoted，吊销即失效）。
 *   - 形状坏（空路径/空哈希）→ CONFIG_INVALID/evolve/change-malformed。
 * daemon 侧接线（主循环/网关写径挂钩）归后续刀——本函数是判定核。
 */
export function assertChangeAuthorized(change: ProposedChange, activeCandidates: readonly CandidateRecord[]): CandidateRecord {
  if (change.asset_path === '' || change.diff_hash === '') {
    failInvalid('evolve/change-malformed', `生产改动形状坏：asset_path/diff_hash 不得为空（${JSON.stringify(change)}）`)
  }
  for (const c of activeCandidates) {
    if (c.asset_path === change.asset_path && c.diff_hash === change.diff_hash &&
      (AUTHORIZING_STATUSES as readonly string[]).includes(c.status)) {
      return c
    }
  }
  // 判负：不伪造不隐瞒——收集同资产路径近似命中，错误里如实带出
  const nearMisses: NearMiss[] = activeCandidates
    .filter(c => c.asset_path === change.asset_path)
    .map(c => ({
      id: c.id,
      asset_path: c.asset_path,
      diff_hash: c.diff_hash,
      status: c.status,
      reason: c.diff_hash === change.diff_hash ? 'status-not-authorizing' : 'hash-mismatch',
    }))
  const err = new Error(
    `CONFIG_INVALID/evolve/unauthorized：无 candidate id 的生产改动判负——${change.asset_path} diff=${change.diff_hash}` +
    `（16-§四 v0.10 / 20-§九：一切改进走候选制品管线，禁旁路）` +
    (nearMisses.length === 0 ? '；该资产无任何候选记录' : `；近似命中：${nearMisses.map(m => `${m.id}[${m.status}/${m.reason}]`).join('，')}`),
  ) as ChangeRejectedError
  err.category = 'CONFIG_INVALID'
  err.subcause = 'evolve/unauthorized'
  err.change = change
  err.nearMisses = nearMisses
  throw err
}
